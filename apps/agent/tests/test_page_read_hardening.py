import asyncio
from typing import Any, Dict, Optional

import pytest
import pytest_asyncio

from src.contracts.tool import ToolResult
from src.contracts.tool import ToolCall
from src.executor import Executor
from src.tools.builtin import browser_capability
from src.tools.builtin import browser_page_read_adapter
from src.tools.builtin.browser_page_read_adapter import BrowserPageReadAdapter
from src.tools.builtin.page_read_orchestrator import PageReadOrchestrator, classify_page_kind
from src.tools.builtin.page_read_types import (
    BROWSER_SEMAPHORE_CAPACITY,
    CapabilityOutcome,
    MIN_USEFUL_CONTENT_CHARS,
    PAGE_READ_BROWSER_MAX_QUEUE_DEPTH,
    PAGE_READ_FAILURE_MARKER_RESERVE_CHARS,
    PAGE_READ_FAILURE_SUMMARY_MAX_CHARS,
    PageReadContext,
    PageReadResult,
    aggregate_backend_result,
    evidence_status_for_output,
    normalize_backend_attempt,
    normalize_redirected_url,
    provenance_subset,
    schema_behavior_hash,
    summarize_failure_chain,
)
from src.tools.builtin.web_extract import WebExtractTool


class DummyRegistry:
    def __init__(self, tools: Optional[Dict[str, Any]] = None) -> None:
        self.tools = tools or {}
        self.get_optional_calls = 0

    def get_optional(self, name: str) -> Optional[Any]:
        self.get_optional_calls += 1
        return self.tools.get(name)

    def get(self, name: str) -> Any:
        tool = self.get_optional(name)
        if not tool:
            raise KeyError(name)
        return tool


class DummyTool:
    def __init__(
        self,
        *,
        name: str = "dummy",
        output: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        server_id: str = "server-a",
    ) -> None:
        self.name = name
        self.output = output or {}
        self.error = error
        self.parameters = parameters or {}
        self.mcp_server_id = server_id
        self.capability_tags = []
        self.calls = 0
        self.inputs = []

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        self.calls += 1
        self.inputs.append(input)
        return ToolResult(
            tool_name=self.name,
            input=input,
            output=self.output,
            error=self.error,
            duration_ms=1,
            sandboxed=False,
        )


@pytest_asyncio.fixture(autouse=True)
async def reset_browser_capability_state():
    await browser_capability.reset_browser_capability_cache()
    browser_capability._capability_finalizer_tasks.clear()
    yield
    await browser_capability.reset_browser_capability_cache()
    browser_capability._capability_finalizer_tasks.clear()


@pytest.mark.asyncio
async def test_confirmed_absent_browser_capability_caches_false():
    registry = DummyRegistry({})

    assert await browser_capability.check_browser_page_read_capability(registry) is False
    await asyncio.sleep(0)
    calls_after_first = registry.get_optional_calls

    assert await browser_capability.check_browser_page_read_capability(registry) is False
    assert registry.get_optional_calls == calls_after_first


@pytest.mark.asyncio
async def test_future_wait_timeout_retries_once_then_returns_uncached_false(monkeypatch):
    monkeypatch.setattr(browser_capability, "BROWSER_CAPABILITY_FUTURE_WAIT_TIMEOUT_S", 0.001)
    async with browser_capability._state_lock:
        browser_capability._state.result = None
        browser_capability._state.future = asyncio.get_running_loop().create_future()

    assert await browser_capability.check_browser_page_read_capability(DummyRegistry({})) is False


@pytest.mark.asyncio
async def test_late_finalizer_updates_cache_after_waiter_timeout(monkeypatch):
    monkeypatch.setattr(browser_capability, "BROWSER_CAPABILITY_FUTURE_WAIT_TIMEOUT_S", 0.001)
    future = asyncio.get_running_loop().create_future()
    async with browser_capability._state_lock:
        browser_capability._state.result = None
        browser_capability._state.future = future

    assert await browser_capability.check_browser_page_read_capability(DummyRegistry({})) is False
    browser_capability._schedule_finalizer(future, CapabilityOutcome(status="success", value=True))
    await asyncio.sleep(0)

    registry = DummyRegistry({})
    assert await browser_capability.check_browser_page_read_capability(registry) is True
    assert registry.get_optional_calls == 0


