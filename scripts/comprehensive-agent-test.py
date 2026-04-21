#!/usr/bin/env python3
"""
Comprehensive Agent Evaluation Script for RawClaw.

Evaluates the agent across 12 turns:
1-4: Normal Conversation & Memory Initializer
5-8: System Awareness & Memory Check
9-12: Tool Calling (Web Search, Sequential Thinking) & Reasoning

Usage:
    python scripts/comprehensive-agent-test.py --model minimax-m2.7:cloud
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
AGENT_BASE = "http://localhost:8001"
DEFAULT_MODEL = "minimax-m2.7:cloud"
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

def log_step(step: int, phase: str, title: str):
    print(f"{Colors.CYAN}[STEP {step}/12] {phase}:{Colors.ENDC} {Colors.BOLD}{title}{Colors.ENDC}")

def log_send(msg: str):
    print(f"  {Colors.BLUE}USER  >{Colors.ENDC} {msg}")

def log_recv(msg: str, latency: float = None):
    lat_str = f" [{latency:.2f}s]" if latency else ""
    print(f"  {Colors.GREEN}AGENT <{Colors.ENDC} {msg[:150]}{'...' if len(msg) > 150 else ''}{Colors.YELLOW}{lat_str}{Colors.ENDC}")

def log_success(msg: str):
    print(f"  {Colors.GREEN}✓ {msg}{Colors.ENDC}")

def log_error(msg: str):
    print(f"  {Colors.RED}✗ {msg}{Colors.ENDC}")

def log_info(msg: str):
    print(f"  {Colors.YELLOW}ℹ {msg}{Colors.ENDC}")

async def get_token() -> str:
    """Get auth token using secret."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{API_BASE}/auth/token",
                json={"secret": AUTH_SECRET}
            )
            if resp.status_code in (200, 201):
                return resp.json().get("access_token", "")
            return ""
    except Exception:
        return ""

async def send_chat(session_id: str, message: str, model: str, token: str) -> Dict[str, Any]:
    """Send chat message and collect response."""
    result = {
        "content": "",
        "tool_calls": [],
        "tool_results": [],
        "ttft": 0,
        "total_time": 0,
        "success": False,
        "error": None
    }
    
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    start_time = time.time()
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{API_BASE}/chat/send",
                headers=headers,
                json={
                    "session_id": session_id,
                    "messages": [{"role": "user", "content": message}],
                    "model": model,
                    "stream": True
                }
            ) as resp:
                if resp.status_code not in (200, 201):
                    result["error"] = f"HTTP {resp.status_code}"
                    return result
                
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                        
                    data_str = line[6:].strip()
                    if not data_str or data_str == "[DONE]":
                        continue
                        
                    try:
                        data = json.loads(data_str)
                        etype = data.get("type")
                        
                        if etype == "content":
                            if not result["content"]:
                                result["ttft"] = time.time() - start_time
                            result["content"] += data.get("content", "")
                            
                        elif etype == "tool_call":
                            result["tool_calls"].append(data.get("tool_call"))
                            
                        elif etype == "tool_result":
                            result["tool_results"].append(data.get("tool_result"))
                            
                        elif etype == "error":
                            result["error"] = data.get("message")
                            
                        elif etype == "done":
                            result["success"] = True
                            
                    except json.JSONDecodeError:
                        continue
    except Exception as e:
        result["error"] = str(e)
        
    result["total_time"] = time.time() - start_time
    return result

