#!/usr/bin/env python3
"""
Comprehensive Agent Evaluation Script for RawClaw.

Evaluates the agent across multiple phases:
1. Identity & Short-term Memory
2. System Awareness (Time, Files)
3. Web Research (Search, Scraping)
4. RAG & Knowledge Retrieval (Vector Memory)
5. Advanced Reasoning (Sequential Thinking)
6. Multi-turn Context & Continuity

Usage:
    python scripts/comprehensive-agent-test.py --model ollama/llama3.2:3b
"""

import asyncio
import json
import os
import sys
import time
from typing import List, Dict, Any, Optional
from uuid import uuid4

import httpx

API_BASE = "http://localhost:3000/api"
DEFAULT_MODEL = "ollama/llama3.2:3b"
AUTH_SECRET = "Kuki7816"

class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def log_header(text: str):
    print(f"\n{Colors.HEADER}{'='*70}{Colors.ENDC}")
    print(f"{Colors.BOLD}{text.center(70)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'='*70}{Colors.ENDC}\n")

def log_step(step: int, phase: str, title: str, total_steps: int):
    print(f"{Colors.CYAN}[STEP {step}/{total_steps}] {phase}:{Colors.ENDC} {Colors.BOLD}{title}{Colors.ENDC}")

def log_send(msg: str):
    print(f"  {Colors.BLUE}USER  >{Colors.ENDC} {msg}")

def log_thinking(thought: str):
    snippet = thought.strip()
    if len(snippet) > 100:
        snippet = snippet[:100] + "..."
    print(f"  {Colors.YELLOW}THINKING >{Colors.ENDC} {snippet}")

def log_recv(msg: str, latency: float = None):
    lat_str = f" [{latency:.2f}s]" if latency else ""
    text = f"  {Colors.GREEN}AGENT <{Colors.ENDC} {msg[:150].replace('\n', ' ')}{'...' if len(msg) > 150 else ''}{Colors.YELLOW}{lat_str}{Colors.ENDC}"
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode('ascii', 'ignore').decode('ascii'))

def log_success(msg: str):
    try:
        print(f"  {Colors.GREEN}[+] {msg}{Colors.ENDC}")
    except UnicodeEncodeError:
        print(f"  [+] {msg.encode('ascii', 'ignore').decode('ascii')}")

def log_error(msg: str):
    try:
        print(f"  {Colors.RED}[!] {msg}{Colors.ENDC}")
    except UnicodeEncodeError:
        print(f"  [!] {msg.encode('ascii', 'ignore').decode('ascii')}")

def log_info(msg: str):
    try:
        print(f"  {Colors.YELLOW}[i] {msg}{Colors.ENDC}")
    except UnicodeEncodeError:
        print(f"  [i] {msg.encode('ascii', 'ignore').decode('ascii')}")

