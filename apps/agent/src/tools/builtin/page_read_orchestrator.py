import logging
import re
import time
from copy import deepcopy
from dataclasses import replace
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from src.contracts.tool import ToolResult
from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.browser_capability import check_browser_page_read_capability
from src.tools.builtin.browser_page_read_adapter import BrowserPageReadAdapter
from src.tools.builtin.page_read_types import (
    DEFAULT_MIN_CONTENT_CHARS,
    LIVE_DATA_MIN_CONTENT_CHARS,
    PageReadContext,
    PageReadResult,
    aggregate_backend_result,
    clamp_page_read_duration_ms,
    evidence_status_for_output,
    has_weak_signal,
    is_strong_evidence,
    meaningful_slug_segments,
    normalize_backend_attempt,
    provenance_subset,
)
from src.tools.builtin.web_extract import WebExtractTool

logger = logging.getLogger("rawclaw.tools.page_read_orchestrator")

TWO_PART_TLDS = {"co.uk", "com.au", "co.in", "co.nz", "com.br", "com.sg"}


def classify_page_kind(url: str) -> str:
    try:
        parsed = urlparse(url)
    except Exception:
        return "unknown"
    if not parsed.scheme or not parsed.netloc:
        return "unknown"
    segments = [segment.lower() for segment in parsed.path.split("/") if segment]
    if any(segment in {"standings", "table", "points-table", "leaderboard"} for segment in segments):
        return "standings/table"
    if any(segment in {"docs", "documentation", "changelog", "releases"} for segment in segments):
        return "docs/changelog"
    if any(segment in {"news", "article", "blog"} for segment in segments):
        return "news/article"
    return "general"


def _registered_domain_label(hostname: str) -> str:
    labels = [label for label in (hostname or "").lower().split(".") if label]
    if not labels:
        return ""
    if len(labels) >= 3 and ".".join(labels[-2:]) in TWO_PART_TLDS:
        return labels[-3]
    if len(labels) >= 2:
        return labels[-2]
    return labels[0]


def _is_live_data_url(url: str, page_kind: str) -> bool:
    parsed = urlparse(url)
    segments = [segment.lower() for segment in parsed.path.split("/") if segment]
    stem_match = any(re.search(r"(^|[-_])(scor|live|elect|stand|result|leaderboard|points)", segment) for segment in segments)
    context = " ".join([parsed.netloc.lower(), parsed.query.lower(), page_kind.lower()])
    context_match = any(token in context for token in ["election", "vote", "cricket", "sports", "date", "year", "standings", "score"])
    return bool(stem_match and context_match)


def _output_from_tool_result(result: Optional[ToolResult]) -> Dict[str, Any]:
    return result.output if result and isinstance(result.output, dict) else {}


