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
import re
import sys
import time
from typing import List, Dict, Any, Optional
from uuid import uuid4

import httpx

API_BASE = "http://localhost:3000/api"
DEFAULT_MODEL = "ollama/llama3.2:3b"
AUTH_SECRET = "Kuki7816"
TODAY_ISO = time.strftime("%Y-%m-%d")
BANNED_STRINGS = [
    '{"name":',
    "<tool_code>",
    "</think>",
    "<invoke",
    "<minimax:tool_call>",
]
SEARCH_TOOL_NAMES = ["web_search", "duckduckgo_search", "web-search", "google:search", "smart_search", "iask-search"]

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


def _content_lower(text: str) -> str:
    return (text or "").lower()


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").lower())


def _keyword_present(content: str, keyword: str) -> bool:
    content_lower = _content_lower(content)
    keyword_lower = _content_lower(keyword)
    if keyword_lower in content_lower:
        return True
    if _compact_text(keyword) in _compact_text(content):
        return True

    parts = [part for part in re.split(r"\s+", keyword_lower.strip()) if part]
    if len(parts) >= 2 and all(part in content_lower for part in parts):
        return True

    return False


def _contains_any_keyword(content: str, keywords: List[str]) -> bool:
    return any(_keyword_present(content, keyword) for keyword in keywords)


def _tool_names_from_result(res: Dict[str, Any]) -> List[str]:
    names = []
    for item in res.get("tool_calls", []):
        name = (item or {}).get("name")
        if name:
            names.append(name)
    for item in res.get("tool_results", []):
        if not isinstance(item, dict):
            continue
        name = item.get("tool_name") or item.get("name")
        if name:
            names.append(name)
    return names


def _has_any_tool(res: Dict[str, Any], expected: List[str]) -> bool:
    names = set(_tool_names_from_result(res))
    return any(name in names for name in expected)


def _has_tool(res: Dict[str, Any], expected: str) -> bool:
    return _has_any_tool(res, [expected])


def _has_all_tools(res: Dict[str, Any], expected_groups: List[List[str] | str]) -> bool:
    for group in expected_groups:
        if isinstance(group, str):
            if not _has_tool(res, group):
                return False
        else:
            if not _has_any_tool(res, group):
                return False
    return True


def _contains_repeated_noise(text: str) -> bool:
    lowered = _content_lower(text)
    noisy_markers = [
        "click here to follow all the live action",
        "what are cookies",
        "privacy policy",
        "terms & conditions",
        "official digital streaming partner",
        "related videos",
        "view all",
    ]
    return sum(1 for marker in noisy_markers if marker in lowered) >= 2


def _looks_like_raw_html_dump(text: str) -> bool:
    lowered = _content_lower(text)
    html_markers = ["<html", "<body", "<div", "<script", "</html>", "</body>"]
    return any(marker in lowered for marker in html_markers)


def _looks_like_generic_filler(text: str) -> bool:
    lowered = _content_lower(text).strip()
    generic_fillers = [
        "what can i help you with today?",
        "please rephrase your request",
        "let me know if you'd like",
    ]
    return any(phrase in lowered for phrase in generic_fillers)