@pytest.mark.asyncio
async def test_runtime_error_during_capability_future_wait_returns_false(monkeypatch):
    async def raise_runtime_error(*args: Any, **kwargs: Any) -> CapabilityOutcome:
        raise RuntimeError("loop shutting down")

    monkeypatch.setattr(browser_capability.asyncio, "wait_for", raise_runtime_error)
    async with browser_capability._state_lock:
        browser_capability._state.result = None
        browser_capability._state.future = asyncio.get_running_loop().create_future()

    assert await browser_capability.check_browser_page_read_capability(DummyRegistry({})) is False


@pytest.mark.asyncio
async def test_browser_queue_full_returns_skipped_result(monkeypatch):
    async def browser_available(*args: Any, **kwargs: Any) -> bool:
        return True

    monkeypatch.setattr(browser_page_read_adapter, "check_browser_page_read_capability", browser_available)
    monkeypatch.setattr(browser_page_read_adapter, "_waiting_count", PAGE_READ_BROWSER_MAX_QUEUE_DEPTH)

    result = await BrowserPageReadAdapter(DummyRegistry({})).read_page(
        PageReadContext(url="https://example.com", user_query="read this")
    )

    assert result.backendUsed == "browser"
    assert result.backendResult == "skipped"
    assert result.error == "browser queue full"


def test_schema_hash_is_structural_for_format_and_const_enum():
    base = {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}
    with_format = {"type": "object", "properties": {"url": {"type": "string", "format": "uri"}}, "required": ["url"]}
    const_schema = {"type": "object", "properties": {"mode": {"const": "GET"}}}
    enum_schema = {"type": "object", "properties": {"mode": {"enum": ["GET"]}}}

    assert schema_behavior_hash(base) != schema_behavior_hash(with_format)
    assert schema_behavior_hash(const_schema) != schema_behavior_hash(enum_schema)


def test_failure_summary_caps_marker_counts_and_keeps_whole_segments():
    chain = [f"stage{i}: {'x' * 30}" for i in range(120)]
    summary = summarize_failure_chain(chain)

    assert len(summary) <= PAGE_READ_FAILURE_SUMMARY_MAX_CHARS
    assert "[+99 more]" in summary
    assert summary.startswith("stage0:")


def test_failure_summary_exact_truncation_length_uses_named_constants():
    chain = [f"stage0: {'x' * PAGE_READ_FAILURE_SUMMARY_MAX_CHARS}", "stage1: omitted"]
    summary = summarize_failure_chain(chain)

    assert PAGE_READ_FAILURE_MARKER_RESERVE_CHARS == len("[+99 more]")
    assert len(summary) == PAGE_READ_FAILURE_SUMMARY_MAX_CHARS


def test_normalize_redirected_url_handles_slashes_case_and_real_redirects():
    assert normalize_redirected_url("http://example.com", "http://example.com/") is None
    assert normalize_redirected_url("HTTP://Example.com/", "http://example.com/") is None
    assert normalize_redirected_url("http://example.com", "http://other.com") == "http://other.com"


def test_page_kind_uses_exact_case_insensitive_segments():
    assert classify_page_kind("https://example.com/news/standings/table/") == "standings/table"
    assert classify_page_kind("https://example.com/renewable-energy-news/article-123") == "general"


def test_aggregate_garbage_and_success_rules():
    attempts = [
        normalize_backend_attempt(attempt_seq=1, backend="http", result="garbage"),
        normalize_backend_attempt(attempt_seq=2, backend="browser", result="garbage"),
    ]
    assert aggregate_backend_result(attempts) == "garbage"

    attempts.append(normalize_backend_attempt(attempt_seq=3, backend="search_fallback", result="success"))
    assert aggregate_backend_result(attempts) == "success"


