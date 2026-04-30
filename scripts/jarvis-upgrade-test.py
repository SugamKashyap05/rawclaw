#!/usr/bin/env python3
"""
RawClaw JARVIS upgrade validation suite.

This test focuses on the operator-console upgrade rather than generic chat only.
It validates:
- JARVIS prompt-pack composition
- assistant lane routing
- assistant state capture
- layered memory (session / operator / mission)
- advisory and briefing behavior
- research/tasking continuity
- persisted provenance for the control room

Usage:
    python scripts/jarvis-upgrade-test.py gemma4:31b-cloud
"""

import asyncio
import json
import re
import sys
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import uuid4

import httpx

API_BASE = "http://localhost:3000/api"
DEFAULT_MODEL = "ollama/llama3.2:3b"
AUTH_SECRET = "Kuki7816"
DEFAULT_PROMPT_PACK = "rawclaw-jarvis"
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
TRANSIENT_CHAT_ERRORS = [
    "all connection attempts failed",
    "the agent stopped responding",
    "readtimeout",
    "connecterror",
    "provider_offline",
    "stream_timeout",
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
    print(f"\n{Colors.HEADER}{'=' * 76}{Colors.ENDC}")
    print(f"{Colors.BOLD}{text.center(76)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'=' * 76}{Colors.ENDC}\n")


def log_step(step_num: int, title: str, total_steps: int):
    print(f"{Colors.CYAN}[STEP {step_num}/{total_steps}]{Colors.ENDC} {Colors.BOLD}{title}{Colors.ENDC}")


def log_send(msg: str):
    print(f"  {Colors.BLUE}USER  >{Colors.ENDC} {msg}")


def log_recv(msg: str, latency: float = None):
    lat_str = f" [{latency:.2f}s]" if latency else ""
    snippet = (msg or "")[:200].replace("\n", " ")
    print(f"  {Colors.GREEN}AGENT <{Colors.ENDC} {snippet}{'...' if len(msg or '') > 200 else ''}{Colors.YELLOW}{lat_str}{Colors.ENDC}")


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


def _truthful_outage_response(res: Dict[str, Any]) -> bool:
    content = _content_lower(res.get("content", ""))
    search_errors = [
        tr for tr in res.get("tool_results", [])
        if isinstance(tr, dict)
        and (tr.get("tool_name") in SEARCH_TOOL_NAMES or tr.get("name") in SEARCH_TOOL_NAMES)
        and tr.get("error")
    ]
    return bool(search_errors) and any(marker in content for marker in FAILURE_MARKERS)


def _assistant_lane(message: Dict[str, Any]) -> Optional[str]:
    return ((message or {}).get("workflowState") or {}).get("assistantLane")


def _confidence_state(message: Dict[str, Any]) -> Optional[str]:
    return ((message or {}).get("workflowState") or {}).get("confidenceState")


def _workflow_prompt_ids(message: Dict[str, Any]) -> List[str]:
    return list((message or {}).get("workflowPromptIds") or [])


def _validate_basic_response(res: Dict[str, Any], require_non_empty: bool = True) -> List[str]:
    reasons: List[str] = []
    content = res.get("content", "")
    if require_non_empty and not content.strip():
        reasons.append("Response content is empty")
    for banned in BANNED_STRINGS:
        if banned.lower() in _content_lower(content):
            reasons.append(f"Raw leakage detected: {banned}")
    if _looks_compacted_text(content):
        reasons.append("Response text looks compacted or poorly rendered for the user.")
    return reasons


def _looks_compacted_text(content: str) -> bool:
    text = content or ""
    sanitized = re.sub(r"https?://\S+", " URL ", text)
    sanitized = re.sub(r"`[^`]+`", " CODE ", sanitized)
    alpha_count = len(re.findall(r"[A-Za-z]", sanitized))
    if alpha_count < 80:
        return False
    whitespace_count = len(re.findall(r"\s", sanitized))
    whitespace_ratio = whitespace_count / max(alpha_count, 1)
    compact_markers = [
        "Iam",
        "Hereis",
        "NextAction",
        "CurrentMission",
        "CurrentProject",
        "ActiveReminder",
        "LaunchColor",
        "Command-CenterBriefing",
        "OperatorBriefing",
    ]
    marker_hits = sum(1 for marker in compact_markers if marker in sanitized)
    punctuation_collisions = len(re.findall(r"[.,:;!?][A-Za-z]", sanitized))
    return whitespace_ratio < 0.08 or marker_hits >= 2 or punctuation_collisions >= 6


async def get_token() -> str:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/auth/token", json={"secret": AUTH_SECRET}, timeout=10.0)
            if resp.status_code in (200, 201):
                return resp.json().get("access_token", "")
    except Exception as exc:
        log_error(f"Auth error: {exc}")
    return ""


async def api_get(path: str, token: str) -> Any:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{API_BASE}{path}", headers=headers, timeout=20.0)
        resp.raise_for_status()
        return resp.json()


async def create_test_agent(token: str, model_id: str, prompt_pack_id: str = DEFAULT_PROMPT_PACK) -> Optional[str]:
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "name": f"Jarvis-Eval-{uuid4().hex[:4]}",
        "description": "Temporary agent for JARVIS upgrade validation",
        "modelId": model_id,
        "systemPrompt": (
            "You are RawClaw JARVIS Eval Agent. Stay calm, concise, advisory-first, and keep continuity grounded "
            "across memory, research, tasking, and operator briefings."
        ),
        "promptPackId": prompt_pack_id,
        "promptOverlay": (
            "Prioritize situational awareness, trustworthy memory recall, transparent provenance, "
            "and low-risk next-step guidance."
        ),
        "skills": ["grounded-web-summary", "repo-explainer"],
        "isDefault": False,
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/agents", json=payload, headers=headers, timeout=20.0)
            if resp.status_code in (200, 201):
                agent_id = resp.json().get("id")
                log_success(f"Test agent created: {agent_id}")
                return agent_id
            log_error(f"Failed to create agent: {resp.status_code} - {resp.text}")
    except Exception as exc:
        log_error(f"Agent creation error: {exc}")
    return None


async def list_tasks(token: str) -> List[Dict[str, Any]]:
    try:
        payload = await api_get("/tasks", token)
        return payload if isinstance(payload, list) else []
    except Exception:
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


async def get_latest_assistant_message(session_id: str, token: str) -> Optional[Dict[str, Any]]:
    messages = await get_session_messages(session_id, token)
    assistant_messages = [m for m in messages if isinstance(m, dict) and m.get("role") == "assistant"]
    if not assistant_messages:
        return None
    return assistant_messages[-1]


async def stream_request(path: str, body: Dict[str, Any], token: str, session_id: str) -> Dict[str, Any]:
    result = {
        "content": "",
        "thinking": [],
        "tool_calls": [],
        "tool_results": [],
        "ttft": 0,
        "total_time": 0,
        "success": False,
        "error": None,
        "review_events": [],
        "provenance": None,
        "assistant_message": None,
    }

    headers = {"Authorization": f"Bearer {token}"}
    start_time = time.time()

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", f"{API_BASE}{path}", headers=headers, json=body) as resp:
                if resp.status_code not in (200, 201):
                    body_bytes = await resp.aread()
                    result["error"] = f"HTTP {resp.status_code}: {body_bytes.decode(errors='ignore')}"
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
                        except json.JSONDecodeError:
                            continue

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
                            name = tr.get("tool_name", "Unknown")
                            if tr.get("error"):
                                log_info(f"Tool Result ({name}): Error - {str(tr.get('error'))[:60]}")
                            else:
                                log_info(f"Tool Result ({name}): Success")
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
                        elif etype == "error":
                            result["error"] = data.get("message") or data.get("error")
                        elif etype == "done":
                            result["success"] = True
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"

    result["total_time"] = time.time() - start_time
    result["assistant_message"] = await get_latest_assistant_message(session_id, token)
    return result


async def send_chat(session_id: str, message: str, agent_id: str, token: str) -> Dict[str, Any]:
    body = {
        "session_id": session_id,
        "messages": [{"role": "user", "content": message}],
        "agent_id": agent_id,
        "stream": True,
    }
    last_result: Dict[str, Any] = {}
    for attempt in range(1, 4):
        result = await stream_request("/chat/send", body, token, session_id)
        last_result = result
        error_text = _content_lower(str(result.get("error") or ""))
        if not any(marker in error_text for marker in TRANSIENT_CHAT_ERRORS):
            return result
        if attempt < 3:
            log_info(f"Transient chat error detected, retrying request ({attempt}/2 retries used)...")
            await asyncio.sleep(1.5 * attempt)
    return last_result


async def run_chat_step(
    step_num: int,
    total_steps: int,
    title: str,
    message: str,
    runner: Callable[[], Awaitable[Dict[str, Any]]],
    validator: Callable[[Dict[str, Any]], Awaitable[List[str]]],
) -> Dict[str, Any]:
    log_step(step_num, title, total_steps)
    log_send(message)
    res = await runner()
    if res.get("error"):
        log_error(str(res["error"]))
    else:
        log_recv(res.get("content", ""), res.get("total_time"))

    reasons = await validator(res)
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
        "type": "chat",
        "message": message,
        "passed": passed,
        "reasons": reasons,
        "latency": res.get("total_time", 0),
        "content": res.get("content", ""),
        "tool_calls": res.get("tool_calls", []),
        "tool_results": res.get("tool_results", []),
        "review_events": res.get("review_events", []),
        "assistant_message": res.get("assistant_message"),
        "error": res.get("error"),
    }