def validate_response(tc: Dict[str, Any], res: Dict[str, Any]) -> List[str]:
    reasons = []
    content = res.get("content", "")
    content_lower = _content_lower(content)
    allow_direct_reasoning = tc.get("allow_direct_reasoning", False)
    direct_reasoning_markers = tc.get("direct_reasoning_markers", ["design", "safe", "security", "tool"])
    has_direct_reasoning_signal = (
        allow_direct_reasoning
        and len(content.strip()) > 80
        and sum(1 for marker in direct_reasoning_markers if marker in content_lower) >= 2
    )

    if tc.get("require_non_empty") and not content.strip():
        if not (tc.get("expect_approval") and not tc.get("auto_approve")):
            reasons.append("Response content is empty")

    if tc.get("require_non_trivial"):
        if len(content.strip()) < 20 or "cannot access" in content_lower:
            reasons.append("Response is trivial or a refusal")

    if tc.get("require_non_garbage") and _looks_like_generic_filler(content):
        reasons.append("Response reset into generic filler")

    for keyword in tc.get("check", []):
        if keyword == "2026-04-23":
            if "2026-04-23" not in content_lower and "april 23, 2026" not in content_lower:
                reasons.append(f"Missing date: {keyword}")
        elif not _keyword_present(content, keyword):
            reasons.append(f"Missing keyword: {keyword}")

    for keyword in tc.get("not_check", []):
        if _keyword_present(content, keyword):
            reasons.append(f"Forbidden keyword found: {keyword}")

    for banned in tc.get("banned_strings", BANNED_STRINGS):
        if banned.lower() in content_lower:
            reasons.append(f"RAW LEAKAGE DETECTED: Found {banned}")

    if "tool" in tc and not _has_tool(res, tc["tool"]):
        reasons.append(f"Required tool '{tc['tool']}' not called")

    if "tool_any" in tc and not _has_any_tool(res, tc["tool_any"]) and not has_direct_reasoning_signal:
        reasons.append(f"None of required tools {tc['tool_any']} were called")

    if "tool_all" in tc and not _has_all_tools(res, tc["tool_all"]):
        reasons.append(f"Not all required tool groups were called: {tc['tool_all']}")

    if tc.get("require_thinking"):
        has_reasoning_signal = bool(res.get("thinking")) or _has_tool(res, "sequential_thinking")
        if not has_reasoning_signal and has_direct_reasoning_signal:
            has_reasoning_signal = True
        if not has_reasoning_signal:
            reasons.append("No thinking events or sequential_thinking tool detected")

    if tc.get("expect_approval") and not tc.get("auto_approve"):
        if not res.get("approval_requested"):
            reasons.append("Approval was expected but not requested")

    if tc.get("accept_auto_approval_as_expected") and tc.get("expect_approval"):
        if not (res.get("approval_requested") or tc.get("auto_approve")):
            reasons.append("Approval flow was expected but not observed")

    if tc.get("mention_any"):
        if not _contains_any_keyword(content, tc["mention_any"]):
            reasons.append(f"None of expected interpretations found: {tc['mention_any']}")

    if tc.get("require_unknown_response"):
        unknown_markers = tc.get(
            "unknown_markers",
            ["don't have", "do not have", "no record", "not have", "don't know", "cannot determine", "not available"],
        )
        if not _contains_any_keyword(content, unknown_markers):
            reasons.append("Response should clearly indicate the information is unknown or unavailable")

    if tc.get("workspace_any"):
        if not _contains_any_keyword(content, tc["workspace_any"]):
            reasons.append(f"Response did not reference expected workspace markers: {tc['workspace_any']}")

    if tc.get("explicit_failure_ok"):
        failure_markers = tc.get("explicit_failure_markers", ["failed", "unable", "couldn't", "cannot"])
        if not content.strip() and not any(marker in content_lower for marker in failure_markers):
            reasons.append("Expected a truthful explicit failure, but response was empty")

    if tc.get("clean_fetch_expected"):
        if _looks_like_raw_html_dump(content):
            reasons.append("Response appears to contain raw HTML dump")
        if _contains_repeated_noise(content):
            reasons.append("Response appears dominated by navigation/footer noise")

    return reasons