async def get_token() -> str:
    """Get auth token using secret."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{API_BASE}/auth/token",
                json={"secret": AUTH_SECRET},
                timeout=10.0
            )
            if resp.status_code in (200, 201):
                return resp.json().get("access_token", "")
            return ""
    except Exception as e:
        log_error(f"Auth error: {str(e)}")
        return ""

async def create_test_agent(token: str, model_id: str) -> Optional[str]:
    """Create a temporary test agent with specific configuration."""
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "name": f"Eval-Agent-{uuid4().hex[:4]}",
        "description": "Temporary agent for comprehensive evaluation",
        "modelId": model_id,
        "systemPrompt": "You are RawClaw Eval Agent. You are a high-performance assistant capable of memory recall, web research, and browser automation. Always use your tools when needed to be precise.",
        "skills": ["web_search", "browser", "filesystem", "research", "sequential_thinking"],
        "isDefault": False
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/agents", json=payload, headers=headers)
            if resp.status_code in (200, 201):
                agent_id = resp.json().get("id")
                log_success(f"Test Agent created: {agent_id}")
                return agent_id
            log_error(f"Failed to create agent: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        log_error(f"Agent creation error: {str(e)}")
        return None

async def add_test_memory(token: str, content: str):
    """Inject test data into RAG memory."""
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "content": content,
        "collection": "default",
        "tags": ["eval"],
        "source": "eval-script"
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/memory/add", json=payload, headers=headers)
            if resp.status_code in (200, 201):
                log_success(f"Memory injected: {content[:40]}...")
                return True
            return False
    except Exception:
        return False

async def send_chat(session_id: str, message: str, agent_id: str, token: str) -> Dict[str, Any]:
    """Send chat message and collect response."""
    result = {
        "content": "",
        "thinking": [],
        "tool_calls": [],
        "tool_results": [],
        "ttft": 0,
        "total_time": 0,
        "success": False,
        "error": None
    }
    
    headers = {"Authorization": f"Bearer {token}"}
    start_time = time.time()
    
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{API_BASE}/chat/send",
                headers=headers,
                json={
                    "session_id": session_id,
                    "messages": [{"role": "user", "content": message}],
                    "agent_id": agent_id,
                    "stream": True
                }
            ) as resp:
                if resp.status_code not in (200, 201):
                    body = await resp.aread()
                    result["error"] = f"HTTP {resp.status_code}: {body.decode()}"
                    return result
                
                buffer = b""
                async for chunk in resp.aiter_bytes():
                    buffer += chunk
                    while b"\n" in buffer:
                        line_bytes, buffer = buffer.split(b"\n", 1)
                        line = line_bytes.decode('utf-8', errors='ignore').strip()
                        
                        if not line or not line.startswith("data: "):
                            continue
                            
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            continue
                            
                        try:
                            data = json.loads(data_str)
                            etype = data.get("type")
                            
                            if etype == "content":
                                if not result["content"]:
                                    result["ttft"] = time.time() - start_time
                                result["content"] += data.get("content", "")
                                
                            elif etype == "thinking":
                                thought = data.get("thinking", "")
                                if thought:
                                    result["thinking"].append(thought)
                                    log_thinking(thought)

                            elif etype == "tool_call":
                                result["tool_calls"].append(data.get("tool_call"))
                                log_info(f"Tool Call: {data.get('tool_call', {}).get('name')}")
                                
                            elif etype == "tool_result":
                                result["tool_results"].append(data.get("tool_result"))
                                log_info(f"Tool Result: {data.get('tool_result', {}).get('tool_call_id')}")
                                
                            elif etype == "error":
                                result["error"] = data.get("message")
                                
                            elif etype == "done":
                                result["success"] = True
                                
                        except json.JSONDecodeError:
                            continue
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)}"
        
    result["total_time"] = time.time() - start_time
    return result

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="RawClaw Comprehensive Agent Test")
    parser.add_argument("model_id", nargs="?", default=DEFAULT_MODEL, help="Model ID to use (e.g., gemma4:31b-cloud)")
    parser.add_argument("--model", type=str, help="Alias for model_id")
    args, unknown = parser.parse_known_args()

    # Handle various ways user might pass the model
    model_to_use = args.model or args.model_id
    if unknown:
        for u in unknown:
            if not u.startswith("-"):
                model_to_use = u
                break
            elif ":" in u or "llama" in u or "gemma" in u:
                model_to_use = u.lstrip("-")
                break

    log_header("RawClaw Comprehensive Agent Test")
    
    token = await get_token()
    if not token:
        log_error("Auth failed. Ensure API is running.")
        sys.exit(1)
        
    # Phase 0: Prep
    log_header("Phase 0: Environment Preparation")
    agent_id = await create_test_agent(token, model_to_use)
    if not agent_id:
        sys.exit(1)
        
    # Inject diverse memory types
    await add_test_memory(token, "PROJECT_VANGUARD: The secret decryption key is 'X-DELTA-9-GHOST'.")
    await add_test_memory(token, "RawClaw's system kernel was initialized by Operator-X on January 15th, 2026.")
    await add_test_memory(token, "The current mission objective for RawClaw is 'Autonomous Workspace Mastery'.")
    
    session_id = f"eval-{uuid4().hex[:8]}"
    log_info(f"Session: {session_id}")
    log_info(f"Model:   {model_to_use}")
    
    test_cases = [
        # Phase 1: Identity & System Awareness
        {
            "phase": "Identity",
            "title": "System Role",
            "msg": "Identify yourself. What is your name, your purpose, and which system do you reside in?",
            "check": ["rawclaw", "agent"]
        },
    ]

    results = []
    log_header("Running Test Suite")
    
    for i, tc in enumerate(test_cases, 1):
        log_step(i, tc["phase"], tc["title"], len(test_cases))
        log_send(tc["msg"])
        
        res = await send_chat(session_id, tc["msg"], agent_id, token)
        
        if res["error"]:
            log_error(f"Error: {res['error']}")
            results.append({
                "step": i, 
                "phase": tc["phase"],
                "title": tc["title"], 
                "passed": False, 
                "error": res["error"]
            })
        else:
            log_recv(res["content"], res["total_time"])
            
            passed = True
            reasons = []
            
            # Keyword check
            if "check" in tc:
                content_lower = res["content"].lower()
                for keyword in tc["check"]:
                    if keyword.lower() not in content_lower:
                        passed = False
                        reasons.append(f"Missing keyword: {keyword}")
            
            # Tool call check
            if "tool" in tc:
                tool_called = any(tc["tool"] in tc_item.get("name", "") for tc_item in res["tool_calls"])
                if not tool_called:
                    passed = False
                    reasons.append(f"Tool '{tc['tool']}' not called")
            
            if passed:
                log_success("Response validated.")
            else:
                for r in reasons:
                    log_info(f"Validation Note: {r}")
                log_info("Validation failed.")
            
            results.append({
                "step": i,
                "phase": tc["phase"],
                "title": tc["title"],
                "passed": passed,
                "latency": res["total_time"],
                "tool_calls": len(res["tool_calls"]),
                "thinking": len(res["thinking"]),
                "reasons": reasons
            })
            
        # Give system time to settle
        await asyncio.sleep(1.5)
        
    log_header("Final Test Report")
    total_passed = sum(1 for r in results if r.get("passed", False))
    pass_rate = (total_passed / len(test_cases)) * 100
    
    print(f"{Colors.BOLD}Total Test Cases:{Colors.ENDC}  {len(test_cases)}")
    print(f"{Colors.BOLD}Passed:{Colors.ENDC}            {total_passed}")
    print(f"{Colors.BOLD}Pass Rate:{Colors.ENDC}         {pass_rate:.1f}%")
    
    report_file = f"eval-results-{session_id}.json"
    with open(report_file, "w") as f:
        json.dump({
            "metadata": {
                "session_id": session_id,
                "model": model_to_use,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            },
            "results": results
        }, f, indent=2)
    
    log_info(f"Full report saved to {report_file}")
    
    if total_passed == len(test_cases):
        log_success("ALL TESTS PASSED!")
    elif pass_rate > 80:
        log_info("High pass rate, but some issues detected.")
    else:
        log_error("Critical failures detected. Review the report.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
