import asyncio
import json
import logging
import re
import time
from html import unescape
from typing import Any, Dict, List, Optional

from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.browser_capability import check_browser_page_read_capability
from src.tools.builtin.page_read_types import (
    BROWSER_SEMAPHORE_CAPACITY,
    LIVE_DATA_MIN_CONTENT_CHARS,
    PAGE_READ_BROWSER_MAX_QUEUE_DEPTH,
    PageReadContext,
    PageReadResult,
    find_url_field,
    normalize_backend_attempt,
    normalize_redirected_url,
)

logger = logging.getLogger("rawclaw.tools.browser_page_read")

BROWSER_PAGE_READ_SEMAPHORE = asyncio.Semaphore(BROWSER_SEMAPHORE_CAPACITY)
BROWSER_PAGE_READ_TIMEOUT_SECONDS = 30.0
BROWSER_SETTLE_DELAY_SECONDS = 3.0
BROWSER_SETTLE_DELAY_JS_HEAVY_SECONDS = 5.0
_queue_lock = asyncio.Lock()
_waiting_count = 0


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", unescape(str(text or ""))).strip()


def _strip_html(html: str) -> str:
    without_scripts = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", str(html or ""), flags=re.IGNORECASE | re.DOTALL)
    return _clean_text(re.sub(r"<[^>]+>", " ", without_scripts))


