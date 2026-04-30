#!/usr/bin/env python3
"""
RawClaw combined chat session test.

Exercises broad chat behavior in a single session so we can validate:
- identity and memory continuity
- system/tool usage
- repo explanation skill
- reasoning
- web research and follow-up continuity
- task and agent creation
- message edit/resend
- document edit intent

This intentionally skips OCR/image-document coverage. OCR remains covered
by dedicated capability checks elsewhere.

Usage:
    python scripts/combined-chat-session-test.py gemma4:31b-cloud
"""

import asyncio
import json
import re
import sys
import time
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx

API_BASE = "http://localhost:3000/api"
DEFAULT_MODEL = "ollama/llama3.2:3b"
AUTH_SECRET = "Kuki7816"
TODAY_ISO = time.strftime("%Y-%m-%d")
SEARCH_TOOL_NAMES = ["web_search", "duckduckgo_search", "web-search", "google:search", "smart_search", "iask-search"]
FAILURE_MARKERS = [
    "search provider did not return usable results",
    "could not verify",
    "search failed",
    "unable to verify",
    "no reliable source",
    "provider failure",
    "outage",
]
BANNED_STRINGS = [
    '{"name":',
    "<tool_code>",
    "</think>",
    "<invoke",
    "<minimax:tool_call>",
    '>"tool":',
    ">sequential_thinking{",
    "</skill>",
    "|>user",
    "|>model",
]


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
    print(f"\n{Colors.HEADER}{'=' * 72}{Colors.ENDC}")
    print(f"{Colors.BOLD}{text.center(72)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'=' * 72}{Colors.ENDC}\n")


def log_step(step_num: int, title: str, total_steps: int):
    print(f"{Colors.CYAN}[STEP {step_num}/{total_steps}]{Colors.ENDC} {Colors.BOLD}{title}{Colors.ENDC}")


def log_send(msg: str):
    print(f"  {Colors.BLUE}USER  >{Colors.ENDC} {msg}")


def log_recv(msg: str, latency: float = None):
    lat_str = f" [{latency:.2f}s]" if latency else ""
    snippet = msg[:180].replace('\n', ' ')
    text = f"  {Colors.GREEN}AGENT <{Colors.ENDC} {snippet}{'...' if len(msg) > 180 else ''}{Colors.YELLOW}{lat_str}{Colors.ENDC}"
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode('ascii', 'ignore').decode('ascii'))


def log_success(msg: str):
    print(f"  {Colors.GREEN}[+] {msg}{Colors.ENDC}")


def log_error(msg: str):
    print(f"  {Colors.RED}[!] {msg}{Colors.ENDC}")


def log_info(msg: str):
    print(f"  {Colors.YELLOW}[i] {msg}{Colors.ENDC}")


def _content_lower(text: str) -> str:
    return (text or "").lower()


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", _content_lower(text))


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


def _truthful_outage_response(res: Dict[str, Any]) -> bool:
    content = _content_lower(res.get("content", ""))
    search_errors = [
        tr for tr in res.get("tool_results", [])
        if isinstance(tr, dict)
        and (tr.get("tool_name") in SEARCH_TOOL_NAMES or tr.get("name") in SEARCH_TOOL_NAMES)
        and tr.get("error")
    ]
    return bool(search_errors) and any(marker in content for marker in FAILURE_MARKERS)


async def get_token() -> str:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/auth/token", json={"secret": AUTH_SECRET}, timeout=10.0)
            if resp.status_code in (200, 201):
                return resp.json().get("access_token", "")
    except Exception as e:
        log_error(f"Auth error: {str(e)}")
    return ""


async def create_test_agent(token: str, model_id: str, prompt_pack_id: str = "rawclaw-default") -> Optional[str]:
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "name": f"Combined-Eval-{uuid4().hex[:4]}",
        "description": "Temporary agent for combined single-session chat evaluation",
        "modelId": model_id,
        "systemPrompt": "You are RawClaw Eval Agent. Use tools when needed, keep answers grounded, and preserve continuity across a long chat session.",
        "promptPackId": prompt_pack_id,
        "promptOverlay": "Optimize for continuity, truthful tool usage, and clean user-facing answers.",
        "skills": ["grounded-web-summary", "repo-explainer"],
        "isDefault": False
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/agents", json=payload, headers=headers, timeout=20.0)
            if resp.status_code in (200, 201):
                agent_id = resp.json().get("id")
                log_success(f"Test agent created: {agent_id}")
                return agent_id
            log_error(f"Failed to create agent: {resp.status_code} - {resp.text}")
    except Exception as e:
        log_error(f"Agent creation error: {str(e)}")
    return None