async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()
    
    log_header("RawClaw Comprehensive Agent Test")
    
    token = await get_token()
    if not token:
        log_error("Failed to get auth token. Ensure API is running and secret is correct.")
        sys.exit(1)
        
    session_id = f"eval-{uuid4().hex[:8]}"
    log_info(f"Session: {session_id}")
    log_info(f"Model:   {args.model}")
    
    test_cases = [
        # Phase 1: Normal Conversation
        {"phase": "Chat", "title": "Greeting & Identity", "msg": "Hello! I'm testing RawClaw today. My name is Sugam.", "check": ["hello", "sugam"]},
        {"phase": "Chat", "title": "Personality", "msg": "How are you? Tell me a short joke about AI.", "check": ["joke", "ai"]},
        {"phase": "Chat", "title": "Abstract Reasoning", "msg": "What is the meaning of life, according to a computer?", "check": ["meaning", "life", "42"]},
        {"phase": "Chat", "title": "Future/Platform", "msg": "What is the biggest challenge in building a local-first AI platform?", "check": ["privacy", "performance", "local"]},
        
        # Phase 2: System Awareness & Memory
        {"phase": "System", "title": "Tech Stack Check", "msg": "What is the core tech stack of RawClaw as per our project rules?", "check": ["nestjs", "fastapi", "react", "sqlite"]},
        {"phase": "System", "title": "Project Phase", "msg": "What phase of the rebuild are we currently in?", "check": ["phase", "rebuild"]},
        {"phase": "System", "title": "Component Logic", "msg": "Explain the role of 'apps/agent' in RawClaw.", "check": ["fastapi", "tools", "executor"]},
        {"phase": "System", "title": "Memory Check", "msg": "What was my name? Just checking if you remember.", "check": ["sugam"]},
        
        # Phase 3: Tools & Complex Reasoning
        {"phase": "Tools", "title": "Sequential Thinking", "msg": "Use sequential thinking to plan a simple 'Hello World' microservice in NestJS.", "tool": "sequential_thinking"},
        {"phase": "Tools", "title": "Web Search (Fresh Info)", "msg": "Search the web for the current versions of Next.js and FastAPI released in 2024 or 2025.", "tool": "web_search"},
        {"phase": "Tools", "title": "Contextual Fix", "msg": "I am having timeouts with 'docker-toolkit'. What should the timeout be set to according to our latest fix?", "check": ["300", "seconds"]},
        {"phase": "Tools", "title": "GitHub Research", "msg": "Search the web for a trending AI library on GitHub and summarize why it's popular.", "tool": "web_search"},
    ]
    
    results = []
    
    for i, tc in enumerate(test_cases, 1):
        log_step(i, tc["phase"], tc["title"])
        log_send(tc["msg"])
        
        res = await send_chat(session_id, tc["msg"], args.model, token)
        
        if res["error"]:
            log_error(f"Error: {res['error']}")
        else:
            log_recv(res["content"], res["total_time"])
            
            # Checks
            passed = True
            if "check" in tc:
                content_lower = res["content"].lower()
                for keyword in tc["check"]:
                    if keyword.lower() not in content_lower:
                        log_info(f"Missing keyword: {keyword}")
                        passed = False
            
            if "tool" in tc:
                tool_called = any(tc["tool"] in tc_item.get("name", "") for tc_item in res["tool_calls"])
                if not tool_called:
                    log_error(f"Tool {tc['tool']} was NOT called.")
                    passed = False
                else:
                    log_success(f"Tool {tc['tool']} called.")
            
            if passed:
                log_success("Response validated.")
            else:
                log_info("Validation incomplete or failed.")
            
            results.append({
                "step": i,
                "title": tc["title"],
                "passed": passed,
                "latency_total": res["total_time"],
                "latency_ttft": res["ttft"],
                "tool_calls": len(res["tool_calls"])
            })
            
        await asyncio.sleep(1) # Breath
        
    log_header("Test Summary")
    total_passed = sum(1 for r in results if r["passed"])
    avg_latency = sum(r["latency_total"] for r in results) / len(results) if results else 0
    
    print(f"Total Steps: {len(test_cases)}")
    print(f"Passed:      {total_passed}")
    print(f"Avg Latency: {avg_latency:.2f}s")
    
    output_path = f"eval-results-{session_id}.json"
    with open(output_path, "w") as f:
        json.dump({
            "session_id": session_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "model": args.model,
            "results": results,
            "summary": {
                "total": len(test_cases),
                "passed": total_passed,
                "avg_latency": avg_latency
            }
        }, f, indent=2)
    
    log_info(f"Detailed report saved to {output_path}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