def _nested_get(value: Any, path: List[str]) -> Any:
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _stringify_candidate(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _clean_text(value)
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return _clean_text(json.dumps(value, ensure_ascii=False)[:50000])
    except TypeError:
        return _clean_text(str(value)[:50000])


def _collect_accessibility_text(value: Any, out: List[str], limit: int = 300) -> None:
    if len(out) >= limit:
        return
    if isinstance(value, dict):
        for key in ("text", "name", "value", "description"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
        for child_key in ("children", "nodes", "items"):
            child = value.get(child_key)
            if isinstance(child, (list, dict)):
                _collect_accessibility_text(child, out, limit=limit)
    elif isinstance(value, list):
        for item in value:
            _collect_accessibility_text(item, out, limit=limit)
            if len(out) >= limit:
                break


def _extract_html(value: Any) -> str:
    for path in (["html"], ["content", "html"], ["result", "html"], ["data", "html"]):
        item = _nested_get(value, path)
        if isinstance(item, str) and item.strip():
            return item
    return ""


def _extract_title(snapshot: Dict[str, Any], html: str) -> str:
    for path in (["metadata", "title"], ["meta", "title"], ["title"], ["result", "title"], ["data", "title"]):
        item = _nested_get(snapshot, path)
        if isinstance(item, str) and item.strip():
            return _clean_text(item)[:240]
    match = re.search(r"<title[^>]*>(.*?)</title>", html or "", flags=re.IGNORECASE | re.DOTALL)
    return _clean_text(match.group(1))[:240] if match else ""


def _extract_structured_data(snapshot: Dict[str, Any], html: str) -> Dict[str, Any]:
    structured = snapshot.get("structuredData") or _nested_get(snapshot, ["result", "structuredData"])
    if isinstance(structured, dict):
        return structured
    for match in re.finditer(
        r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        html or "",
        flags=re.IGNORECASE | re.DOTALL,
    ):
        try:
            parsed = json.loads(unescape(match.group(1)).strip())
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list):
                return {"jsonLd": parsed[:5]}
        except Exception:
            continue
    return {}


def _extract_landed_url(context_url: str, navigation_output: Dict[str, Any], snapshot: Dict[str, Any]) -> Optional[str]:
    candidates = [
        _nested_get(snapshot, ["metadata", "url"]),
        snapshot.get("currentUrl"),
        navigation_output.get("url"),
        navigation_output.get("currentUrl"),
    ]
    for candidate in candidates:
        value = str(candidate or "").strip()
        normalized = normalize_redirected_url(context_url, value)
        if normalized:
            return normalized
    return None


def _extract_snapshot_text(snapshot: Dict[str, Any]) -> str:
    for path in (
        ["text"],
        ["content", "text"],
        ["content", "body"],
        ["result", "text"],
        ["result", "content"],
        ["result", "snapshot"],
        ["output"],
        ["data", "text"],
    ):
        item = _nested_get(snapshot, path)
        text = _stringify_candidate(item)
        if text:
            return text

    acc_parts: List[str] = []
    for path in (["accessibility"], ["result", "accessibility"], ["snapshot"], ["result", "snapshot"]):
        item = _nested_get(snapshot, path)
        if item:
            _collect_accessibility_text(item, acc_parts)
            if acc_parts:
                return _clean_text(" ".join(acc_parts))

    html = _extract_html(snapshot)
    if html:
        return _strip_html(html)

    try:
        return _strip_html(json.dumps(snapshot, ensure_ascii=False)[:50000].translate(str.maketrans({"{": " ", "}": " ", "[": " ", "]": " ", '"': " "})))
    except Exception:
        return _clean_text(str(snapshot)[:50000])


def _classify_browser_content(content: str, min_content_chars: int) -> Dict[str, Any]:
    char_count = len(re.sub(r"\s+", "", content or ""))
    word_count = len(str(content or "").split())
    if not content or char_count < min_content_chars:
        return {"quality": "extract_garbage", "tier": "failed", "confidence": 0.05, "wordCount": word_count}
    if word_count >= 220:
        return {"quality": "extract_clean", "tier": "clean", "confidence": min(1.0, round(0.9 + min(word_count / 1200, 0.1), 3)), "wordCount": word_count}
    if word_count >= 80:
        return {"quality": "extract_partial", "tier": "partial", "confidence": 0.78, "wordCount": word_count}
    return {"quality": "extract_partial", "tier": "thin", "confidence": 0.45, "wordCount": word_count}


def _page_type_for_kind(page_kind: str) -> str:
    if page_kind == "news/article":
        return "article"
    if page_kind == "standings/table":
        return "data_table"
    if page_kind == "docs/changelog":
        return "article"
    return "general"


def _wait_payload(schema: Dict[str, Any], seconds: float) -> Optional[Dict[str, Any]]:
    properties = schema.get("properties") if isinstance(schema, dict) else {}
    if not isinstance(properties, dict):
        return None
    lowered = {str(key).lower(): str(key) for key in properties.keys()}
    for candidate in ["timeoutms", "timeout_ms", "millis", "milliseconds", "durationms", "duration_ms"]:
        if candidate in lowered:
            return {lowered[candidate]: int(seconds * 1000)}
    for candidate in ["timeout", "seconds", "duration", "delay"]:
        if candidate in lowered:
            prop = properties.get(lowered[candidate]) or {}
            maximum = prop.get("maximum") if isinstance(prop, dict) else None
            if str(candidate) == "timeout" and isinstance(maximum, (int, float)) and maximum > 60:
                return {lowered[candidate]: int(seconds * 1000)}
            return {lowered[candidate]: seconds}
    return None


class BrowserPageReadAdapter:
    def __init__(self, tool_registry=TOOL_REGISTRY) -> None:
        self.tool_registry = tool_registry

    async def read_page(self, context: PageReadContext) -> PageReadResult:
        if not await check_browser_page_read_capability(self.tool_registry):
            return PageReadResult(
                url=context.url,
                backendUsed="browser",
                backendResult="skipped",
                evidenceStatus="degraded",
                backendAttempts=[normalize_backend_attempt(attempt_seq=2, backend="browser", result="skipped", error="browser page-read unavailable")],
                failureChain=["browser: skipped (missing co-located navigate/snapshot tools)"],
                error="browser page-read unavailable",
                pageKind=context.page_kind,
                pageType=_page_type_for_kind(context.page_kind),
                taskType=context.task_type,
                sourceMode=context.source_mode,
                minContentChars=context.min_content_chars,
            )

        if not await self._try_queue_waiter():
            return PageReadResult(
                url=context.url,
                backendUsed="browser",
                backendResult="skipped",
                evidenceStatus="degraded",
                backendAttempts=[normalize_backend_attempt(attempt_seq=2, backend="browser", result="skipped", error="browser queue full")],
                failureChain=["browser: skipped (queue full)"],
                error="browser queue full",
                pageKind=context.page_kind,
                pageType=_page_type_for_kind(context.page_kind),
                taskType=context.task_type,
                sourceMode=context.source_mode,
                minContentChars=context.min_content_chars,
            )

        counted_as_waiting = True
        acquired = False
        try:
            await BROWSER_PAGE_READ_SEMAPHORE.acquire()
            acquired = True
            # Waiting-count cleanup and semaphore release have different lifetimes:
            # we stop counting as queued once the caller enters active browser work,
            # but we still must release the semaphore after the active sequence ends.
            await self._decrement_waiter()
            counted_as_waiting = False
            try:
                return await asyncio.wait_for(
                    self._read_page_active(context),
                    timeout=BROWSER_PAGE_READ_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                return PageReadResult(
                    url=context.url,
                    backendUsed="browser",
                    backendResult="failed",
                    evidenceStatus="failed",
                    backendAttempts=[normalize_backend_attempt(attempt_seq=2, backend="browser", result="failed", error="browser page-read timeout")],
                    failureChain=["browser: failed (timeout)"],
                    error="browser page-read timeout",
                    pageKind=context.page_kind,
                    pageType=_page_type_for_kind(context.page_kind),
                    taskType=context.task_type,
                    sourceMode=context.source_mode,
                    minContentChars=context.min_content_chars,
                )
            finally:
                if acquired:
                    BROWSER_PAGE_READ_SEMAPHORE.release()
        finally:
            if counted_as_waiting:
                await self._decrement_waiter()

    async def _try_queue_waiter(self) -> bool:
        global _waiting_count
        async with _queue_lock:
            if _waiting_count >= PAGE_READ_BROWSER_MAX_QUEUE_DEPTH:
                return False
            _waiting_count += 1
            return True

    async def _decrement_waiter(self) -> None:
        global _waiting_count
        async with _queue_lock:
            _waiting_count = max(0, _waiting_count - 1)

    async def _read_page_active(self, context: PageReadContext) -> PageReadResult:
        start = time.monotonic()
        navigate = self.tool_registry.get("browser_navigate")
        snapshot_tool = self.tool_registry.get("browser_snapshot")
        navigate_key = find_url_field(getattr(navigate, "parameters", {}) or {})
        if not navigate_key:
            return PageReadResult(
                url=context.url,
                backendUsed="browser",
                backendResult="failed",
                evidenceStatus="failed",
                backendAttempts=[normalize_backend_attempt(attempt_seq=2, backend="browser", result="failed", error="browser_navigate URL field unavailable")],
                failureChain=["browser: failed (navigate schema missing URL field)"],
                error="browser_navigate URL field unavailable",
                pageKind=context.page_kind,
                pageType=_page_type_for_kind(context.page_kind),
                taskType=context.task_type,
                sourceMode=context.source_mode,
                minContentChars=context.min_content_chars,
            )

        try:
            navigate_result = await navigate.execute({navigate_key: context.url})
            if navigate_result.error:
                raise RuntimeError(navigate_result.error)
            navigate_output = navigate_result.output if isinstance(navigate_result.output, dict) else {}
            await self._wait_for_render(context)
            snapshot_result = await snapshot_tool.execute({})
            if snapshot_result.error:
                raise RuntimeError(snapshot_result.error)
            snapshot = snapshot_result.output if isinstance(snapshot_result.output, dict) else {"output": snapshot_result.output}
        except Exception as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            return PageReadResult(
                url=context.url,
                backendUsed="browser",
                backendResult="failed",
                evidenceStatus="failed",
                backendAttempts=[normalize_backend_attempt(attempt_seq=2, backend="browser", result="failed", error=str(exc)[:240], duration_ms=duration_ms)],
                failureChain=[f"browser: failed ({str(exc)[:120]})"],
                error=str(exc)[:240],
                pageKind=context.page_kind,
                pageType=_page_type_for_kind(context.page_kind),
                taskType=context.task_type,
                sourceMode=context.source_mode,
                minContentChars=context.min_content_chars,
            )

        html = _extract_html(snapshot)
        content = _extract_snapshot_text(snapshot)
        title = _extract_title(snapshot, html)
        structured = _extract_structured_data(snapshot, html)
        metadata = _classify_browser_content(content, context.min_content_chars)
        backend_result = "success" if metadata["quality"] in {"extract_clean", "extract_partial"} and metadata["tier"] in {"clean", "partial"} else "garbage"
        local_error = "browser snapshot empty" if not content else None
        duration_ms = int((time.monotonic() - start) * 1000)
        failure_chain = [] if backend_result == "success" else [f"browser: garbage ({metadata['wordCount']} words)"]
        redirected_url = normalize_redirected_url(
            context.url,
            _extract_landed_url(context.url, navigate_output, snapshot) or context.url,
        )
        return PageReadResult(
            url=context.url,
            title=title,
            content=content,
            structuredData=structured,
            backendUsed="browser",
            backendResult=backend_result,
            evidenceStatus="strong" if backend_result == "success" and metadata["confidence"] >= 0.75 else ("failed" if local_error else "degraded"),
            backendAttempts=[normalize_backend_attempt(attempt_seq=2, backend="browser", result=backend_result, error=local_error, duration_ms=duration_ms)],
            failureChain=failure_chain,
            landed_url=redirected_url,
            quality=metadata["quality"],
            tier=metadata["tier"],
            confidence=metadata["confidence"],
            wordCount=metadata["wordCount"],
            pageKind=context.page_kind,
            pageType=_page_type_for_kind(context.page_kind),
            taskType=context.task_type,
            sourceMode=context.source_mode,
            jsRenderSuspected=context.js_render_suspected,
            minContentChars=context.min_content_chars,
            redirectedUrl=redirected_url,
            error=local_error,
        )

    async def _wait_for_render(self, context: PageReadContext) -> None:
        seconds = BROWSER_SETTLE_DELAY_JS_HEAVY_SECONDS if context.min_content_chars == LIVE_DATA_MIN_CONTENT_CHARS else BROWSER_SETTLE_DELAY_SECONDS
        wait_tool = self.tool_registry.get_optional("browser_wait_for")
        if wait_tool:
            payload = _wait_payload(getattr(wait_tool, "parameters", {}) or {}, seconds)
            if payload:
                result = await wait_tool.execute(payload)
                if not result.error:
                    return
                logger.warning("browser_wait_for failed, falling back to sleep: %s", result.error)
        await asyncio.sleep(seconds)