def test_executor_routes_user_named_factual_extracts_through_page_read_orchestrator():
    executor = Executor()

    assert executor._should_use_page_read_orchestrator(
        ToolCall(
            tool_name="web_extract",
            input={
                "url": "https://developers.openai.com/api/docs/changelog",
                "taskType": "factual_extract",
                "sourceMode": "user_named",
            },
        )
    ) is True

    assert executor._should_use_page_read_orchestrator(
        ToolCall(
            tool_name="web_extract",
            input={
                "url": "https://developers.openai.com/api/docs/changelog",
                "taskType": "factual_extract",
                "sourceMode": "system_chosen",
            },
        )
    ) is False


def test_provenance_subset_keeps_only_compact_fields_and_isolates_redirect_mutation():
    output = {
        "pageType": "general",
        "taskType": "page_read",
        "sourceMode": "user_named",
        "fetchFailureKind": "timeout",
        "networkError": "connection refused after 30s",
        "httpStatus": 504,
        "transportStrategy": "direct_http",
        "redirectedUrl": "https://example.com/final",
        "backendResult": "garbage",
        "fallbackAttempted": False,
        "isFallback": False,
        "evidenceStatus": "degraded",
        "content": "large page body",
        "rawHtml": "<html></html>",
    }
    provenance = provenance_subset(output)
    output["redirectedUrl"] = "https://example.com/mutated"

    assert provenance["redirectedUrl"] == "https://example.com/final"
    assert "content" not in provenance
    assert "rawHtml" not in provenance
    assert "backendAttempts" not in provenance
    assert "failureChain" not in provenance


def test_provenance_subset_accepts_minimal_input_without_attempt_arrays():
    provenance = provenance_subset(
        {
            "pageType": "general",
            "taskType": "page_read",
            "sourceMode": "user_named",
            "backendResult": "success",
            "isFallback": False,
            "fallbackAttempted": False,
            "evidenceStatus": "medium",
        }
    )

    assert provenance == {
        "pageType": "general",
        "taskType": "page_read",
        "sourceMode": "user_named",
        "backendResult": "success",
        "isFallback": False,
        "fallbackAttempted": False,
        "evidenceStatus": "medium",
    }


def test_browser_escalation_suppressed_is_diagnostic_only_for_strong_output():
    output = {
        "quality": "extract_clean",
        "tier": "clean",
        "confidence": 0.9,
        "wordCount": 140,
        "browserEscalationSuppressed": True,
    }

    assert evidence_status_for_output(output) == "strong"


def test_browser_content_length_boundary_uses_min_useful_chars():
    too_short = browser_page_read_adapter._classify_browser_content(
        "x" * (MIN_USEFUL_CONTENT_CHARS - 1),
        MIN_USEFUL_CONTENT_CHARS,
    )
    enough = browser_page_read_adapter._classify_browser_content(
        "x" * MIN_USEFUL_CONTENT_CHARS,
        MIN_USEFUL_CONTENT_CHARS,
    )

    assert too_short["quality"] == "extract_garbage"
    assert enough["quality"] in {"extract_partial", "extract_clean"}


def test_long_blocked_http_content_still_maps_to_garbage():
    orchestrator = PageReadOrchestrator(DummyRegistry({}))
    result = ToolResult(
        tool_name="web_extract",
        input={},
        output={
            "url": "https://example.com/blocked",
            "title": "Verification required",
            "content": ("Please verify you are human. " * 20).strip(),
            "quality": "extract_partial",
            "tier": "partial",
            "confidence": 0.5,
            "wordCount": 100,
            "pageType": "blocked",
            "paywallSignal": True,
            "backendUsed": "web_fetch",
        },
        error=None,
        duration_ms=1,
        sandboxed=False,
    )

    page_result = orchestrator._page_result_from_http(
        PageReadContext(url="https://example.com/blocked", user_query="read blocked page", page_kind="general"),
        result,
        result.output,
    )

    assert page_result.backendResult == "garbage"