class PageReadOrchestrator:
    def __init__(self, tool_registry=TOOL_REGISTRY) -> None:
        self.tool_registry = tool_registry
        self.extract_tool = WebExtractTool()
        self.browser_adapter = BrowserPageReadAdapter(tool_registry)

    async def read(self, context: PageReadContext, original_input: Dict[str, Any]) -> ToolResult:
        if not context.url:
            raise ValueError("PageReadContext.url cannot be empty")

        start = time.monotonic()
        browser_attempted = False
        attempts: List[Dict[str, Any]] = []
        failure_chain: List[str] = []

        http_result = await self._run_http_extract(context, original_input)
        http_output = _output_from_tool_result(http_result)
        http_page_result = self._page_result_from_http(context, http_result, http_output)
        attempts.append(http_page_result.backendAttempts[0])
        failure_chain.extend(http_page_result.failureChain)

        final_result = http_page_result
        if not is_strong_evidence(http_output) and has_weak_signal(http_output):
            updated_context = replace(
                context,
                js_render_suspected=bool(http_output.get("jsRenderSuspected")),
                min_content_chars=LIVE_DATA_MIN_CONTENT_CHARS
                if bool(http_output.get("jsRenderSuspected")) and _is_live_data_url(context.url, context.page_kind)
                else DEFAULT_MIN_CONTENT_CHARS,
            )
            if await check_browser_page_read_capability(self.tool_registry):
                browser_attempted = True
                browser_result = await self.browser_adapter.read_page(updated_context)
                attempts.extend(browser_result.backendAttempts)
                failure_chain.extend(browser_result.failureChain)
                if browser_result.backendResult == "success":
                    final_result = browser_result
                elif final_result.backendResult != "success":
                    final_result = browser_result if not final_result.content else final_result
            else:
                attempts.append(normalize_backend_attempt(attempt_seq=2, backend="browser", result="skipped", error="browser page-read unavailable"))
                failure_chain.append("browser: skipped (unavailable)")

        if not browser_attempted and all(attempt.get("attemptSeq") != 2 for attempt in attempts):
            attempts.append(normalize_backend_attempt(attempt_seq=2, backend="browser", result="skipped", error="not needed"))

        direct_success = any(
            attempt.get("backend") in {"http", "browser", "web_fetch", "web_fetch_raw_html", "web_fetch_raw_html_article"}
            and attempt.get("result") == "success"
            for attempt in attempts
        )
        if not direct_success:
            search_result = await self._run_search_fallback(context)
            attempts.extend(search_result.backendAttempts)
            failure_chain.extend(search_result.failureChain)
            if search_result.backendResult == "success":
                final_result = search_result
            elif not final_result.content:
                final_result = search_result
        elif all(attempt.get("attemptSeq") != 3 for attempt in attempts):
            attempts.append(normalize_backend_attempt(attempt_seq=3, backend="search_fallback", result="skipped", error="direct evidence accepted"))

        final_result.backendAttempts = sorted(attempts, key=lambda attempt: int(attempt.get("attemptSeq") or 0))
        final_result.failureChain = self._cap_failure_chain(failure_chain)
        final_result.backendResult = aggregate_backend_result(final_result.backendAttempts)
        if final_result.isFallback:
            final_result.backendUsed = "search_fallback"
            final_result.backendResult = "success"
            final_result.evidenceStatus = "degraded"
        elif final_result.backendResult == "success":
            final_result.evidenceStatus = evidence_status_for_output(final_result.as_dict())
        elif not final_result.content:
            final_result.evidenceStatus = "failed"
        else:
            final_result.evidenceStatus = "degraded"

        duration_ms = round((time.monotonic() - start) * 1000, 2)
        return self.to_tool_result(final_result, original_input, duration_ms)

    async def _run_http_extract(self, context: PageReadContext, original_input: Dict[str, Any]) -> ToolResult:
        requested = original_input.get("maxDurationMs")
        clamped = clamp_page_read_duration_ms(requested)
        try:
            requested_int = int(requested) if requested is not None else None
        except (TypeError, ValueError):
            requested_int = None
        if requested is not None and requested_int != clamped:
            logger.info("Clamped page-read maxDurationMs from %s to %s", requested, clamped)
        tool_input = {
            **original_input,
            "url": context.url,
            "taskType": context.task_type,
            "sourceMode": context.source_mode,
            "pageKind": context.page_kind if context.page_kind != "unknown" else original_input.get("pageKind", "general"),
            "allowInternalBrowserEscalation": False,
            "maxDurationMs": clamped,
        }
        return await self.extract_tool.execute(tool_input)

    def _page_result_from_http(self, context: PageReadContext, result: ToolResult, output: Dict[str, Any]) -> PageReadResult:
        content = str(output.get("content") or "")
        quality = str(output.get("quality") or "extract_garbage")
        tier = str(output.get("tier") or ("failed" if result.error else "partial"))
        word_count = int(output.get("wordCount") or len(content.split()))
        confidence = float(output.get("confidence") or 0.0)
        normalized_output = {**output, "quality": quality, "tier": tier, "wordCount": word_count, "confidence": confidence}
        weak = has_weak_signal(normalized_output)
        backend_result = "success" if not weak and content else ("garbage" if content else "failed")
        evidence_status = evidence_status_for_output(normalized_output, final_error=bool(result.error and not content))
        backend = str(output.get("backendUsed") or "http")
        failure_chain = [] if backend_result == "success" else [f"http: {backend_result} ({word_count} words)"]
        return PageReadResult(
            url=context.url,
            title=str(output.get("title") or ""),
            content=content,
            structuredData=output.get("structuredData") if isinstance(output.get("structuredData"), dict) else {},
            backendUsed=backend if backend != "none" else "http",
            backendResult=backend_result,
            evidenceStatus=evidence_status,
            backendAttempts=[normalize_backend_attempt(attempt_seq=1, backend="http", result=backend_result, error=result.error, duration_ms=int(result.duration_ms or 0), toolBackend=backend)],
            failureChain=failure_chain,
            landed_url=self._landed_url(context.url, output),
            quality=quality,
            tier=tier,
            confidence=confidence,
            wordCount=word_count,
            pageKind=context.page_kind,
            jsRenderSuspected=bool(output.get("jsRenderSuspected")),
            error=result.error,
        )

    async def _run_search_fallback(self, context: PageReadContext) -> PageReadResult:
        search_tool = self.tool_registry.get_optional("web_search")
        if not search_tool:
            return PageReadResult(
                url=context.url,
                backendUsed="search_fallback",
                backendResult="skipped",
                evidenceStatus="failed",
                backendAttempts=[normalize_backend_attempt(attempt_seq=3, backend="search_fallback", result="skipped", error="web_search tool not registered")],
                failureChain=["search_fallback: skipped (web_search missing)"],
                fallbackAttempted=True,
                isFallback=False,
                error="web_search tool not registered",
                pageKind=context.page_kind,
            )
        query = self._fallback_query(context.url)
        start = time.monotonic()
        result = await search_tool.execute({"query": query})
        duration_ms = int((time.monotonic() - start) * 1000)
        output = result.output if isinstance(result.output, dict) else {}
        results = list(output.get("results") or []) if isinstance(output, dict) else []
        snippets = []
        for item in results[:3]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or item.get("name") or "").strip()
            snippet = str(item.get("snippet") or item.get("description") or "").strip()
            line = " - ".join(part for part in [title, snippet] if part)
            if line:
                snippets.append(line)
        content = "\n".join(snippets)
        if content:
            return PageReadResult(
                url=context.url,
                title=f"Search fallback for {query}",
                content=content,
                backendUsed="search_fallback",
                backendResult="success",
                evidenceStatus="degraded",
                backendAttempts=[normalize_backend_attempt(attempt_seq=3, backend="search_fallback", result="success", duration_ms=duration_ms, resultCount=len(results))],
                failureChain=[f"search_fallback: {len(snippets)} snippets"],
                fallbackAttempted=True,
                isFallback=True,
                quality="extract_partial",
                tier="partial",
                confidence=0.45,
                wordCount=len(content.split()),
                pageKind=context.page_kind,
            )
        error = result.error or "0 snippets"
        return PageReadResult(
            url=context.url,
            backendUsed="search_fallback",
            backendResult="failed" if result.error else "garbage",
            evidenceStatus="failed",
            backendAttempts=[normalize_backend_attempt(attempt_seq=3, backend="search_fallback", result="failed" if result.error else "garbage", error=error, duration_ms=duration_ms)],
            failureChain=[f"search_fallback: {error}"],
            fallbackAttempted=True,
            isFallback=False,
            error=error,
            pageKind=context.page_kind,
        )

    def _fallback_query(self, url: str) -> str:
        parsed = urlparse(url)
        domain = self._registered_domain(parsed.hostname or "")
        slug = " ".join(meaningful_slug_segments(parsed.path))
        year = str(datetime.utcnow().year)
        return " ".join(part for part in [domain, slug, year] if part).strip()

    def _registered_domain(self, hostname: str) -> str:
        labels = [label for label in hostname.lower().split(".") if label]
        if len(labels) >= 3 and ".".join(labels[-2:]) in TWO_PART_TLDS:
            return labels[-3]
        if len(labels) >= 2:
            return labels[-2]
        return labels[0] if labels else ""

    def _landed_url(self, requested_url: str, output: Dict[str, Any]) -> Optional[str]:
        for key in ("landed_url", "redirectedUrl", "url"):
            value = str(output.get(key) or "").strip()
            if value and value != requested_url:
                return value
        return None

    def _cap_failure_chain(self, chain: List[str]) -> List[str]:
        if len(chain) <= 10:
            return chain
        omitted = len(chain) - 9
        return chain[:9] + [f"... {omitted} more attempts truncated"]

    def to_tool_result(self, result: PageReadResult, original_input: Dict[str, Any], duration_ms: float) -> ToolResult:
        if not result.url:
            raise ValueError("PageReadResult.url cannot be empty")
        output = result.as_dict()
        error = None
        if not result.content and not result.isFallback and result.backendResult in {"failed", "garbage", "skipped"}:
            error = result.error or "Page read produced no usable direct or fallback content."
            output["evidenceStatus"] = "failed"
        return ToolResult(
            tool_name="web_extract",
            input=original_input,
            output=output,
            error=error,
            duration_ms=duration_ms,
            sandboxed=False,
            source_url=result.landed_url or result.url,
            provenance_hint=provenance_subset(output),
        )
