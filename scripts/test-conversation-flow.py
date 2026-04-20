#!/usr/bin/env python3
"""
Test conversation flow with RawClaw agent.

This script tests:
1. Basic chat (hello)
2. Tool awareness (asking what tools are available)
3. Tool invocation (web search)

Usage:
    python scripts/test-conversation-flow.py

Requires:
    - API running on http://localhost:3000
    - Agent running on http://localhost:8000
"""

import asyncio
import json
import sys
import time
from typing import Optional
from uuid import uuid4

import httpx

API_BASE = "http://localhost:3000/api"
AGENT_BASE = "http://localhost:8001"

# Alternative: test directly against agent
AGENT_EXECUTE_URL = f"{AGENT_BASE}/execute"


class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def log_step(step_num: int, title: str):
    print(f"\n{Colors.HEADER}{'='*60}{Colors.ENDC}")
    print(f"{Colors.BOLD}STEP {step_num}: {title}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'='*60}{Colors.ENDC}\n")


def log_send(message: str):
    print(f"{Colors.CYAN}[SEND] USER:{Colors.ENDC} {message[:100]}{'...' if len(message) > 100 else ''}")


def log_receive(content: str, label: str = "ASSISTANT"):
    color = Colors.GREEN if label == "ASSISTANT" else Colors.YELLOW
    print(f"{color}[RECV] {label}:{Colors.ENDC} {content[:200]}{'...' if len(content) > 200 else ''}")


def log_error(message: str):
    print(f"{Colors.RED}[X] ERROR:{Colors.ENDC} {message}")


def log_success(message: str):
    print(f"{Colors.GREEN}[OK] SUCCESS:{Colors.ENDC} {message}")


def log_info(message: str):
    print(f"{Colors.BLUE}[i] INFO:{Colors.ENDC} {message}")


async def check_health() -> bool:
    """Check if API and Agent are running."""
    all_ok = True

    # Check API
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{API_BASE}/health")
            if resp.status_code == 200:
                log_info("API is healthy (port 3000)")
            else:
                log_error(f"API health check failed: {resp.status_code}")
                all_ok = False
    except Exception as e:
        log_error(f"API connection failed: {e}")
        all_ok = False

    # Check Agent
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{AGENT_BASE}/health")
            if resp.status_code == 200:
                log_info("Agent is healthy (port 8000)")
            else:
                log_error(f"Agent health check failed: {resp.status_code}")
                all_ok = False
    except Exception as e:
        log_error(f"Agent connection failed: {e}")
        all_ok = False

    # Check MCP (optional)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{AGENT_BASE}/api/mcp/health")
            data = resp.json()
            if data.get("connected"):
                log_info(f"MCP connected: {data.get('connected_count', 0)} servers")
            else:
                log_info("MCP not connected (tools may still work)")
    except Exception as e:
        log_info(f"MCP check skipped: {e}")

    if not all_ok:
        print(f"\n{Colors.YELLOW}Make sure services are running:{Colors.ENDC}")
        print(f"  1. npm run dev  (in project root)")
        print(f"  2. Or run individually:")
        print(f"     cd apps/api && npm run dev")
        print(f"     cd apps/agent && python -m src.main")

    return all_ok