@pytest.mark.asyncio
async def test_browser_snapshot_failure_releases_semaphore_and_next_request_succeeds(monkeypatch):
    async def browser_available(*args: Any, **kwargs: Any) -> bool:
        return True

    monkeypatch.setattr(browser_page_read_adapter, "check_browser_page_read_capability", browser_available)
    monkeypatch.setattr(BrowserPageReadAdapter, "_wait_for_render", lambda self, context: asyncio.sleep(0))
    monkeypatch.setattr(
        browser_page_read_adapter,
        "BROWSER_PAGE_READ_SEMAPHORE",
        asyncio.Semaphore(BROWSER_SEMAPHORE_CAPACITY),
    )
    monkeypatch.setattr(browser_page_read_adapter, "_waiting_count", 0)

    class SnapshotTool:
        def __init__(self) -> None:
            self.calls = 0
            self.started = asyncio.Event()

        async def execute(self, input: Dict[str, Any]) -> ToolResult:
            self.calls += 1
            if self.calls == 1:
                self.started.set()
                raise RuntimeError("forced test failure")
            return ToolResult(
                tool_name="browser_snapshot",
                input=input,
                output={"text": " ".join(["word"] * 120)},
                error=None,
                duration_ms=1,
                sandboxed=False,
            )

    navigate_tool = DummyTool(
        name="browser_navigate",
        output={"url": "https://example.com/page"},
        parameters={"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
    )
    snapshot_tool = SnapshotTool()
    registry = DummyRegistry(
        {
            "browser_navigate": navigate_tool,
            "browser_snapshot": snapshot_tool,
        }
    )
    adapter = BrowserPageReadAdapter(registry)
    context = PageReadContext(url="https://example.com/page", user_query="read this page")

    first_task = asyncio.create_task(adapter.read_page(context))
    await snapshot_tool.started.wait()
    second_task = asyncio.create_task(adapter.read_page(context))
    first_result, second_result = await asyncio.gather(first_task, second_task)

    assert first_result.backendResult == "failed"
    assert second_result.backendResult == "success"
    assert browser_page_read_adapter.BROWSER_PAGE_READ_SEMAPHORE._value == BROWSER_SEMAPHORE_CAPACITY


@pytest.mark.asyncio
async def test_medium_http_evidence_maps_success_and_skips_fallback(monkeypatch):
    http_output = {
        "kind": "content",
        "url": "https://example.com/page",
        "content": " ".join(["word"] * 85),
        "quality": "extract_partial",
        "tier": "partial",
        "confidence": 0.65,
        "wordCount": 85,
        "backendUsed": "web_fetch",
    }
    orchestrator = PageReadOrchestrator(DummyRegistry({"web_search": DummyTool(name="web_search")}))
    orchestrator.extract_tool = DummyTool(name="web_extract", output=http_output)

    result = await orchestrator.read(
        PageReadContext(url="https://example.com/page", user_query="read page", page_kind="general"),
        {"url": "https://example.com/page", "taskType": "page_read", "sourceMode": "user_named"},
    )

    assert result.error is None
    assert result.output["backendResult"] == "success"
    assert result.output["evidenceStatus"] == "medium"
    assert result.output["isFallback"] is False
    assert any(attempt["backend"] == "search_fallback" and attempt["result"] == "skipped" for attempt in result.output["backendAttempts"])


def test_executor_branches_on_fetch_failure_kind_not_network_error():
    executor = Executor()
    fetch_result = ToolResult(
        tool_name="web_extract",
        input={"url": "https://example.com"},
        output={
            "fetchFailureKind": "timeout",
            "networkError": "connection refused after 30s",
            "pageType": "general",
            "taskType": "page_read",
            "sourceMode": "user_named",
            "tier": "failed",
            "confidence": 0.05,
        },
        error="tool failed",
        duration_ms=1,
        sandboxed=False,
    )

    gate = executor._extract_evidence_gate("https://example.com", fetch_result)
    answer = executor._synthesize_tool_answer("read this page", "web_extract", fetch_result)

    assert "transport layer (timeout)" in gate["reason"]
    assert "transport layer (timeout)" in answer
    assert "connection refused after 30s" in gate["reason"]
    assert "connection refused after 30s" in answer


@pytest.mark.asyncio
async def test_browser_attempted_prevents_second_call_and_search_can_win(monkeypatch):
    async def browser_available(*args: Any, **kwargs: Any) -> bool:
        return True

    monkeypatch.setattr("src.tools.builtin.page_read_orchestrator.check_browser_page_read_capability", browser_available)

    http_output = {
        "kind": "content",
        "url": "https://example.com/results",
        "content": "",
        "quality": "extract_garbage",
        "tier": "failed",
        "confidence": 0.05,
        "wordCount": 0,
        "backendUsed": "web_fetch",
        "jsRenderSuspected": True,
    }
    browser_result = PageReadResult(
        url="https://example.com/results",
        content="too short",
        backendUsed="browser",
        backendResult="garbage",
        evidenceStatus="degraded",
        backendAttempts=[normalize_backend_attempt(attempt_seq=2, backend="browser", result="garbage")],
        failureChain=["browser: garbage (2 words)"],
        quality="extract_garbage",
        tier="failed",
        confidence=0.05,
        wordCount=2,
    )
    search_output = {"results": [{"title": "Result page", "snippet": "Fallback snippet"}]}
    search_tool = DummyTool(name="web_search", output=search_output)
    orchestrator = PageReadOrchestrator(DummyRegistry({"web_search": search_tool}))
    orchestrator.extract_tool = DummyTool(name="web_extract", output=http_output)

    class DummyBrowserAdapter:
        def __init__(self) -> None:
            self.calls = 0

        async def read_page(self, context: PageReadContext) -> PageReadResult:
            self.calls += 1
            return browser_result

    dummy_browser = DummyBrowserAdapter()
    orchestrator.browser_adapter = dummy_browser

    result = await orchestrator.read(
        PageReadContext(url="https://example.com/results", user_query="read results", page_kind="general"),
        {"url": "https://example.com/results", "taskType": "page_read", "sourceMode": "user_named"},
    )

    assert dummy_browser.calls == 1
    assert result.output["backendUsed"] == "search_fallback"
    assert result.output["backendResult"] == "success"
    assert result.output["isFallback"] is True
    assert result.output["fallbackAttempted"] is True
    assert [attempt["attemptSeq"] for attempt in result.output["backendAttempts"]] == [1, 2, 3]


def test_tool_result_error_recomputed_not_copied_from_stage_error():
    orchestrator = PageReadOrchestrator(DummyRegistry({}))
    result = PageReadResult(
        url="https://example.com",
        content="usable content",
        backendUsed="http",
        backendResult="success",
        evidenceStatus="medium",
        error="browser queue full",
        backendAttempts=[
            normalize_backend_attempt(attempt_seq=1, backend="http", result="success"),
            normalize_backend_attempt(attempt_seq=2, backend="browser", result="skipped", error="browser queue full"),
        ],
        quality="extract_partial",
        tier="partial",
        confidence=0.65,
        wordCount=2,
    )

    tool_result = orchestrator.to_tool_result(result, {"url": "https://example.com"}, 1)

    assert tool_result.error is None
    assert tool_result.output["error"] == "browser queue full"


def test_web_extract_excludes_browser_and_non_url_mcp_tools():
    extract = WebExtractTool()
    browser_tool = DummyTool(name="browser_click")
    browser_tool.capability_tags = ["mcp"]
    non_url_tool = DummyTool(name="custom_fetchish", parameters={"type": "object", "properties": {"query": {"type": "string"}}})
    non_url_tool.capability_tags = ["mcp"]
    non_url_tool.accepts_url = False

    assert extract._backend_score(browser_tool, "general", False) == -100
    assert extract._backend_score(non_url_tool, "general", False) == -100
