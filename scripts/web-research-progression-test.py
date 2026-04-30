#!/usr/bin/env python3
"""
Focused web-research progression evaluator for RawClaw.

This suite checks only web-research behavior, with prompts that increase in
difficulty and validate an end-to-end workflow:
1. plan
2. reviewer enabled / review result observed
3. web search
4. fetch / browse fallback when needed
5. grounded note collection in markdown
6. draft creation
7. reviewed presentation

Usage:
    python scripts/web-research-progression-test.py gemma4:31b-cloud
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

SEARCH_TOOL_NAMES = ["web_search", "duckduckgo_search", "web-search", "google:search", "smart_search", "iask-search"]
BROWSE_TOOL_NAMES = ["web_extract", "web_fetch", "fetch_url", "browser_fetch", "browser_open", "browser_navigate"]
BANNED_OUTPUT_MARKERS = [
    '{"name":',
    "</think>",
    "<invoke",
    "<tool_code>",
    "|>user",
    "|>model",
    "</skill>",
    ">sequential_thinking{",
]
COMMON_IRRELEVANT_MARKERS = [
    "stackedit",
    "onlinemarkdown",
    "online markdown editor",
    "using the fetch api",
    "mdn",
    "openclaw",
    "web search - openclaw",
    "file explorer is accessible",
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
    print(f"\n{Colors.HEADER}{'='*72}{Colors.ENDC}")
    print(f"{Colors.BOLD}{text.center(72)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'='*72}{Colors.ENDC}\n")


def log_step(step: int, title: str, total_steps: int):
    print(f"{Colors.CYAN}[STEP {step}/{total_steps}] Web Research:{Colors.ENDC} {Colors.BOLD}{title}{Colors.ENDC}")


def log_send(msg: str):
    print(f"  {Colors.BLUE}USER  >{Colors.ENDC} {msg}")


def log_recv(msg: str, latency: float = None):
    lat_str = f" [{latency:.2f}s]" if latency else ""
    text = f"  {Colors.GREEN}AGENT <{Colors.ENDC} {msg[:180].replace(chr(10), ' ')}{'...' if len(msg) > 180 else ''}{Colors.YELLOW}{lat_str}{Colors.ENDC}"
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode('ascii', 'ignore').decode('ascii'))


def log_info(msg: str):
    print(f"  {Colors.YELLOW}[i] {msg}{Colors.ENDC}")


def log_success(msg: str):
    print(f"  {Colors.GREEN}[+] {msg}{Colors.ENDC}")


def log_error(msg: str):
    print(f"  {Colors.RED}[!] {msg}{Colors.ENDC}")


def _lower(text: str) -> str:
    return (text or "").lower()


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", _lower(text))


def _has_keyword(text: str, keyword: str) -> bool:
    return keyword.lower() in _lower(text) or _compact(keyword) in _compact(text)


def _has_any_keyword(text: str, keywords: List[str]) -> bool:
    return any(_has_keyword(text, keyword) for keyword in keywords)


def _count_markdown_bullets(text: str) -> int:
    return len(re.findall(r"(?m)^\s*[-*]\s+", text or ""))


def _count_heading(text: str, heading: str) -> int:
    pattern = rf"(?mi)^\s*##\s+{re.escape(heading)}\s*$"
    return len(re.findall(pattern, text or ""))


def _extract_markdown_bullets(text: str, heading: Optional[str] = None) -> List[str]:
    lines = (text or "").splitlines()
    bullets: List[str] = []
    inside = heading is None
    heading_marker = f"## {heading}".lower() if heading else ""
    for raw_line in lines:
        line = raw_line.strip()
        lower_line = line.lower()
        if heading is not None and lower_line.startswith("## "):
            inside = lower_line == heading_marker
            continue
        if inside and line.startswith(("- ", "* ")):
            bullets.append(line[2:].strip())
    return bullets


def _normalize_semantic_line(text: str) -> str:
    normalized = _lower(text)
    normalized = re.sub(r"https?://\S+", " ", normalized)
    normalized = re.sub(r"`[^`]+`", " ", normalized)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _has_near_duplicate_bullets(bullets: List[str]) -> bool:
    seen = set()
    for bullet in bullets:
        key = _normalize_semantic_line(bullet)
        if not key:
            continue
        short_key = " ".join(key.split()[:12])
        if short_key in seen:
            return True
        seen.add(short_key)
    return False


def _looks_like_source_echo_line(line: str) -> bool:
    lowered = _lower(line)
    breadcrumb_markers = [
        "home /",
        "copy season",
        "season 2026 season 2025",
        "fixtures results",
        "results squad fixtures",
        "team standings & rankings",
        "points table |",
        "explore developer resources",
        "dynamic examples",
        "see all of the latest features and updates",
        "get the most out of openai",
    ]
    if any(marker in lowered for marker in breadcrumb_markers):
        return True
    if lowered.count("|") >= 2:
        return True
    if re.search(r"\bseason\s+20\d{2}\s+season\s+20\d{2}\b", lowered):
        return True
    return False


def _looks_like_generic_definition(line: str) -> bool:
    lowered = _lower(line)
    generic_markers = [
        "is currently in progress",
        "is under development",
        "is a two-stage",
        "is determined by a points system",
        "teams earn two",
        "provides coverage of",
        "allows models to access",
        "see all of the latest",
        "explore developer resources",
    ]
    return any(marker in lowered for marker in generic_markers)


def _looks_like_meta_answer_line(line: str) -> bool:
    lowered = _lower(line)
    meta_markers = [
        "to determine the current",
        "you can track the live progression",
        "you should navigate to",
        "visit the official",
        "refer to the official",
        "can be viewed directly on the official website",
        "the page provides",
        "to access the specific",
        "one must examine the official",
    ]
    return any(marker in lowered for marker in meta_markers)


def _verdict_reasons(step: Dict[str, Any], content: str) -> List[str]:
    reasons: List[str] = []
    verdict_topic = step.get("verdict_topic")
    verdict_section = step.get("verdict_section")
    bullets = _extract_markdown_bullets(content, verdict_section) if verdict_section else _extract_markdown_bullets(content)
    if not bullets:
        return reasons

    if _has_near_duplicate_bullets(bullets):
        reasons.append("Final answer repeats substantially similar bullets instead of distinct findings")

    source_echo_count = sum(1 for bullet in bullets if _looks_like_source_echo_line(bullet))
    generic_definition_count = sum(1 for bullet in bullets if _looks_like_generic_definition(bullet))
    meta_answer_count = sum(1 for bullet in bullets if _looks_like_meta_answer_line(bullet))

    if source_echo_count:
        reasons.append("Final answer is echoing source titles, breadcrumbs, or page descriptions instead of synthesizing findings")

    if meta_answer_count:
        reasons.append("Final answer describes where the information lives instead of stating the verified answer")

    if verdict_topic == "standings":
        meaningful_markers = ["playoff", "top four", "nrr", "net run rate", "points", "position", "race", "qualify", "table", "ranking"]
        if not _has_any_keyword("\n".join(bullets), meaningful_markers):
            reasons.append("Standings verdict is missing race-relevant details like points, NRR, playoff pressure, or ranking movement")
        if generic_definition_count >= max(1, len(bullets) // 2):
            reasons.append("Standings answer reads like a generic rules explanation instead of a verdict on the current race")
    elif verdict_topic == "updates":
        update_markers = ["released", "release", "launched", "introduced", "expanded", "supports", "support", "added", "new", "changelog", "update", "model", "token", "multimodal", "reasoning"]
        if not _has_any_keyword("\n".join(bullets), update_markers):
            reasons.append("Update summary is missing concrete change-oriented details and reads more like source description text")
        if generic_definition_count >= max(1, len(bullets) // 2):
            reasons.append("Update summary reads like generic documentation or source copy instead of current changes")
    elif verdict_topic == "news":
        freshness_markers = ["april", "2026", "today", "latest", "updated", "announced", "launch", "flight", "test", "delay"]
        if not _has_any_keyword("\n".join(bullets), freshness_markers):
            reasons.append("News snapshot is missing freshness or event markers and reads too generic")

    return reasons


def _contains_any_fragment(text: str, fragments: List[str]) -> bool:
    lowered = _lower(text)
    return any(fragment.lower() in lowered for fragment in fragments)


def _tool_names(result: Dict[str, Any]) -> List[str]:
    names: List[str] = []
    for item in result.get("tool_calls", []):
        name = (item or {}).get("name")
        if name:
            names.append(name)
    for item in result.get("tool_results", []):
        if not isinstance(item, dict):
            continue
        name = item.get("tool_name") or item.get("name")
        if name:
            names.append(name)
    return names


def _has_any_tool(result: Dict[str, Any], tool_names: List[str]) -> bool:
    called = set(_tool_names(result))
    return any(name in called for name in tool_names)


def _tool_result_text(result: Dict[str, Any], tool_name: str) -> str:
    chunks: List[str] = []
    for item in result.get("tool_results", []):
        if not isinstance(item, dict):
            continue
        name = item.get("tool_name") or item.get("name")
        if name != tool_name:
            continue
        output = item.get("output")
        if isinstance(output, dict):
            chunks.append(json.dumps(output))
        elif output is not None:
            chunks.append(str(output))
        if item.get("error"):
            chunks.append(str(item.get("error")))
    return "\n".join(chunks)


def _tool_result_text_any(result: Dict[str, Any], tool_names: List[str]) -> str:
    for tool_name in tool_names:
        text = _tool_result_text(result, tool_name)
        if text:
            return text
    return ""


def _tool_results_named(result: Dict[str, Any], tool_name: str) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for item in result.get("tool_results", []):
        if not isinstance(item, dict):
            continue
        name = item.get("tool_name") or item.get("name")
        if name == tool_name:
            matches.append(item)
    return matches


def _latest_tool_result(result: Dict[str, Any], tool_name: str) -> Optional[Dict[str, Any]]:
    matches = _tool_results_named(result, tool_name)
    return matches[-1] if matches else None


def _search_state(result: Dict[str, Any]) -> Dict[str, Any]:
    latest = _latest_tool_result(result, "web_search")
    if not latest:
        return {"called": False, "failed": False, "provider_failure": False, "status": "missing", "results": []}
    output = latest.get("output") if isinstance(latest.get("output"), dict) else {}
    status = str((output or {}).get("status") or ("execution_failure" if latest.get("error") else "ok"))
    results = (output or {}).get("results") if isinstance(output, dict) else []
    failed = bool(latest.get("error"))
    provider_failure = status in {"transport_failure", "timeout", "rate_limited", "network_failure", "execution_failure"}
    return {
        "called": True,
        "failed": failed,
        "provider_failure": provider_failure,
        "status": status,
        "results": results if isinstance(results, list) else [],
        "error": latest.get("error"),
    }


def _has_plan_signal(result: Dict[str, Any]) -> bool:
    provenance = result.get("provenance") or {}
    steps = provenance.get("steps") or []
    return any((step or {}).get("step_type") == "plan" or (step or {}).get("stepType") == "plan" for step in steps)


def _review_steps(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    provenance = result.get("provenance") or {}
    steps = provenance.get("steps") or []
    return [
        step for step in steps
        if (step or {}).get("step_type") == "review" or (step or {}).get("stepType") == "review"
    ]


def _synthesis_steps(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    provenance = result.get("provenance") or {}
    steps = provenance.get("steps") or []
    return [
        step for step in steps
        if (step or {}).get("step_type") == "synthesis" or (step or {}).get("stepType") == "synthesis"
    ]


def _plan_step_texts(result: Dict[str, Any]) -> List[str]:
    provenance = result.get("provenance") or {}
    steps = provenance.get("steps") or []
    texts: List[str] = []
    for step in steps:
        if (step or {}).get("step_type") == "plan" or (step or {}).get("stepType") == "plan":
            summary = (
                (step or {}).get("input_summary")
                or (step or {}).get("inputSummary")
                or (step or {}).get("output_summary")
                or (step or {}).get("outputSummary")
                or ""
            )
            if summary:
                texts.append(str(summary))
    return texts


def _contains_banned_output(text: str) -> Optional[str]:
    lowered = _lower(text)
    for marker in BANNED_OUTPUT_MARKERS:
        if marker.lower() in lowered:
            return marker
    return None


def _looks_markdownish(text: str) -> bool:
    stripped = (text or "").strip()
    return (
        "\n- " in stripped
        or stripped.startswith("- ")
        or "## " in stripped
        or "### " in stripped
        or bool(re.search(r"\n\d+\.\s", stripped))
    )


def _review_approved(result: Dict[str, Any]) -> bool:
    if result.get("review_events"):
        latest = result["review_events"][-1]
        approved = latest.get("approved")
        if isinstance(approved, bool):
            return approved
    for step in _review_steps(result):
        summary = ((step or {}).get("output_summary") or (step or {}).get("outputSummary") or "")
        if "APPROVED" in summary:
            return True
    return False


async def get_token() -> str:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/auth/token", json={"secret": AUTH_SECRET}, timeout=10.0)
            if resp.status_code in (200, 201):
                return resp.json().get("access_token", "")
    except Exception:
        pass
    return ""


async def create_test_agent(token: str, model_id: str, prompt_pack_id: str = "rawclaw-default") -> Optional[str]:
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "name": f"Web-Research-Eval-{uuid4().hex[:4]}",
        "description": "Focused evaluator agent for progressive web-research testing",
        "modelId": model_id,
        "systemPrompt": (
            "You are RawClaw Web Research Eval Agent. "
            "For current-information tasks, plan first, prefer grounded search/fetch workflows, "
            "use markdown notes and concise final drafts, and preserve reviewer truthfulness. "
            "Do not loop on sequential_thinking; use it only when absolutely necessary."
        ),
        "promptPackId": prompt_pack_id,
        "promptOverlay": (
            "Use the configured prompt pack as the primary behavior source. "
            "For web research tasks, prefer grounded evidence and preserve markdown structure."
        ),
        "skills": ["grounded-web-summary"],
        "isDefault": False,
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{API_BASE}/agents", json=payload, headers=headers, timeout=20.0)
            if resp.status_code in (200, 201):
                agent_id = resp.json().get("id")
                log_success(f"Test Agent created: {agent_id}")
                return agent_id
            log_error(f"Failed to create agent: {resp.status_code} - {resp.text}")
    except Exception as exc:
        log_error(f"Agent creation error: {exc}")
    return None


async def send_chat(session_id: str, message: str, agent_id: str, token: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "content": "",
        "thinking": [],
        "tool_calls": [],
        "tool_results": [],
        "review_events": [],
        "raw_events": [],
        "approval_requested": False,
        "provenance": None,
        "ttft": 0.0,
        "total_time": 0.0,
        "success": False,
        "error": None,
    }

    headers = {"Authorization": f"Bearer {token}"}
    start_time = time.time()

    try:
        timeout = httpx.Timeout(connect=20.0, read=95.0, write=20.0, pool=20.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{API_BASE}/chat/send",
                headers=headers,
                json={
                    "session_id": session_id,
                    "messages": [{"role": "user", "content": message}],
                    "agent_id": agent_id,
                    "stream": True,
                },
            ) as resp:
                if resp.status_code not in (200, 201):
                    body = await resp.aread()
                    result["error"] = f"HTTP {resp.status_code}: {body.decode(errors='ignore')}"
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
                        if not data_str or data_str == "[DONE]":
                            continue

                        try:
                            data = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        result["raw_events"].append(data)
                        event_type = data.get("type")
                        if event_type == "content":
                            if not result["content"]:
                                result["ttft"] = time.time() - start_time
                            result["content"] += data.get("content", "")
                        elif event_type == "thinking":
                            thought = data.get("thinking", "")
                            if thought:
                                result["thinking"].append(thought)
                        elif event_type == "tool_call":
                            result["tool_calls"].append(data.get("tool_call") or {})
                            log_info(f"Tool Call: {(data.get('tool_call') or {}).get('name')}")
                        elif event_type == "tool_result":
                            tool_result = data.get("tool_result") or {}
                            result["tool_results"].append(tool_result)
                            name = tool_result.get("tool_name", "unknown")
                            error = tool_result.get("error")
                            if error:
                                log_info(f"Tool Result ({name}): Error - {str(error)[:60]}")
                            else:
                                log_info(f"Tool Result ({name}): Success")
                        elif event_type == "review_result":
                            result["review_events"].append({
                                "approved": data.get("approved"),
                                "feedback": data.get("feedback", ""),
                                "reviewer_id": data.get("reviewer_id"),
                            })
                            log_info(
                                f"Review Result: {'APPROVED' if data.get('approved') else 'REJECTED'}"
                            )
                        elif event_type == "approval_required":
                            result["approval_requested"] = True
                            log_info(f"Approval requested: {data.get('reason', '')}")
                        elif event_type == "provenance":
                            result["provenance"] = data.get("provenanceTrace") or data.get("provenance_trace") or data.get("provenance")
                        elif event_type == "error":
                            result["error"] = data.get("message") or data.get("error")
                        elif event_type == "done":
                            result["success"] = True
    except httpx.ReadTimeout:
        result["error"] = "ReadTimeout: The stream went silent before completing."
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"

    result["total_time"] = time.time() - start_time
    return result


async def get_session_messages(session_id: str, token: str) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(f"{API_BASE}/chat/sessions/{session_id}", headers=headers)
            if resp.status_code in (200, 201):
                payload = resp.json() or {}
                return payload.get("messages", []) or []
    except Exception:
        pass
    return []


async def attach_persisted_prompt_metadata(session_id: str, token: str, result: Dict[str, Any]) -> None:
    messages = await get_session_messages(session_id, token)
    assistant_messages = [msg for msg in messages if isinstance(msg, dict) and msg.get("role") == "assistant"]
    if not assistant_messages:
        return
    latest = assistant_messages[-1]
    result["persisted_prompt_metadata"] = {
        "promptPackId": latest.get("promptPackId"),
        "promptVersionHash": latest.get("promptVersionHash"),
        "reviewerPromptVersionHash": latest.get("reviewerPromptVersionHash"),
        "workflowPromptIds": latest.get("workflowPromptIds") or [],
    }


def validate_step(step: Dict[str, Any], result: Dict[str, Any]) -> List[str]:
    reasons: List[str] = []
    content = result.get("content", "")

    if result.get("error"):
        reasons.append(result["error"])
        return reasons

    if not content.strip():
        reasons.append("Response content is empty")

    banned = _contains_banned_output(content)
    if banned:
        reasons.append(f"Raw leakage detected: {banned}")

    if not _has_plan_signal(result):
        reasons.append("No plan step detected in provenance")

    if not _has_any_tool(result, ["skill_grounded-web-summary"]):
        reasons.append("Grounded web summary skill was not used")

    if not _has_any_tool(result, SEARCH_TOOL_NAMES):
        reasons.append("No search tool was called")

    search_state = _search_state(result)
    search_failed = search_state["failed"]
    fetch_called = _has_any_tool(result, BROWSE_TOOL_NAMES)
    lowered_content = _lower(content)
    graceful_outage_answer = (
        search_failed
        and not fetch_called
        and (
            "could not verify" in lowered_content
            or "search provider did not return usable results" in lowered_content
            or "search results did not return strong, clearly relevant evidence" in lowered_content
            or "provider failed before strong evidence could be gathered" in lowered_content
        )
    )

    if not _review_steps(result):
        reasons.append("No review step detected in provenance")
    elif not _review_approved(result) and not graceful_outage_answer:
        reasons.append("Reviewer did not approve the final draft")

    if step.get("require_fetch") and not fetch_called and not search_state["provider_failure"]:
        reasons.append("No fetch/browser fallback tool was called")

    if step.get("require_markdown") and not _looks_markdownish(content):
        reasons.append("Final answer is not markdown-structured")

    if step.get("require_keywords"):
        for keyword in step["require_keywords"]:
            if not _has_keyword(content, keyword):
                reasons.append(f"Missing keyword: {keyword}")

    if step.get("require_any_keywords"):
        if not _has_any_keyword(content, step["require_any_keywords"]):
            reasons.append(f"None of the broader topic markers were found: {step['require_any_keywords']}")

    if step.get("forbid_keywords"):
        for keyword in step["forbid_keywords"]:
            if _has_keyword(content, keyword):
                reasons.append(f"Forbidden keyword found: {keyword}")

    if step.get("forbid_fragments"):
        for fragment in step["forbid_fragments"]:
            if fragment.lower() in _lower(content):
                reasons.append(f"Forbidden fragment found: {fragment}")

    if step.get("max_chars") and len(content) > step["max_chars"]:
        reasons.append(f"Final answer is too long ({len(content)} chars > {step['max_chars']})")

    if step.get("min_bullets") and not search_failed:
        bullet_count = _count_markdown_bullets(content)
        if bullet_count < step["min_bullets"]:
            reasons.append(f"Expected at least {step['min_bullets']} markdown bullets, found {bullet_count}")

    if step.get("required_headings"):
        for heading in step["required_headings"]:
            if _count_heading(content, heading) == 0:
                reasons.append(f"Missing markdown heading: {heading}")

    if step.get("forbid_reviewer_note") and "reviewer note:" in _lower(content):
        reasons.append("Final answer leaked reviewer note text")

    if step.get("forbid_irrelevant_markers") and _contains_any_fragment(content, COMMON_IRRELEVANT_MARKERS):
        reasons.append("Final answer contains clearly irrelevant source/page markers")

    reasons.extend(_verdict_reasons(step, content))

    if step.get("require_search_success"):
        if search_failed and not graceful_outage_answer:
            reasons.append("Search step did not succeed cleanly")

    if step.get("require_fetch_relevance") and fetch_called:
        fetch_text = _tool_result_text_any(result, BROWSE_TOOL_NAMES)
        relevance_markers = step.get("fetch_relevance_markers", [])
        if relevance_markers and not _has_any_keyword(fetch_text, relevance_markers):
            reasons.append(f"Fetched page does not appear relevant enough: expected one of {relevance_markers}")
        if _contains_any_fragment(fetch_text, COMMON_IRRELEVANT_MARKERS):
            reasons.append("Fetched page appears clearly irrelevant to the task")

    if _has_any_tool(result, ["web_extract"]):
        extract_results = _tool_results_named(result, "web_extract")
        latest_extract = extract_results[-1] if extract_results else {}
        extract_output = latest_extract.get("output") if isinstance(latest_extract, dict) else {}
        if not isinstance(extract_output, dict) or not extract_output.get("backendUsed"):
            reasons.append("web_extract did not persist backendUsed diagnostics")
        if not isinstance(extract_output, dict) or "backendAttempts" not in extract_output:
            reasons.append("web_extract did not persist backendAttempts diagnostics")
        if not isinstance(extract_output, dict) or "pageKind" not in extract_output:
            reasons.append("web_extract did not persist pageKind diagnostics")

    provenance = result.get("provenance") or {}
    metadata = provenance.get("metadata") or {}
    internal_stages = metadata.get("internalResearchStages") or {}
    plan_step_text = " ".join(_plan_step_texts(result)).lower()
    if _has_any_tool(result, SEARCH_TOOL_NAMES):
        stage_fallback_markers = {
            "research-planner": "internal research planner classified",
            "extract-router": "internal extract router chose",
            "evidence-judge": "evidence judge scored quality=",
            "answerability-gate": "answerability gate selected mode=",
            "final-writer": "final writer produced a",
        }
        for required_stage in ["research-planner", "extract-router", "evidence-judge", "answerability-gate", "final-writer"]:
            if required_stage not in internal_stages and stage_fallback_markers[required_stage] not in plan_step_text:
                reasons.append(f"Missing internal research stage metadata: {required_stage}")
        answerability = internal_stages.get("answerability-gate") or {}
        if isinstance(answerability, dict) and not answerability.get("mode") and "answerability gate selected mode=" not in plan_step_text:
            reasons.append("answerability-gate did not persist its final mode")
        extract_router = internal_stages.get("extract-router") or {}
        if isinstance(extract_router, dict) and not extract_router.get("backend_order") and "backend_order=" not in plan_step_text:
            reasons.append("extract-router did not persist backend order")

    synthesis_steps = _synthesis_steps(result)
    if not synthesis_steps:
        reasons.append("No synthesis step detected in provenance")

    prompt_metadata = result.get("persisted_prompt_metadata") or {}
    if not prompt_metadata.get("promptPackId"):
        reasons.append("No persisted prompt pack metadata found on the final assistant message")
    if not prompt_metadata.get("promptVersionHash"):
        reasons.append("No persisted prompt version hash found on the final assistant message")

    review_steps = _review_steps(result)
    if review_steps and synthesis_steps:
        review_last = review_steps[-1]
        synthesis_last = synthesis_steps[-1]
        review_index = review_last.get("step_type") or review_last.get("stepType")
        synthesis_index = synthesis_last.get("step_type") or synthesis_last.get("stepType")
        if review_index is None or synthesis_index is None:
            pass

    return reasons


def build_diagnostics(step: Dict[str, Any], result: Dict[str, Any], reasons: List[str]) -> Dict[str, Any]:
    provenance = result.get("provenance") or {}
    steps = provenance.get("steps") or []
    step_types = [
        (item or {}).get("step_type") or (item or {}).get("stepType")
        for item in steps
    ]
    tool_calls = result.get("tool_calls", [])
    tool_results = result.get("tool_results", [])
    review_events = result.get("review_events", [])
    content = result.get("content", "")

    return {
        "prompt": step.get("msg", ""),
        "error": result.get("error"),
        "latency_seconds": result.get("total_time"),
        "ttft_seconds": result.get("ttft"),
        "tool_call_sequence": [tc.get("name") for tc in tool_calls if isinstance(tc, dict)],
        "tool_result_sequence": [
            (tr.get("tool_name") or tr.get("name"))
            for tr in tool_results if isinstance(tr, dict)
        ],
        "review_feedback": review_events,
        "provenance_step_types": step_types,
        "final_answer_preview": content[:1200],
        "final_answer_length": len(content),
        "markdown_detected": _looks_markdownish(content),
        "keyword_checks": {
            "required": {
                keyword: _has_keyword(content, keyword)
                for keyword in step.get("require_keywords", [])
            },
            "forbidden": {
                keyword: _has_keyword(content, keyword)
                for keyword in step.get("forbid_keywords", [])
            },
        },
        "validation_reasons": reasons,
        "provider_failure_tagged": _search_state(result)["provider_failure"],
        "raw_event_count": len(result.get("raw_events", [])),
        "raw_events_preview": result.get("raw_events", [])[:20],
        "persisted_prompt_metadata": result.get("persisted_prompt_metadata") or {},
    }


def print_diagnostics(step_index: int, diagnostics: Dict[str, Any]) -> None:
    log_info(f"Diagnostics[{step_index}] Tool calls: {diagnostics['tool_call_sequence']}")
    if diagnostics.get("review_feedback"):
        latest = diagnostics["review_feedback"][-1]
        log_info(
            f"Diagnostics[{step_index}] Last review: "
            f"{'APPROVED' if latest.get('approved') else 'REJECTED'} | "
            f"{str(latest.get('feedback', ''))[:180]}"
        )
    log_info(
        f"Diagnostics[{step_index}] Final preview: "
        f"{str(diagnostics.get('final_answer_preview', '')).replace(chr(10), ' ')[:220]}"
    )


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="RawClaw Focused Web Research Progression Test")
    parser.add_argument("model_id", nargs="?", default=DEFAULT_MODEL, help="Model ID to use")
    parser.add_argument("--model", type=str, help="Alias for model_id")
    parser.add_argument("--prompt-pack", default="rawclaw-default", help="Prompt pack id to assign to the eval agent")
    args, unknown = parser.parse_known_args()

    model_to_use = args.model or args.model_id
    if unknown:
        for token in unknown:
            if not token.startswith("-"):
                model_to_use = token
                break

    log_header("RawClaw Web Research Progression Test")

    token = await get_token()
    if not token:
        log_error("Auth failed. Ensure API is running.")
        sys.exit(1)

    agent_id = await create_test_agent(token, model_to_use, args.prompt_pack)
    if not agent_id:
        sys.exit(1)

    session_id = f"web-research-{uuid4().hex[:8]}"
    log_info(f"Session: {session_id}")
    log_info(f"Model:   {model_to_use}")
    log_info(f"Prompt Pack: {args.prompt_pack}")

    steps = [
        {
            "title": "Level 1: Fresh News Snapshot",
            "msg": (
                "Search the web for the latest SpaceX Starship updates and present a concise markdown answer with 3 bullets."
            ),
            "require_markdown": True,
            "require_keywords": ["spacex", "starship"],
            "min_bullets": 3,
            "forbid_reviewer_note": True,
            "require_search_success": True,
            "max_chars": 1800,
            "verdict_topic": "news",
        },
        {
            "title": "Level 2: Search + Fetch Grounded Summary",
            "msg": (
                "Research the latest Chennai Super Kings IPL 2026 points-table situation. "
                "Use web search, fetch the strongest page you find, and present a markdown summary with 4 bullets plus one uncertainty note if needed."
            ),
            "require_fetch": True,
            "require_markdown": True,
            "require_keywords": ["ipl", "points"],
            "require_any_keywords": ["csk", "chennai super kings", "standings", "nrr", "uncertainty"],
            "min_bullets": 4,
            "forbid_reviewer_note": True,
            "require_fetch_relevance": True,
            "fetch_relevance_markers": ["chennai", "super kings", "csk", "ipl", "points table", "standings"],
            "max_chars": 2200,
            "verdict_topic": "standings",
        },
        {
            "title": "Level 3: Comparative Research Memo",
            "msg": (
                "Search the web, fetch pages as needed, and write a compact markdown memo comparing two current OpenAI API updates. "
                "Present:\n"
                "## Findings\n"
                "- 3 bullets\n"
                "## Sources Used\n"
                "- short source list"
            ),
            "require_fetch": True,
            "require_markdown": True,
            "require_keywords": ["findings", "sources", "openai", "api"],
            "required_headings": ["Findings", "Sources Used"],
            "min_bullets": 4,
            "forbid_keywords": ["i already provided", "the user asked for"],
            "forbid_fragments": COMMON_IRRELEVANT_MARKERS,
            "forbid_reviewer_note": True,
            "require_fetch_relevance": True,
            "fetch_relevance_markers": ["openai", "api", "model", "release", "update", "developer"],
            "max_chars": 2600,
            "verdict_topic": "updates",
            "verdict_section": "Findings",
        },
        {
            "title": "Level 4: Research Brief With Explicit Workflow",
            "msg": (
                "Do a full web research brief using search plus fetch/browse as needed, then present the final answer in markdown.\n\n"
                "Topic: what are the most important current developments around India's IPL 2026 standings race? "
                "Return only markdown with sections:\n"
                "## Research Notes\n"
                "## Draft\n"
                "## Final"
            ),
            "require_fetch": True,
            "require_markdown": True,
            "require_keywords": ["research notes", "draft", "final", "ipl", "standings"],
            "required_headings": ["Research Notes", "Draft", "Final"],
            "min_bullets": 3,
            "forbid_keywords": ["viewing ad", "tickets ad"],
            "forbid_fragments": COMMON_IRRELEVANT_MARKERS,
            "forbid_reviewer_note": True,
            "require_fetch_relevance": True,
            "fetch_relevance_markers": ["ipl", "standings", "points table", "cricket", "team", "nrr"],
            "max_chars": 3200,
            "verdict_topic": "standings",
            "verdict_section": "Final",
        },
        {
            "title": "Level 5: Source Ranking And Relevance Discipline",
            "msg": (
                "Research current OpenAI API updates, but be careful: ignore generic markdown editors, docs about the browser Fetch API, "
                "or unrelated tool pages. Use search plus fetch as needed and return markdown with sections:\n"
                "## Findings\n"
                "- 3 bullets\n"
                "## Why These Sources\n"
                "- 2 bullets"
            ),
            "require_fetch": True,
            "require_markdown": True,
            "require_keywords": ["findings", "sources", "openai", "api"],
            "required_headings": ["Findings", "Why These Sources"],
            "min_bullets": 5,
            "forbid_fragments": COMMON_IRRELEVANT_MARKERS,
            "forbid_reviewer_note": True,
            "require_fetch_relevance": True,
            "fetch_relevance_markers": ["openai", "api", "developer", "release", "model", "announcement"],
            "max_chars": 2800,
            "verdict_topic": "updates",
            "verdict_section": "Findings",
        },
        {
            "title": "Level 6: Evidence-Aware Standings Brief",
            "msg": (
                "Do a harder web brief on India's IPL 2026 standings race. Search the web, fetch the strongest page, and return only markdown:\n"
                "## Research Notes\n"
                "- 3 bullets\n"
                "## Final\n"
                "- 3 bullets\n"
                "If evidence is incomplete, explicitly say what could not be verified."
            ),
            "require_fetch": True,
            "require_markdown": True,
            "require_keywords": ["research notes", "final", "ipl", "standings"],
            "require_any_keywords": ["could not verify", "uncertain", "nrr", "points", "playoffs"],
            "required_headings": ["Research Notes", "Final"],
            "min_bullets": 6,
            "forbid_fragments": COMMON_IRRELEVANT_MARKERS,
            "forbid_reviewer_note": True,
            "require_fetch_relevance": True,
            "fetch_relevance_markers": ["ipl", "standings", "points table", "cricket", "team", "nrr", "playoffs"],
            "max_chars": 3000,
            "verdict_topic": "standings",
            "verdict_section": "Final",
        },
    ]

    results = []
    log_header("Running Progressive Web Suite")
    for index, step in enumerate(steps, 1):
        log_step(index, step["title"], len(steps))
        log_send(step["msg"])
        result = await send_chat(session_id, step["msg"], agent_id, token)
        await attach_persisted_prompt_metadata(session_id, token, result)
        if result.get("error"):
            log_error(result["error"])
        else:
            log_recv(result["content"], result["total_time"])

        reasons = validate_step(step, result)
        diagnostics = build_diagnostics(step, result, reasons)
        passed = not reasons
        if passed:
            log_success("Response validated.")
        else:
            for reason in reasons:
                log_info(f"Validation Note: {reason}")
            print_diagnostics(index, diagnostics)
            log_info("Validation failed.")

        results.append({
            "step": index,
            "title": step["title"],
            "passed": passed,
            "latency": result.get("total_time", 0),
            "reasons": reasons,
            "tool_calls": _tool_names(result),
            "content": result.get("content", ""),
            "review_events": result.get("review_events", []),
            "provenance": result.get("provenance"),
            "prompt_metadata": result.get("persisted_prompt_metadata"),
            "diagnostics": diagnostics,
        })

    passed_count = sum(1 for item in results if item["passed"])
    log_header("Final Report")
    print(f"Total Web Research Cases: {len(results)}")
    print(f"Passed:                  {passed_count}")
    print(f"Pass Rate:               {((passed_count / len(results)) * 100):.1f}%")

    out_path = f"web-research-results-{session_id}.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({
            "session_id": session_id,
            "model": model_to_use,
            "prompt_pack_id": args.prompt_pack,
            "results": results,
        }, fh, indent=2)
    log_info(f"Full report saved to {out_path}")

    diag_path = f"web-research-diagnostics-{session_id}.json"
    with open(diag_path, "w", encoding="utf-8") as fh:
        json.dump({
            "session_id": session_id,
            "model": model_to_use,
            "prompt_pack_id": args.prompt_pack,
            "results": [
                {
                    "step": item["step"],
                    "title": item["title"],
                    "passed": item["passed"],
                    "diagnostics": item["diagnostics"],
                }
                for item in results
            ],
        }, fh, indent=2)
    log_info(f"Diagnostics saved to {diag_path}")

    if passed_count != len(results):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