async def run_single_test(
    index: int,
    total_steps: int,
    tc: Dict[str, Any],
    token: str,
    agent_id: str,
    default_session_id: str,
) -> Dict[str, Any]:
    log_step(index, tc["phase"], tc["title"], total_steps)

    current_session = default_session_id
    if "new_session" in tc:
        current_session = f"eval-{tc['new_session']}-{uuid4().hex[:4]}"
        log_info(f"Switching to isolated session: {current_session}")

    if "inject" in tc:
        await add_test_memory(token, tc["inject"])

    log_send(tc["msg"])
    res = await send_chat(
        current_session,
        tc["msg"],
        agent_id,
        token,
        expect_approval=tc.get("expect_approval", False),
        auto_approve=tc.get("auto_approve", False),
    )

    if res["error"]:
        log_error(f"Error: {res['error']}")
        return {
            "step": index,
            "phase": tc["phase"],
            "title": tc["title"],
            "passed": False,
            "error": res["error"],
        }

    log_recv(res["content"], res["total_time"])
    reasons = []

    if tc.get("is_setup"):
        log_success("Setup step completed.")
    else:
        reasons.extend(validate_response(tc, res))

    if tc.get("verify_agent_created_name"):
        agents = await list_agents(token)
        expected_name = tc["verify_agent_created_name"]
        if not any((agent or {}).get("name") == expected_name for agent in agents):
            reasons.append(f"Agent was not actually persisted via API: {expected_name}")
        if tc.get("verify_agent_has_skill"):
            expected_skill = tc["verify_agent_has_skill"]
            matched = next(((agent or {}) for agent in agents if (agent or {}).get("name") == expected_name), None)
            if not matched or expected_skill not in (matched.get("skills") or []):
                reasons.append(f"Agent '{expected_name}' was not assigned expected skill: {expected_skill}")

    if tc.get("verify_task_created_name"):
        tasks = await list_tasks(token)
        expected_name = tc["verify_task_created_name"]
        if not any((task or {}).get("name") == expected_name for task in tasks):
            reasons.append(f"Task was not actually persisted via API: {expected_name}")

    passed = not reasons
    if tc.get("informational_only"):
        passed = True
        note = tc.get("info_note")
        if note:
            reasons.insert(0, note)

    if passed:
        log_success("Response validated." if not tc.get("informational_only") else "Informational check completed.")
    else:
        for reason in reasons:
            log_info(f"Validation Note: {reason}")
        log_info("Validation failed.")

    return {
        "step": index,
        "phase": tc["phase"],
        "title": tc["title"],
        "passed": passed,
        "latency": res["total_time"],
        "tool_calls": len(res["tool_calls"]),
        "thinking": len(res["thinking"]),
        "reasons": reasons,
        "session_id": current_session,
        "content": res["content"],
    }


async def run_multi_turn_test(
    index: int,
    total_steps: int,
    tc: Dict[str, Any],
    token: str,
    agent_id: str,
) -> Dict[str, Any]:
    log_step(index, tc["phase"], tc["title"], total_steps)
    current_session = f"eval-{tc.get('session_label', 'multi-turn')}-{uuid4().hex[:4]}"
    log_info(f"Using multi-turn session: {current_session}")

    turns = []
    reasons = []
    total_latency = 0.0

    for turn_index, turn in enumerate(tc["conversation"], 1):
        log_send(turn["msg"])
        res = await send_chat(
            current_session,
            turn["msg"],
            agent_id,
            token,
            expect_approval=turn.get("expect_approval", False),
            auto_approve=turn.get("auto_approve", False),
        )
        if res["error"]:
            log_error(f"Error: {res['error']}")
            reasons.append(f"Turn {turn_index} error: {res['error']}")
            turns.append({"content": "", "error": res["error"], "tool_calls": [], "tool_results": [], "thinking": []})
            break

        total_latency += res["total_time"]
        log_recv(res["content"], res["total_time"])
        turn_reasons = validate_response(turn, res)
        for reason in turn_reasons:
            reasons.append(f"Turn {turn_index}: {reason}")
        turns.append(res)

    allow_topic_check = True
    if not reasons and tc.get("follow_up_topic_any"):
        first_turn_failed_truthfully = False
        if turns:
            first_content = _content_lower(turns[0].get("content", ""))
            failure_markers = tc.get("follow_up_failure_any", ["search failed", "failed", "unable", "couldn't", "didn't work", "rate limited", "no information", "no updates"])
            first_turn_failed_truthfully = any(marker in first_content for marker in failure_markers)

        if first_turn_failed_truthfully:
            for turn_index, res in enumerate(turns[1:], 2):
                content = _content_lower(res.get("content", ""))
                if not any(marker in content for marker in tc.get("follow_up_failure_any", [])):
                    reasons.append(f"Turn {turn_index}: Follow-up did not stay consistent with the earlier search failure")
            allow_topic_check = False

    if not reasons and tc.get("follow_up_topic_any") and allow_topic_check:
        for turn_index, res in enumerate(turns[1:], 2):
            content = _content_lower(res.get("content", ""))
            if not any(term.lower() in content for term in tc["follow_up_topic_any"]):
                reasons.append(f"Turn {turn_index}: Follow-up drifted off topic")

    passed = not reasons
    if passed:
        log_success("Response validated.")
    else:
        for reason in reasons:
            log_info(f"Validation Note: {reason}")
        log_info("Validation failed.")

    return {
        "step": index,
        "phase": tc["phase"],
        "title": tc["title"],
        "passed": passed,
        "latency": total_latency,
        "tool_calls": sum(len(turn.get("tool_calls", [])) for turn in turns),
        "thinking": sum(len(turn.get("thinking", [])) for turn in turns),
        "reasons": reasons,
        "session_id": current_session,
    }

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
        "skills": ["grounded-web-summary", "repo-explainer"],
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