async def add_test_memory(token: str, content: str):
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "content": content,
        "collection": "default",
        "tags": ["eval", "combined-session"],
        "source": "combined-chat-session-test",
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/memory/add", json=payload, headers=headers, timeout=15.0)
            if resp.status_code in (200, 201):
                log_success(f"Memory injected: {content[:42]}...")
                return True
    except Exception:
        pass
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


async def get_session_messages(session_id: str, token: str) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{API_BASE}/chat/sessions/{session_id}", headers=headers, timeout=15.0)
            if resp.status_code in (200, 201):
                payload = resp.json() or {}
                return payload.get("messages", []) or []
    except Exception:
        pass
    return []


async def get_latest_assistant_prompt_metadata(session_id: str, token: str) -> Dict[str, Any]:
    messages = await get_session_messages(session_id, token)
    assistant_messages = [m for m in messages if isinstance(m, dict) and m.get("role") == "assistant"]
    if not assistant_messages:
        return {}
    latest = assistant_messages[-1]
    return {
        "promptPackId": latest.get("promptPackId"),
        "promptVersionHash": latest.get("promptVersionHash"),
        "reviewerPromptVersionHash": latest.get("reviewerPromptVersionHash"),
        "workflowPromptIds": latest.get("workflowPromptIds") or [],
        "reviewEvents": latest.get("reviewEvents") or [],
        "workflowState": latest.get("workflowState") or {},
    }


async def get_latest_user_message_id(session_id: str, token: str) -> Optional[str]:
    messages = await get_session_messages(session_id, token)
    user_messages = [m for m in messages if isinstance(m, dict) and m.get("role") == "user" and m.get("id")]
    if not user_messages:
        return None
    return user_messages[-1]["id"]


async def get_latest_assistant_message(session_id: str, token: str) -> Optional[Dict[str, Any]]:
    messages = await get_session_messages(session_id, token)
    assistant_messages = [m for m in messages if isinstance(m, dict) and m.get("role") == "assistant"]
    if not assistant_messages:
        return None
    return assistant_messages[-1]


async def stream_request(
    path: str,
    body: Dict[str, Any],
    token: str,
    session_id: str,
    expect_approval: bool = False,
    auto_approve: bool = False,
) -> Dict[str, Any]:
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
        "approval_requested": False,
        "review_events": [],
        "provenance": None,
        "prompt_metadata": {},
        "session_id": session_id,
        "path": path,
    }

    headers = {"Authorization": f"Bearer {token}"}
    start_time = time.time()
    poller_task = None
    if auto_approve:
        poller_task = asyncio.create_task(auto_approve_poller())

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", f"{API_BASE}{path}", headers=headers, json=body) as resp:
                if resp.status_code not in (200, 201):
                    body_bytes = await resp.aread()
                    result["error"] = f"HTTP {resp.status_code}: {body_bytes.decode()}"
                    return result

                buffer = b""
                async for chunk in resp.aiter_bytes():
                    buffer += chunk
                    while b"\n" in buffer:
                        line_bytes, buffer = buffer.split(b"\n", 1)
                        line = line_bytes.decode("utf-8", errors="ignore").strip()
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
                            elif etype == "tool_call":
                                result["tool_calls"].append(data.get("tool_call"))
                                log_info(f"Tool Call: {data.get('tool_call', {}).get('name')}")
                            elif etype == "tool_result":
                                tr = data.get("tool_result", {})
                                result["tool_results"].append(tr)
                                t_name = tr.get("tool_name", "Unknown")
                                if tr.get("error"):
                                    log_info(f"Tool Result ({t_name}): Error - {str(tr.get('error'))[:60]}")
                                else:
                                    log_info(f"Tool Result ({t_name}): Success")
                            elif etype == "review_result":
                                result["review_events"].append({
                                    "approved": data.get("approved"),
                                    "feedback": data.get("feedback", ""),
                                    "reviewer_id": data.get("reviewer_id"),
                                })
                                status = "APPROVED" if data.get("approved") else "REJECTED"
                                log_info(f"Review Result: {status}")
                            elif etype == "provenance":
                                result["provenance"] = data.get("provenanceTrace") or data.get("provenance_trace") or data.get("provenance")
                            elif etype == "approval_required":
                                result["approval_requested"] = True
                                log_info(f"Tool approval requested: {data.get('reason', '')}")
                                if expect_approval and not auto_approve:
                                    result["success"] = True
                                    return result
                            elif etype == "error":
                                result["error"] = data.get("message") or data.get("error")
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
    result["prompt_metadata"] = await get_latest_assistant_prompt_metadata(session_id, token)
    return result