async def run_api_step(
    step_num: int,
    total_steps: int,
    title: str,
    fetcher: Callable[[], Awaitable[Dict[str, Any]]],
    validator: Callable[[Dict[str, Any]], Awaitable[List[str]]],
) -> Dict[str, Any]:
    log_step(step_num, title, total_steps)
    payload = await fetcher()
    reasons = await validator(payload)
    passed = not reasons
    if passed:
        log_success("API state validated.")
    else:
        for reason in reasons:
            log_info(f"Validation Note: {reason}")
        log_info("Validation failed.")

    return {
        "step": step_num,
        "title": title,
        "type": "api",
        "passed": passed,
        "reasons": reasons,
        "payload": payload,
    }


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="RawClaw JARVIS upgrade validation test")
    parser.add_argument("model_id", nargs="?", default=DEFAULT_MODEL, help="Model ID to use")
    parser.add_argument("--model", type=str, help="Alias for model_id")
    parser.add_argument("--prompt-pack", default=DEFAULT_PROMPT_PACK, help="Prompt pack id for eval agent")
    args, unknown = parser.parse_known_args()

    model_to_use = args.model or args.model_id
    if unknown:
        for token in unknown:
            if not token.startswith("-"):
                model_to_use = token
                break

    log_header("RawClaw JARVIS Upgrade Test")

    token = await get_token()
    if not token:
        log_error("Auth failed. Ensure API is running.")
        sys.exit(1)

    agent_id = await create_test_agent(token, model_to_use, args.prompt_pack)
    if not agent_id:
        sys.exit(1)

    session_id = f"jarvis-upgrade-{uuid4().hex[:8]}"
    unique_task_name = f"Jarvis Followup {uuid4().hex[:6]}"

    log_info(f"Session: {session_id}")
    log_info(f"Model:   {model_to_use}")
    log_info(f"Prompt Pack: {args.prompt_pack}")

    results: List[Dict[str, Any]] = []

    async def validate_identity(res: Dict[str, Any]) -> List[str]:
        reasons = _validate_basic_response(res)
        content = res.get("content", "")
        assistant_message = res.get("assistant_message") or {}
        if not _contains_any_keyword(content, ["rawclaw", "assistant", "operator", "jarvis"]):
            reasons.append("Identity response did not feel like a JARVIS/operator introduction.")
        if assistant_message.get("promptPackId") != args.prompt_pack:
            reasons.append(f"Expected prompt pack {args.prompt_pack}, saw {assistant_message.get('promptPackId')}")
        if _assistant_lane(assistant_message) != "conversation":
            reasons.append(f"Expected conversation lane, saw {_assistant_lane(assistant_message)}")
        if _confidence_state(assistant_message) is None:
            reasons.append("No confidence state was persisted on the assistant message.")
        return reasons

    state_capture_prompt = (
        "My name is Maya. I prefer concise briefings. We are working on the RawClaw JARVIS rollout. "
        "Remind me to review the operator dashboard tomorrow. Remember this for later in this chat: the launch color is cobalt."
    )

    async def validate_state_capture(res: Dict[str, Any]) -> List[str]:
        reasons = _validate_basic_response(res)
        assistant_message = res.get("assistant_message") or {}
        state = await api_get("/assistant/state", token)
        overview = await api_get(f"/memory/overview?sessionId={session_id}", token)

        if ((state.get("operatorProfile") or {}).get("name") or "").strip().lower() != "maya":
            reasons.append("Assistant state did not capture operator name Maya.")
        preferences = [str(item).lower() for item in (state.get("operatorProfile") or {}).get("preferences") or []]
        if not any("concise briefing" in pref or "concise" in pref for pref in preferences):
            reasons.append("Assistant state did not capture the concise-briefings preference.")
        if "rawclaw jarvis rollout" not in _content_lower(str(state.get("missionSummary") or "")):
            reasons.append("Assistant state did not capture the JARVIS rollout mission summary.")
        commitments = state.get("commitments") or []
        if not any((item or {}).get("status") == "active" for item in commitments):
            reasons.append("Assistant state did not create an active commitment from the reminder.")
        if not (assistant_message.get("memoryEvents") or []):
            reasons.append("No memory events were persisted on the assistant message.")
        if not (assistant_message.get("advisoryEvents") or []):
            reasons.append("No advisory events were persisted for the reminder capture turn.")
        if not (overview.get("operator") or []):
            reasons.append("Operator memory layer is empty after capture.")
        if not (overview.get("mission") or []):
            reasons.append("Mission memory layer is empty after capture.")
        if not (overview.get("session") or []):
            reasons.append("Session memory layer is empty after the remember-this capture.")
        return reasons

    async def validate_memory_recall(res: Dict[str, Any]) -> List[str]:
        reasons = _validate_basic_response(res)
        content = res.get("content", "")
        assistant_message = res.get("assistant_message") or {}
        if not _keyword_present(content, "Maya"):
            reasons.append("Memory recall response did not mention Maya.")
        if not _contains_any_keyword(content, ["RawClaw JARVIS rollout", "JARVIS rollout", "mission"]):
            reasons.append("Memory recall response did not mention the active mission.")
        if not _keyword_present(content, "cobalt"):
            reasons.append("Session memory recall missed the launch color cobalt.")
        if not _contains_any_keyword(content, ["operator dashboard", "review the operator dashboard", "dashboard"]):
            reasons.append("Memory recall response did not mention the active reminder.")
        if _assistant_lane(assistant_message) != "memory":
            reasons.append(f"Expected memory lane, saw {_assistant_lane(assistant_message)}")
        workflow_ids = _workflow_prompt_ids(assistant_message)
        if "jarvis-briefing" not in workflow_ids:
            reasons.append("Memory recall turn did not attach the jarvis-briefing workflow.")
        return reasons

    async def fetch_briefing_payload() -> Dict[str, Any]:
        state = await api_get("/assistant/state", token)
        briefing = await api_get("/assistant/briefing", token)
        advisories = await api_get("/assistant/advisories", token)
        overview = await api_get(f"/memory/overview?sessionId={session_id}", token)
        return {
            "state": state,
            "briefing": briefing,
            "advisories": advisories,
            "overview": overview,
        }

    async def validate_briefing_payload(payload: Dict[str, Any]) -> List[str]:
        reasons: List[str] = []
        briefing = payload.get("briefing") or {}
        advisories = payload.get("advisories") or []
        overview = payload.get("overview") or {}

        if "rawclaw jarvis rollout" not in _content_lower(str(briefing.get("missionSummary") or "")):
            reasons.append("Assistant briefing does not reflect the mission summary.")
        if not briefing.get("summary"):
            reasons.append("Assistant briefing summary is empty.")
        if not (briefing.get("pendingCommitments") or []):
            reasons.append("Assistant briefing did not surface pending commitments.")
        if not advisories:
            reasons.append("Assistant advisories endpoint returned no suggestions.")
        if not (overview.get("operator") or []) or not (overview.get("mission") or []) or not (overview.get("session") or []):
            reasons.append("Memory overview did not expose all layered memory buckets.")
        return reasons

    async def validate_advisory_turn(res: Dict[str, Any]) -> List[str]:
        reasons = _validate_basic_response(res)
        content = res.get("content", "")
        assistant_message = res.get("assistant_message") or {}
        if not _contains_any_keyword(content, ["next step", "recommend", "strategy", "rollout"]):
            reasons.append("Advisory response did not produce strategy/next-step guidance.")
        if _assistant_lane(assistant_message) != "advisory":
            reasons.append(f"Expected advisory lane, saw {_assistant_lane(assistant_message)}")
        if not (assistant_message.get("advisoryEvents") or []):
            reasons.append("Advisory turn did not persist advisory events.")
        workflow_ids = _workflow_prompt_ids(assistant_message)
        if "jarvis-advisory" not in workflow_ids:
            reasons.append("Advisory turn did not attach the jarvis-advisory workflow.")
        return reasons

    async def validate_research_turn(res: Dict[str, Any]) -> List[str]:
        reasons = _validate_basic_response(res)
        content = res.get("content", "")
        assistant_message = res.get("assistant_message") or {}
        if not (_has_any_tool(res, SEARCH_TOOL_NAMES) or _truthful_outage_response(res)):
            reasons.append("Research turn did not attempt web search or return a truthful outage response.")
        if _assistant_lane(assistant_message) != "research":
            reasons.append(f"Expected research lane, saw {_assistant_lane(assistant_message)}")
        workflow_ids = _workflow_prompt_ids(assistant_message)
        if "web-research-grounded" not in workflow_ids:
            reasons.append("Research turn did not attach web-research-grounded workflow guidance.")
        if "jarvis-advisory" not in workflow_ids:
            reasons.append("Research turn did not preserve JARVIS advisory workflow guidance.")
        if not (_contains_any_keyword(content, ["OpenAI", "API"]) or _truthful_outage_response(res)):
            reasons.append("Research response missed OpenAI API context.")
        if not (assistant_message.get("advisoryEvents") or []):
            reasons.append("Research turn did not persist advisory follow-up/blocker events.")
        return reasons

    async def validate_tasking_turn(res: Dict[str, Any]) -> List[str]:
        reasons = _validate_basic_response(res)
        assistant_message = res.get("assistant_message") or {}
        tasks = await list_tasks(token)
        if not any((task or {}).get("name") == unique_task_name for task in tasks):
            reasons.append(f"Task was not actually persisted via API: {unique_task_name}")
        if _assistant_lane(assistant_message) != "tasking":
            reasons.append(f"Expected tasking lane, saw {_assistant_lane(assistant_message)}")
        if not (assistant_message.get("advisoryEvents") or []):
            reasons.append("Tasking turn did not persist follow-up advisory events.")
        if not _contains_any_keyword(res.get("content", ""), ["task", "follow-up", "dashboard", "review"]):
            reasons.append("Tasking response did not clearly confirm the task/follow-up.")
        return reasons

    async def validate_operator_briefing_turn(res: Dict[str, Any]) -> List[str]:
        reasons = _validate_basic_response(res)
        content = res.get("content", "")
        assistant_message = res.get("assistant_message") or {}
        if not _keyword_present(content, "Maya"):
            reasons.append("Operator briefing did not recall the operator name.")
        if not _contains_any_keyword(content, ["JARVIS rollout", "mission", "rollout"]):
            reasons.append("Operator briefing did not mention the mission.")
        if not _contains_any_keyword(content, ["operator dashboard", "dashboard", "review"]):
            reasons.append("Operator briefing did not mention the active reminder/commitment.")
        if not (
            _contains_any_keyword(content, ["next step", "recommend", "follow-up", "next best action"])
            or "nextaction" in _compact_text(content)
        ):
            reasons.append("Operator briefing did not include a next-step recommendation.")
        if _assistant_lane(assistant_message) not in {"advisory", "memory"}:
            reasons.append(f"Expected advisory or memory lane, saw {_assistant_lane(assistant_message)}")
        workflow_ids = _workflow_prompt_ids(assistant_message)
        if "jarvis-briefing" not in workflow_ids:
            reasons.append("Operator briefing turn did not attach the jarvis-briefing workflow.")
        return reasons

    async def fetch_control_room_payload() -> Dict[str, Any]:
        messages = await get_session_messages(session_id, token)
        assistant_messages = [m for m in messages if isinstance(m, dict) and m.get("role") == "assistant"]
        return {
            "messages": assistant_messages,
            "assistantState": await api_get("/assistant/state", token),
            "briefing": await api_get("/assistant/briefing", token),
        }

    async def validate_control_room_payload(payload: Dict[str, Any]) -> List[str]:
        reasons: List[str] = []
        assistant_messages = payload.get("messages") or []
        if not assistant_messages:
            reasons.append("No assistant messages were persisted for the session.")
            return reasons

        if not all((msg or {}).get("promptPackId") == args.prompt_pack for msg in assistant_messages):
            reasons.append("Not all assistant messages were persisted with the JARVIS prompt pack.")

        lanes = {
            ((msg or {}).get("workflowState") or {}).get("assistantLane")
            for msg in assistant_messages
            if ((msg or {}).get("workflowState") or {}).get("assistantLane")
        }
        if not {"conversation", "memory", "research", "tasking"}.issubset(lanes):
            reasons.append(f"Persisted assistant lanes were incomplete: {sorted(lanes)}")

        if not any((msg or {}).get("memoryEvents") for msg in assistant_messages):
            reasons.append("No persisted assistant message contained memory events.")
        if not any((msg or {}).get("advisoryEvents") for msg in assistant_messages):
            reasons.append("No persisted assistant message contained advisory events.")
        if not all(((msg or {}).get("workflowState") or {}).get("confidenceState") for msg in assistant_messages):
            reasons.append("Some assistant messages are missing confidence state.")

        briefing = payload.get("briefing") or {}
        if not briefing.get("summary"):
            reasons.append("Control-room briefing summary is empty.")
        return reasons

    steps = [
        {
            "title": "JARVIS Presence And Identity",
            "message": "Identify yourself briefly as my JARVIS-style assistant and tell me how you operate.",
            "runner": lambda: send_chat(session_id, "Identify yourself briefly as my JARVIS-style assistant and tell me how you operate.", agent_id, token),
            "validator": validate_identity,
        },
        {
            "title": "Assistant State Capture",
            "message": state_capture_prompt,
            "runner": lambda: send_chat(session_id, state_capture_prompt, agent_id, token),
            "validator": validate_state_capture,
        },
        {
            "title": "Memory Recall And Mission Continuity",
            "message": "What do you know about me, what mission are you tracking, what reminder is active, and what launch color did I ask you to remember?",
            "runner": lambda: send_chat(session_id, "What do you know about me, what mission are you tracking, what reminder is active, and what launch color did I ask you to remember?", agent_id, token),
            "validator": validate_memory_recall,
        },
        {
            "title": "Assistant Briefing APIs",
            "api_fetcher": fetch_briefing_payload,
            "validator": validate_briefing_payload,
        },
        {
            "title": "Advisory Strategy Turn",
            "message": "Give me a short strategy and recommend the next step for the JARVIS rollout.",
            "runner": lambda: send_chat(session_id, "Give me a short strategy and recommend the next step for the JARVIS rollout.", agent_id, token),
            "validator": validate_advisory_turn,
        },
        {
            "title": "Research Lane And Follow-Up",
            "message": "Search the web for the latest OpenAI API updates and give me 3 bullets plus one sensible follow-up.",
            "runner": lambda: send_chat(session_id, "Search the web for the latest OpenAI API updates and give me 3 bullets plus one sensible follow-up.", agent_id, token),
            "validator": validate_research_turn,
        },
        {
            "title": "Tasking Lane And Follow-Up",
            "message": f"Create a task named '{unique_task_name}' to review the mission dashboard tomorrow and then suggest the best follow-up.",
            "runner": lambda: send_chat(session_id, f"Create a task named '{unique_task_name}' to review the mission dashboard tomorrow and then suggest the best follow-up.", agent_id, token),
            "validator": validate_tasking_turn,
        },
        {
            "title": "Operator Briefing In Chat",
            "message": "Give me a concise operator briefing: who am I, what mission are we on, what reminder is active, and what should we do next?",
            "runner": lambda: send_chat(session_id, "Give me a concise operator briefing: who am I, what mission are we on, what reminder is active, and what should we do next?", agent_id, token),
            "validator": validate_operator_briefing_turn,
        },
        {
            "title": "Control Room Persistence",
            "api_fetcher": fetch_control_room_payload,
            "validator": validate_control_room_payload,
        },
    ]

    total_steps = len(steps)
    for index, step in enumerate(steps, 1):
        if "api_fetcher" in step:
            result = await run_api_step(index, total_steps, step["title"], step["api_fetcher"], step["validator"])
        else:
            result = await run_chat_step(index, total_steps, step["title"], step["message"], step["runner"], step["validator"])
        results.append(result)
        await asyncio.sleep(1.0)

    log_header("Final Report")
    total_passed = sum(1 for result in results if result.get("passed"))
    pass_rate = (total_passed / len(results)) * 100 if results else 0.0

    print(f"{Colors.BOLD}Total JARVIS Cases:{Colors.ENDC} {len(results)}")
    print(f"{Colors.BOLD}Passed:{Colors.ENDC}             {total_passed}")
    print(f"{Colors.BOLD}Pass Rate:{Colors.ENDC}          {pass_rate:.1f}%")

    report_file = f"jarvis-upgrade-results-{session_id}.json"
    with open(report_file, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "metadata": {
                    "session_id": session_id,
                    "model": model_to_use,
                    "prompt_pack_id": args.prompt_pack,
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "focus": [
                        "presence-and-identity",
                        "assistant-state",
                        "layered-memory",
                        "briefings-and-advisories",
                        "research-and-tasking-lanes",
                        "control-room-persistence",
                    ],
                },
                "results": results,
            },
            handle,
            indent=2,
        )

    log_info(f"Full report saved to {report_file}")

    if total_passed == len(results):
        log_success("ALL JARVIS UPGRADE TESTS PASSED!")
    elif pass_rate >= 80:
        log_info("High pass rate, but some JARVIS upgrade gaps were detected.")
    else:
        log_error("The JARVIS upgrade still has meaningful gaps. Review the saved report.")

    sys.exit(0 if total_passed == len(results) else 1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