async def get_tools() -> list:
    """Get available tools from agent."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{AGENT_BASE}/api/tools")
            data = resp.json()
            return data.get("tools", [])
    except Exception as e:
        log_error(f"Failed to fetch tools: {e}")
        return []


async def send_chat_stream(session_id: str, message: str, model: str = "ollama/qwen2.5:1.5b") -> dict:
    """
    Send a chat message and collect the streaming response.
    Returns dict with: content, tool_calls, tool_results, provenance, success, error
    """
    result = {
        "content": "",
        "tool_calls": [],
        "tool_results": [],
        "provenance": None,
        "model_id": None,
        "success": False,
        "error": None,
        "events": []
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Get auth token first
            try:
                auth_resp = await client.post(
                    f"{API_BASE}/auth/token",
                    json={"secret": "Kuki7816"}
                )
                if auth_resp.status_code in (200, 201):
                    token = auth_resp.json().get("access_token", "")
                    headers = {"Authorization": f"Bearer {token}"}
                else:
                    headers = {}
            except Exception:
                headers = {}

            resp = await client.post(
                f"{API_BASE}/chat/send",
                headers=headers,
                json={
                    "session_id": session_id,
                    "messages": [{"role": "user", "content": message}],
                    "model": model,
                    "stream": True
                }
            )

            if resp.status_code not in (200, 201):
                result["error"] = f"HTTP {resp.status_code}: {resp.text}"
                return result

            # Process SSE stream
            async for line in resp.aiter_text():
                line = line.strip()
                if not line:
                    continue

                # Parse SSE data
                if line.startswith("data:"):
                    data_str = line[5:].strip()
                else:
                    data_str = line

                if not data_str:
                    continue

                try:
                    data = json.loads(data_str)
                    event_type = data.get("type")

                    if event_type:
                        result["events"].append(event_type)

                    if event_type == "content":
                        result["content"] += data.get("content", "")

                    elif event_type == "tool_call":
                        result["tool_calls"].append(data.get("tool_call", {}))

                    elif event_type == "tool_result":
                        result["tool_results"].append(data.get("tool_result", {}))

                    elif event_type == "provenance":
                        result["provenance"] = data.get("provenance_trace") or data.get("provenance")

                    elif event_type == "metadata":
                        result["model_id"] = data.get("metadata", {}).get("modelId")

                    elif event_type == "error":
                        result["error"] = data.get("message", "Unknown error")

                    elif event_type == "done":
                        result["success"] = True

                except json.JSONDecodeError:
                    continue

    except Exception as e:
        result["error"] = str(e)

    return result


async def test_agent_direct(session_id: str, message: str, model: str = "ollama/qwen2.5:1.5b") -> dict:
    """
    Test agent directly via /execute endpoint (bypasses API).
    """
    result = {
        "content": "",
        "tool_calls": [],
        "tool_results": [],
        "provenance": None,
        "success": False,
        "error": None,
        "events": []
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                AGENT_EXECUTE_URL,
                json={
                    "session_id": session_id,
                    "messages": [{"role": "user", "content": message}],
                    "model": model,
                    "stream": True
                }
            )

            if resp.status_code != 200:
                result["error"] = f"HTTP {resp.status_code}: {resp.text}"
                return result

            # Process NDJSON stream
            buffer = ""
            async for chunk in resp.aitext():
                buffer += chunk
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        data = json.loads(line)
                        event_type = data.get("type")

                        if event_type:
                            result["events"].append(event_type)

                        if event_type == "content":
                            result["content"] += data.get("content", "")

                        elif event_type == "tool_call":
                            result["tool_calls"].append(data.get("tool_call", {}))

                        elif event_type == "tool_result":
                            result["tool_results"].append(data.get("tool_result", {}))

                        elif event_type == "provenance":
                            result["provenance"] = data.get("provenance_trace") or data.get("provenance")

                        elif event_type == "error":
                            result["error"] = data.get("message", "Unknown error")

                        elif event_type == "done":
                            result["success"] = True

                    except json.JSONDecodeError:
                        continue

            # Process any remaining buffer
            if buffer.strip():
                try:
                    data = json.loads(buffer.strip())
                    if data.get("type") == "done":
                        result["success"] = True
                except json.JSONDecodeError:
                    pass

    except Exception as e:
        result["error"] = str(e)

    return result


async def run_test():
    """Run the full conversation test."""
    session_id = f"test-{uuid4().hex[:8]}"
    results = []

    print(f"\n{Colors.BOLD}RawClaw Conversation Flow Test{Colors.ENDC}")
    print(f"Session ID: {session_id}")
    print(f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Step 0: Health Check
    log_step(0, "Health Check")
    if not await check_health():
        print(f"\n{Colors.RED}Health check failed. Make sure API (port 3000) and Agent (port 8000) are running.{Colors.ENDC}")
        sys.exit(1)

    # Check available tools
    tools = await get_tools()
    log_info(f"Available tools ({len(tools)}):")
    for tool in tools[:10]:  # Show first 10
        print(f"  - {tool.get('name', 'unknown')}: {tool.get('description', 'No description')[:50]}...")
    if len(tools) > 10:
        print(f"  ... and {len(tools) - 10} more")

    # Step 1: Basic greeting
    log_step(1, "Basic Greeting")
    message = "Hello! Can you hear me?"
    log_send(message)

    result = await send_chat_stream(session_id, message)
    results.append({"step": 1, "name": "greeting", "result": result})

    if result["success"] and result["content"]:
        log_receive(result["content"])
        log_success("Got response")
    else:
        log_error(f"Failed: {result.get('error', 'No content')}")

    log_info(f"Model used: {result.get('model_id', 'unknown')}")
    log_info(f"Events received: {result.get('events', [])}")

    # Small delay between messages
    await asyncio.sleep(1)

    # Step 2: Ask about tools
    log_step(2, "Tool Awareness Check")
    message = "What tools do you have access to? List them briefly."
    log_send(message)

    result = await send_chat_stream(session_id, message)
    results.append({"step": 2, "name": "tool_awareness", "result": result})

    if result["success"] and result["content"]:
        log_receive(result["content"])
        # Check if response mentions tools
        content_lower = result["content"].lower()
        if any(word in content_lower for word in ["tool", "search", "web", "fetch", "browser"]):
            log_success("Response mentions tools")
        else:
            log_error("Response does NOT mention tools - may not have tool awareness")
    else:
        log_error(f"Failed: {result.get('error', 'No content')}")

    await asyncio.sleep(1)

    # Step 3: Direct tool invocation
    log_step(3, "Tool Invocation Test (Web Search)")
    message = "Search the web for 'latest cricket news 2025' and tell me one headline."
    log_send(message)

    result = await send_chat_stream(session_id, message)
    results.append({"step": 3, "name": "tool_invocation", "result": result})

    log_info(f"Events received: {result.get('events', [])}")

    if result["tool_calls"]:
        log_success(f"Tool calls detected: {len(result['tool_calls'])}")
        for tc in result["tool_calls"]:
            print(f"    - Tool: {tc.get('name', 'unknown')}")
            print(f"      Arguments: {tc.get('arguments', {})}")
    else:
        log_error("NO tool calls detected - model did not invoke tools")

    if result["tool_results"]:
        log_success(f"Tool results received: {len(result['tool_results'])}")
        for tr in result["tool_results"]:
            tool_name = tr.get('tool_name', 'unknown')
            has_output = tr.get('output') is not None
            has_error = tr.get('error') is not None
            status = "[OK]" if has_output and not has_error else "[ERR]" if has_error else "[?]"
            print(f"    - {tool_name}: {status}")
            if has_error:
                print(f"      Error: {tr.get('error')}")
    else:
        log_error("NO tool results received")

    if result["success"] and result["content"]:
        log_receive(result["content"])

    await asyncio.sleep(1)

    # Step 4: Follow-up with browser
    log_step(4, "Browser Tool Test")
    message = "Browse to https://example.com and tell me what the page title is."
    log_send(message)

    result = await send_chat_stream(session_id, message)
    results.append({"step": 4, "name": "browser_invocation", "result": result})

    log_info(f"Events received: {result.get('events', [])}")

    if result["tool_calls"]:
        log_success(f"Tool calls detected: {len(result['tool_calls'])}")
        for tc in result["tool_calls"]:
            print(f"    - Tool: {tc.get('name', 'unknown')}")
    else:
        log_error("NO tool calls detected")

    if result["tool_results"]:
        log_success(f"Tool results received: {len(result['tool_results'])}")
    else:
        log_error("NO tool results received")

    if result["success"] and result["content"]:
        log_receive(result["content"])

    # Final Summary
    log_step(5, "Test Summary")

    passed = 0
    failed = 0

    for r in results:
        name = r["name"]
        res = r["result"]

        if res["success"]:
            passed += 1
            status = f"{Colors.GREEN}PASS{Colors.ENDC}"
        else:
            failed += 1
            status = f"{Colors.RED}FAIL{Colors.ENDC}"

        tool_info = ""
        if res.get("tool_calls"):
            tool_names = [tc.get("name", "unknown") for tc in res["tool_calls"]]
            tool_info = f" (tools: {', '.join(tool_names)})"

        print(f"  {status} Step {r['step']}: {name}{tool_info}")

    print(f"\n{Colors.BOLD}Results: {passed} passed, {failed} failed{Colors.ENDC}")

    # Detailed output file
    output_file = f"test-result-{session_id}.json"
    with open(output_file, "w") as f:
        json.dump({
            "session_id": session_id,
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
            "api_base": API_BASE,
            "agent_base": AGENT_BASE,
            "available_tools": [t.get("name") for t in tools],
            "steps": results,
            "summary": {
                "passed": passed,
                "failed": failed,
                "total": len(results)
            }
        }, f, indent=2, default=str)

    log_info(f"Detailed results saved to: {output_file}")

    return failed == 0


async def run_direct_test():
    """Run a quick test directly against the agent."""
    session_id = f"direct-{uuid4().hex[:8]}"

    print(f"\n{Colors.BOLD}RawClaw Direct Agent Test{Colors.ENDC}")
    print(f"Session ID: {session_id}")
    print(f"Target: {AGENT_EXECUTE_URL}")

    # Check if agent is reachable
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{AGENT_BASE}/health")
            if resp.status_code == 200:
                log_info("Agent is healthy")
            else:
                log_error(f"Agent returned status {resp.status_code}")
                return False
    except Exception as e:
        log_error(f"Cannot connect to agent: {e}")
        print(f"\n{Colors.YELLOW}Start the agent first:{Colors.ENDC}")
        print(f"  cd apps/agent && python -m src.main")
        return False

    # Test 1: Basic greeting
    log_step(1, "Direct Agent - Basic Greeting")
    message = "Hello!"
    log_send(message)
    result = await test_agent_direct(session_id, message)

    if result["success"]:
        log_receive(result["content"])
        log_success("Got response")
    else:
        log_error(f"Failed: {result.get('error')}")

    log_info(f"Events: {result.get('events', [])}")

    await asyncio.sleep(1)

    # Test 2: Tool invocation
    log_step(2, "Direct Agent - Tool Invocation")
    message = "Search the web for 'OpenAI'"
    log_send(message)
    result = await test_agent_direct(session_id, message)

    log_info(f"Events: {result.get('events', [])}")

    if result["tool_calls"]:
        log_success(f"Tool calls: {len(result['tool_calls'])}")
        for tc in result["tool_calls"]:
            print(f"  - {tc.get('name')}: {tc.get('arguments', {})}")
    else:
        log_error("No tool calls!")

    if result["tool_results"]:
        log_success(f"Tool results: {len(result['tool_results'])}")
        for tr in result["tool_results"]:
            error = tr.get('error')
            print(f"  - {tr.get('tool_name')}: {'[ERR] ' + error if error else '[OK]'}")
    else:
        log_error("No tool results!")

    if result["content"]:
        log_receive(result["content"])

    # Save results
    output_file = f"test-direct-{session_id}.json"
    with open(output_file, "w") as f:
        json.dump({
            "session_id": session_id,
            "results": {"greeting": result}
        }, f, indent=2, default=str)
    log_info(f"Saved to: {output_file}")

    return result["success"]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test RawClaw conversation flow")
    parser.add_argument("--direct", action="store_true", help="Test agent directly (bypasses API)")
    parser.add_argument("--model", default="ollama/qwen2.5:1.5b", help="Model to use")
    args = parser.parse_args()

    try:
        if args.direct:
            success = asyncio.run(run_direct_test())
        else:
            success = asyncio.run(run_test())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Test interrupted by user{Colors.ENDC}")
        sys.exit(130)
    except Exception as e:
        log_error(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