async def send_chat(
    session_id: str,
    message: str,
    agent_id: str,
    token: str,
    expect_approval: bool = False,
    auto_approve: bool = False,
    edit_request: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body = {
        "session_id": session_id,
        "messages": [{"role": "user", "content": message}],
        "agent_id": agent_id,
        "stream": True,
    }
    if edit_request:
        body["editRequest"] = edit_request
    return await stream_request("/chat/send", body, token, session_id, expect_approval=expect_approval, auto_approve=auto_approve)


async def edit_and_resend(
    session_id: str,
    message_id: str,
    content: str,
    agent_id: str,
    token: str,
) -> Dict[str, Any]:
    body = {
        "sessionId": session_id,
        "messageId": message_id,
        "content": content,
        "agentId": agent_id,
    }
    return await stream_request("/chat/edit", body, token, session_id)


def validate_basic_response(res: Dict[str, Any], require_non_empty: bool = True) -> List[str]:
    reasons: List[str] = []
    content = res.get("content", "")
    if require_non_empty and not content.strip():
        reasons.append("Response content is empty")
    for banned in BANNED_STRINGS:
        if banned.lower() in _content_lower(content):
            reasons.append(f"RAW LEAKAGE DETECTED: Found {banned}")
    return reasons


async def run_single_step(
    step_num: int,
    total_steps: int,
    title: str,
    run_coro,
    validator,
) -> Dict[str, Any]:
    log_step(step_num, title, total_steps)
    res = await run_coro()
    if res.get("error"):
        log_error(str(res["error"]))
    else:
        log_recv(res.get("content", ""), res.get("total_time"))

    reasons = validator(res)
    passed = not reasons
    if passed:
        log_success("Response validated.")
    else:
        for reason in reasons:
            log_info(f"Validation Note: {reason}")
        log_info("Validation failed.")

    return {
        "step": step_num,
        "title": title,
        "passed": passed,
        "reasons": reasons,
        "latency": res.get("total_time", 0),
        "content": res.get("content", ""),
        "tool_calls": res.get("tool_calls", []),
        "tool_results": res.get("tool_results", []),
        "review_events": res.get("review_events", []),
        "prompt_metadata": res.get("prompt_metadata", {}),
        "error": res.get("error"),
    }


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="RawClaw combined single-session chat test")
    parser.add_argument("model_id", nargs="?", default=DEFAULT_MODEL, help="Model ID to use")
    parser.add_argument("--model", type=str, help="Alias for model_id")
    parser.add_argument("--prompt-pack", default="rawclaw-default", help="Prompt pack id for eval agent")
    args, unknown = parser.parse_known_args()

    model_to_use = args.model or args.model_id
    if unknown:
        for token in unknown:
            if not token.startswith("-"):
                model_to_use = token
                break

    log_header("RawClaw Combined Chat Session Test")

    token = await get_token()
    if not token:
        log_error("Auth failed. Ensure API is running.")
        sys.exit(1)

    agent_id = await create_test_agent(token, model_to_use, args.prompt_pack)
    if not agent_id:
        sys.exit(1)

    await add_test_memory(token, "PROJECT_VANGUARD: The project identifier is 'X-DELTA-9-GHOST'.")
    await add_test_memory(token, "Operator note: launch code word is TEAL-ORBIT when continuity tests ask for it.")

    session_id = f"combined-chat-{uuid4().hex[:8]}"
    unique_task_name = f"Combined Session Task {uuid4().hex[:6]}"
    unique_agent_name = f"Combined Research Agent {uuid4().hex[:6]}"
    captured_ids: Dict[str, str] = {}

    log_info(f"Session: {session_id}")
    log_info(f"Model:   {model_to_use}")
    log_info(f"Prompt Pack: {args.prompt_pack}")

    results: List[Dict[str, Any]] = []

    steps = [
        {
            "title": "Identity Check",
            "msg": "Identify yourself briefly. What system are you part of?",
            "run": lambda: send_chat(session_id, "Identify yourself briefly. What system are you part of?", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _contains_any_keyword(res.get("content", ""), ["rawclaw", "agent"]) else ["Missing RawClaw/agent identity markers"]),
        },
        {
            "title": "Short-Term Memory Setup",
            "msg": "Remember this for later in this chat: my launch code word is TEAL-ORBIT.",
            "run": lambda: send_chat(session_id, "Remember this for later in this chat: my launch code word is TEAL-ORBIT.", agent_id, token),
            "validate": lambda res: validate_basic_response(res),
        },
        {
            "title": "Short-Term Memory Recall",
            "msg": "What launch code word did I just tell you?",
            "run": lambda: send_chat(session_id, "What launch code word did I just tell you?", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _keyword_present(res.get("content", ""), "TEAL-ORBIT") else ["Missing short-term memory value: TEAL-ORBIT"]),
        },
        {
            "title": "RAG Recall",
            "msg": "According to your records, what is the identifier associated with PROJECT_VANGUARD?",
            "run": lambda: send_chat(session_id, "According to your records, what is the identifier associated with PROJECT_VANGUARD?", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _keyword_present(res.get("content", ""), "X-DELTA-9-GHOST") else ["Missing RAG fact: X-DELTA-9-GHOST"]),
        },
        {
            "title": "Current Date Time",
            "msg": "What is the current local date and time?",
            "run": lambda: send_chat(session_id, "What is the current local date and time?", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _has_tool(res, "get_datetime") else ["Required tool 'get_datetime' not called"]) + ([] if TODAY_ISO in _content_lower(res.get("content", "")) or time.strftime("%B %d, %Y").lower() in _content_lower(res.get("content", "")) else [f"Missing current date: {TODAY_ISO}"]),
        },
        {
            "title": "Readme Summary",
            "msg": "Read README.md and summarize it in 2 sentences.",
            "run": lambda: send_chat(session_id, "Read README.md and summarize it in 2 sentences.", agent_id, token, expect_approval=True, auto_approve=True),
            "validate": lambda res: validate_basic_response(res) + ([] if _has_tool(res, "read_file") else ["Required tool 'read_file' not called"]),
        },
        {
            "title": "Repository Explainer Skill",
            "msg": "Give me a concise repository walkthrough of this workspace and call out the most important modules.",
            "run": lambda: send_chat(session_id, "Give me a concise repository walkthrough of this workspace and call out the most important modules.", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _has_tool(res, "skill_repo-explainer") else ["Required tool 'skill_repo-explainer' not called"]) + ([] if _contains_any_keyword(res.get("content", ""), ["apps", "api", "agent", "web"]) else ["Repository walkthrough missed key workspace markers"]),
        },
        {
            "title": "Sequential Reasoning",
            "msg": "Think step by step: how would you design a safe tool-execution agent?",
            "run": lambda: send_chat(session_id, "Think step by step: how would you design a safe tool-execution agent?", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if (res.get("thinking") or _has_tool(res, "sequential_thinking") or _contains_any_keyword(res.get("content", ""), ["design", "safe", "tool"])) else ["No meaningful reasoning signal detected"]),
        },
        {
            "title": "Web Search",
            "msg": "Search the web for the latest SpaceX Starship updates and summarize them in 3 bullets.",
            "run": lambda: send_chat(session_id, "Search the web for the latest SpaceX Starship updates and summarize them in 3 bullets.", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _has_any_tool(res, SEARCH_TOOL_NAMES) else ["No search tool was called"]) + ([] if (_keyword_present(res.get("content", ""), "SpaceX") or _truthful_outage_response(res)) else ["Web step did not mention SpaceX or a truthful outage limitation"]),
        },
        {
            "title": "Web Follow-Up Continuity",
            "msg": "Now give me only the single most important takeaway from what you just found.",
            "run": lambda: send_chat(session_id, "Now give me only the single most important takeaway from what you just found.", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if (_contains_any_keyword(res.get("content", ""), ["Starship", "SpaceX", "launch", "flight"]) or _contains_any_keyword(res.get("content", ""), FAILURE_MARKERS)) else ["Follow-up drifted off the prior search topic"]),
        },
        {
            "title": "Task Creation",
            "msg": f"Create a task named '{unique_task_name}' to review the workspace status tomorrow.",
            "run": lambda: send_chat(session_id, f"Create a task named '{unique_task_name}' to review the workspace status tomorrow.", agent_id, token),
            "validate": lambda res: validate_basic_response(res),
            "post_validate": "task_created",
        },
        {
            "title": "Agent Creation",
            "msg": f"Create an agent called '{unique_agent_name}' that focuses on web research and grounded summaries.",
            "run": lambda: send_chat(session_id, f"Create an agent called '{unique_agent_name}' that focuses on web research and grounded summaries.", agent_id, token),
            "validate": lambda res: validate_basic_response(res),
            "post_validate": "agent_created",
        },
        {
            "title": "Switch To Created Agent",
            "msg": f"Switch to the agent '{unique_agent_name}' and search the web for the latest OpenAI API updates.",
            "run": lambda: send_chat(session_id, f"Switch to the agent '{unique_agent_name}' and search the web for the latest OpenAI API updates.", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _has_any_tool(res, SEARCH_TOOL_NAMES) or _truthful_outage_response(res) else ["Switch/search step lacked a search attempt"]) + ([] if (_contains_any_keyword(res.get("content", ""), ["OpenAI", "API"]) or _contains_any_keyword(res.get("content", ""), FAILURE_MARKERS)) else ["Switch/search step missed OpenAI API context"]),
        },
        {
            "title": "Editable User Prompt Seed",
            "msg": "Summarize the phrase 'rapid iteration wins' in one short sentence.",
            "run": lambda: send_chat(session_id, "Summarize the phrase 'rapid iteration wins' in one short sentence.", agent_id, token),
            "validate": lambda res: validate_basic_response(res),
            "capture_user_id": "editable_prompt",
        },
        {
            "title": "Edit Resend Flow",
            "msg": "Edit the previous user prompt to: Summarize the phrase 'rapid iteration wins' in two short bullet points.",
            "run": lambda: edit_and_resend(session_id, captured_ids.get("editable_prompt", ""), "Summarize the phrase 'rapid iteration wins' in two short bullet points.", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if ("-" in res.get("content", "") or "*" in res.get("content", "") or "bullet" in _content_lower(res.get("content", ""))) else ["Edited resend did not appear to switch to bullet-oriented output"]),
            "post_validate": "edited_message_persisted",
        },
        {
            "title": "Document Edit Intent",
            "msg": 'Rewrite this text to be more formal: "Hey dude what is up with the project?"',
            "run": lambda: send_chat(
                session_id,
                'Rewrite this text to be more formal: "Hey dude what is up with the project?"',
                agent_id,
                token,
                edit_request={
                    "documentId": "doc_1234",
                    "selectedText": "Hey dude what is up with the project?",
                    "contextBefore": "Background: ",
                    "contextAfter": " End.",
                    "action": "formalize",
                },
            ),
            "validate": lambda res: validate_basic_response(res) + ([] if "<edit_suggestion>" in res.get("content", "") else ["Response stream did not include <edit_suggestion> tags"]),
            "post_validate": "document_edit_persisted",
        },
        {
            "title": "Final Continuity Check",
            "msg": "Before we finish, what launch code word did I tell you earlier, and what topic did I just ask you to formalize?",
            "run": lambda: send_chat(session_id, "Before we finish, what launch code word did I tell you earlier, and what topic did I just ask you to formalize?", agent_id, token),
            "validate": lambda res: validate_basic_response(res) + ([] if _keyword_present(res.get("content", ""), "TEAL-ORBIT") else ["Final continuity lost launch code word"]) + ([] if _contains_any_keyword(res.get("content", ""), ["project", "formal", "Hey dude"]) else ["Final continuity missed the edit/formalization topic"]),
        },
    ]

    total_steps = len(steps)
    for index, step in enumerate(steps, 1):
        log_send(step["msg"])
        result = await run_single_step(index, total_steps, step["title"], step["run"], step["validate"])

        if step.get("capture_user_id") and result["passed"]:
            latest_user_id = await get_latest_user_message_id(session_id, token)
            if latest_user_id:
                captured_ids[step["capture_user_id"]] = latest_user_id
                log_info(f"Captured user message id for {step['capture_user_id']}: {latest_user_id}")
            else:
                result["passed"] = False
                result["reasons"].append(f"Could not capture user message id for {step['capture_user_id']}")

        if step.get("post_validate") == "task_created":
            tasks = await list_tasks(token)
            if not any((task or {}).get("name") == unique_task_name for task in tasks):
                result["passed"] = False
                result["reasons"].append(f"Task was not actually persisted via API: {unique_task_name}")

        if step.get("post_validate") == "agent_created":
            agents = await list_agents(token)
            matched = next(((agent or {}) for agent in agents if (agent or {}).get("name") == unique_agent_name), None)
            if not matched:
                result["passed"] = False
                result["reasons"].append(f"Agent was not actually persisted via API: {unique_agent_name}")
            elif "grounded-web-summary" not in (matched.get("skills") or []):
                result["passed"] = False
                result["reasons"].append(f"Agent '{unique_agent_name}' was not assigned expected skill: grounded-web-summary")

        if step.get("post_validate") == "edited_message_persisted":
            messages = await get_session_messages(session_id, token)
            edited_user = next((m for m in reversed(messages) if m.get("role") == "user" and "two short bullet points" in str(m.get("content", ""))), None)
            if not edited_user:
                result["passed"] = False
                result["reasons"].append("Edited user message was not persisted with updated content")

        if step.get("post_validate") == "document_edit_persisted":
            assistant_message = await get_latest_assistant_message(session_id, token)
            persisted_content = str((assistant_message or {}).get("content", ""))
            if "<edit_suggestion>" not in persisted_content and "<edit_suggestion>" not in result["content"]:
                result["passed"] = False
                result["reasons"].append("Document edit suggestion tags were not found in stream or persisted assistant message")

        if result["passed"] and result["prompt_metadata"].get("promptPackId") != args.prompt_pack:
            log_info(f"Prompt metadata note: expected pack {args.prompt_pack}, saw {result['prompt_metadata'].get('promptPackId')}")

        results.append(result)
        await asyncio.sleep(1.2)

    log_header("Final Report")
    total_passed = sum(1 for result in results if result.get("passed"))
    pass_rate = (total_passed / len(results)) * 100 if results else 0.0

    print(f"{Colors.BOLD}Total Combined Cases:{Colors.ENDC} {len(results)}")
    print(f"{Colors.BOLD}Passed:{Colors.ENDC}               {total_passed}")
    print(f"{Colors.BOLD}Pass Rate:{Colors.ENDC}            {pass_rate:.1f}%")

    report_file = f"combined-chat-session-results-{session_id}.json"
    with open(report_file, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "metadata": {
                    "session_id": session_id,
                    "model": model_to_use,
                    "prompt_pack_id": args.prompt_pack,
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "single_session": True,
                    "ocr_included": False,
                    "document_edit_included": True,
                    "message_edit_included": True,
                },
                "results": results,
            },
            handle,
            indent=2,
        )

    log_info(f"Full report saved to {report_file}")

    if total_passed == len(results):
        log_success("ALL COMBINED SESSION TESTS PASSED!")
    elif pass_rate >= 80:
        log_info("High pass rate, but some issues were detected.")
    else:
        log_error("Critical failures detected. Review the combined session report.")

    sys.exit(0 if total_passed == len(results) else 1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