async def list_agents(token: str) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{API_BASE}/agents", headers=headers, timeout=15.0)
            if resp.status_code in (200, 201):
                return resp.json()
    except Exception:
        pass
    return []


async def list_tasks(token: str) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{API_BASE}/tasks", headers=headers, timeout=15.0)
            if resp.status_code in (200, 201):
                return resp.json()
    except Exception:
        pass
    return []

async def send_chat(
    session_id: str, 
    message: str, 
    agent_id: str, 
    token: str,
    expect_approval: bool = False,
    auto_approve: bool = False
) -> Dict[str, Any]:
    """Send chat message and collect response."""
    
    async def auto_approve_poller():
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient() as client:
                while True:
                    try:
                        resp = await client.get(f"{API_BASE}/tools/confirm?sessionId={session_id}", headers=headers, timeout=5.0)
                        if resp.status_code == 200:
                            pending = resp.json()
                            for p in pending:
                                if p.get("status") == "pending":
                                    await client.post(f"{API_BASE}/tools/confirm/{p['id']}/approve", headers=headers, timeout=5.0)
                                    log_info(f"Auto-approved tool call: {p.get('toolName')}")
                    except Exception:
                        pass
                    await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass

    result = {
        "content": "",
        "thinking": [],
        "tool_calls": [],
        "tool_results": [],
        "ttft": 0,
        "total_time": 0,
        "success": False,
        "error": None,
        "approval_requested": False
    }
    
    headers = {"Authorization": f"Bearer {token}"}
    start_time = time.time()
    
    poller_task = None
    if auto_approve:
        poller_task = asyncio.create_task(auto_approve_poller())
    
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
                                tr = data.get("tool_result", {})
                                result["tool_results"].append(tr)
                                t_name = tr.get("tool_name", "Unknown")
                                t_err = tr.get("error")
                                if t_err:
                                    log_info(f"Tool Result ({t_name}): Error - {t_err[:50]}")
                                else:
                                    out_len = len(str(tr.get("output", "")))
                                    log_info(f"Tool Result ({t_name}): Success ({out_len} chars output)")
                                    
                            elif etype == "approval_required":
                                result["approval_requested"] = True
                                log_info(f"Tool approval requested: {data.get('reason', '')}")
                                if expect_approval and not auto_approve:
                                    result["success"] = True
                                    return result
                                
                            elif etype == "error":
                                result["error"] = data.get("message")
                                
                            elif etype == "done":
                                result["success"] = True
                                
                        except json.JSONDecodeError:
                            continue
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)}"
    finally:
        if poller_task:
            poller_task.cancel()
        
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
    await add_test_memory(token, "PROJECT_VANGUARD: The project identifier is 'X-DELTA-9-GHOST'.")
    await add_test_memory(token, "RawClaw's system kernel was initialized by Operator-X on January 15th, 2026.")
    await add_test_memory(token, "The current mission objective for RawClaw is 'Autonomous Workspace Mastery'.")

    session_id = f"eval-{uuid4().hex[:8]}"
    unique_task_name = f"Workspace Review {uuid4().hex[:6]}"
    unique_agent_name = f"Research Agent {uuid4().hex[:6]}"
    log_info(f"Session: {session_id}")
    log_info(f"Model:   {model_to_use}")

    test_cases = [
        # Phase 1: Identity & System Awareness
        {
            "phase": "Identity",
            "title": "System Role",
            "msg": "Identify yourself. What is your name, your purpose, and which system do you reside in?",
            "check": ["rawclaw", "agent"],
            "require_non_garbage": True,
        },
        {
            "phase": "Memory",
            "title": "RAG Recall",
            "msg": "According to your records, what is the identifier associated with PROJECT_VANGUARD?",
            "check": ["X-DELTA-9-GHOST"]
        },
        # Short-Term Memory (Multi-turn)
        {
            "phase": "Memory",
            "title": "Short-Term Memory",
            "msg": "My favorite color is teal.",
            "is_setup": True,
            "check": []
        },
        {
            "phase": "Memory",
            "title": "Short-Term Recall",
            "msg": "What color did I just say was my favorite?",
            "check": ["teal"]
        },
        {
            "phase": "Knowledge",
            "title": "General Knowledge: Ada Lovelace",
            "msg": "Who is Ada Lovelace?",
            "check": ["Ada Lovelace"],
            "require_non_empty": True,
            "require_non_garbage": True,
        },
        {
            "phase": "Knowledge",
            "title": "Wikipedia-Style Summary: Alan Turing",
            "msg": "Use Wikipedia to give me a short summary of Alan Turing.",
            "check": ["Alan Turing"],
            "require_non_empty": True,
            "require_non_garbage": True,
        },
        # Session Isolation
        {
            "phase": "Isolation",
            "title": "Session A Setup",
            "msg": "My codename is ORBIT-7.",
            "new_session": "session-a",
            "is_setup": True,
            "check": []
        },
        {
            "phase": "Isolation",
            "title": "Session B Isolation",
            "msg": "What is my codename?",
            "new_session": "session-b",
            "not_check": ["ORBIT-7", "my codename is rawclaw", "codename is rawclaw"],
            "require_unknown_response": True,
        },
        # System Awareness
        {
            "phase": "System",
            "title": "Current Date/Time",
            "msg": "What is the current local date and time?",
            "tool": "get_datetime",
            "check": [TODAY_ISO],
        },
        {
            "phase": "System",
            "title": "File Read",
            "msg": "Read the contents of README.md and summarize it.",
            "tool": "read_file",
            "expect_approval": True,
            "auto_approve": True,
            "accept_auto_approval_as_expected": True,
            "require_non_empty": True,
        },
        {
            "phase": "System",
            "title": "Directory Listing",
            "msg": "List the top-level files and folders in the workspace.",
            "tool": "list_dir",
            "require_non_empty": True,
            "workspace_any": ["apps", "scripts", "packages", "README", "package.json"],
        },
        {
            "phase": "Skills",
            "title": "Skill Use: Repository Explanation",
            "msg": "Give me a concise repository walkthrough of this workspace and call out the most important modules.",
            "tool": "skill_repo-explainer",
            "require_non_empty": True,
            "require_non_garbage": True,
            "workspace_any": ["apps", "api", "agent", "web"],
        },
        # Advanced Reasoning
        {
            "phase": "Reasoning",
            "title": "Sequential Thinking",
            "msg": "Think step by step: how would you design a safe tool-execution agent?",
            "tool_any": ["sequential_thinking"],
            "require_thinking": True,
            "allow_direct_reasoning": True,
            "direct_reasoning_markers": ["design", "safe", "security", "tool"],
        },
        # Web Tools
        {
            "phase": "Web",
            "title": "Web Search",
            "msg": "Search the web for the latest news about SpaceX Starship and summarize it.",
            "tool_any": ["web_search", "duckduckgo_search"],
            "require_non_empty": True,
            "require_non_garbage": True,
            "not_check": ["<tool_code>", "<invoke", "<minimax:tool_call>"],
        },
        {
            "phase": "Web",
            "title": "Web Fetch",
            "msg": "Open https://auranixdigital.com/ and summarize the page.",
            "tool": "web_fetch",
            "require_non_trivial": True,
            "clean_fetch_expected": True,
            "not_check": ["<tool_code>", "<invoke", "<minimax:tool_call>"],
        },
        {
            "phase": "Web",
            "title": "Web Search Grounding",
            "msg": "Search the web for the latest IPL 2026 Chennai Super Kings news and summarize it in 3 bullets.",
            "tool_any": SEARCH_TOOL_NAMES,
            "require_non_empty": True,
            "require_non_garbage": True,
            "not_check": ["placeholder only", "no immediate problem found", "viewing ad", "tickets ad", "ad                                   viewing"],
        },
        {
            "phase": "Web",
            "title": "Official Page Fetch Classification",
            "msg": "Open the official IPL points table page and tell me whether it contains actual standings or placeholder data.",
            "tool": "web_fetch",
            "require_non_empty": True,
            "mention_any": ["placeholder", "incomplete", "standings", "table"],
        },
        {
            "phase": "Web",
            "title": "Clean Fetch Rendering",
            "msg": "Fetch a webpage and show me the main content only, not navigation or footer noise. Use https://auranixdigital.com/.",
            "tool": "web_fetch",
            "require_non_empty": True,
            "clean_fetch_expected": True,
        },
        # Multi-turn Tooling
        {
            "phase": "Continuity",
            "title": "Tool Follow-Up",
            "msg": "Search the web for the latest IPL news and then give me a 3-bullet summary.",
            "tool_any": ["web_search", "duckduckgo_search"],
            "require_non_empty": True,
            "not_check": ["<tool_code>", "<invoke", "<minimax:tool_call>"],
        },
        {
            "phase": "Continuity",
            "title": "Search Then Follow-Up",
            "multi_turn": True,
            "session_label": "spaceX-follow-up",
            "follow_up_topic_any": ["starship", "spacex", "rocket", "launch", "flight"],
            "follow_up_failure_any": ["search failed", "failed", "unable", "couldn't", "didn't work", "i was unable", "i don't have", "i couldnt find", "no information", "no updates", "not retrieved"],
            "conversation": [
                {
                    "msg": "Search the web for SpaceX Starship latest updates.",
                    "tool_any": SEARCH_TOOL_NAMES,
                    "require_non_empty": True,
                    "require_non_garbage": True,
                },
                {
                    "msg": "Now give me only the most important takeaway from what you just found.",
                    "require_non_empty": True,
                    "require_non_garbage": True,
                },
                {
                    "msg": "Summarize that in one sentence for a non-technical person.",
                    "require_non_empty": True,
                    "require_non_garbage": True,
                },
            ],
        },
        {
            "phase": "Tasks",
            "title": "Task Creation",
            "msg": f"Create a task named '{unique_task_name}' to review the workspace status tomorrow.",
            "require_non_empty": True,
            "require_non_garbage": True,
            "verify_task_created_name": unique_task_name,
        },
        {
            "phase": "Agents",
            "title": "Agent Creation",
            "msg": f"Create an agent called '{unique_agent_name}' that focuses on web research and grounded summaries.",
            "require_non_empty": True,
            "require_non_garbage": True,
            "verify_agent_created_name": unique_agent_name,
            "verify_agent_has_skill": "grounded-web-summary",
        },
        {
            "phase": "Agents",
            "title": "Agent Use After Creation",
            "msg": f"Switch to the agent '{unique_agent_name}' and search the web for the latest OpenAI API updates.",
            "tool_all": [SEARCH_TOOL_NAMES, ["skill_grounded-web-summary"]],
            "require_non_empty": True,
            "require_non_garbage": True,
        },
        # Advanced RAG
        {
            "phase": "RAG",
            "title": "Explicit RAG Fact",
            "inject": "Operation NIGHTGLASS uses access token 'SIGMA-44'.",
            "msg": "According to your records, what access token does Operation NIGHTGLASS use?",
            "check": ["SIGMA-44"],
        },
        {
            "phase": "RAG",
            "title": "RAG vs General Knowledge",
            "inject": "For internal testing, PROJECT_ATLAS launch date is 2031-01-01.",
            "msg": "According to your records, when is PROJECT_ATLAS scheduled?",
            "check": ["2031-01-01"],
        },
        {
            "phase": "Isolation",
            "title": "Session Isolation Repeat A",
            "msg": "My codename is ORBIT-7.",
            "new_session": "session-repeat-a",
            "is_setup": True,
        },
        {
            "phase": "Isolation",
            "title": "Session Isolation Repeat B",
            "msg": "What is my codename?",
            "new_session": "session-repeat-b",
            "not_check": ["ORBIT-7", "my codename is rawclaw", "codename is rawclaw"],
            "require_non_empty": True,
            "require_unknown_response": True,
        },
        {
            "phase": "Memory",
            "title": "Memory Scope Check",
            "msg": "What is my favorite color?",
            "require_non_empty": True,
            "informational_only": True,
            "info_note": "Observed cross-session memory scope; review content manually against desired product behavior.",
        },
    ]

    results = []
    log_header("Running Test Suite")
    
    for i, tc in enumerate(test_cases, 1):
        if tc.get("multi_turn"):
            result = await run_multi_turn_test(i, len(test_cases), tc, token, agent_id)
        else:
            result = await run_single_test(i, len(test_cases), tc, token, agent_id, session_id)

        results.append(result)

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
