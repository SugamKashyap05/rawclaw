import asyncio

import httpx
import pytest

from src.contracts.tool import ToolResult
from src.tools.builtin.web_fetch import DEFAULT_MAX_BYTES, WebFetchTool, _ResolvedUrlInfo


def _public_url_info(url: str = "https://example.com/") -> _ResolvedUrlInfo:
    return _ResolvedUrlInfo(
        is_safe=True,
        reason="",
        hostname="example.com",
        resolved_ip="93.184.216.34",
        is_public=True,
    )


@pytest.mark.asyncio
async def test_web_fetch_connect_failure_without_browser_fallback(monkeypatch):
    tool = WebFetchTool()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        raise httpx.ConnectError("All connection attempts failed")

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)

    result = await tool.execute({"url": "https://example.com/", "allowBrowserFallback": False})

    assert result.error is not None
    assert result.output["kind"] == "transport_failure"
    assert result.output["fetchFailureKind"] == "connect_failure"
    assert result.output["transportStrategy"] == "browser_headers_http"
    assert len(result.output["backendAttempts"]) == 3


@pytest.mark.asyncio
async def test_web_fetch_env_proxy_path_selected_and_succeeds(monkeypatch):
    tool = WebFetchTool()
    attempts = []

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        attempts.append(kwargs["attempt_name"])
        if kwargs["attempt_name"] == "direct_http":
            raise httpx.ConnectError("All connection attempts failed")
        return {
            "url": "https://example.com/final",
            "title": "Example Domain",
            "content": "Example Domain is for use in documentation examples.",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": "https://example.com/final",
            "transportStrategy": kwargs["attempt_name"],
            "truncated": False,
            "bytesRead": 128,
            "maxBytes": DEFAULT_MAX_BYTES,
            "encoding": "utf-8",
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)

    result = await tool.execute({"url": "https://example.com/"})

    assert result.error is None
    assert result.output["kind"] == "content"
    assert result.output["transportStrategy"] == "env_proxy_http"
    assert result.output["httpStatus"] == 200
    assert attempts == ["direct_http", "env_proxy_http"]


@pytest.mark.asyncio
async def test_web_fetch_success_exposes_raw_content_title_status_transport_and_fallback_flags(monkeypatch):
    tool = WebFetchTool()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        return {
            "url": "https://example.com/final",
            "title": "Example Domain",
            "content": "Example Domain is for use in documentation examples without special rendering.",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": "https://example.com/final",
            "transportStrategy": kwargs["attempt_name"],
            "truncated": False,
            "bytesRead": 96,
            "maxBytes": DEFAULT_MAX_BYTES,
            "encoding": "utf-8",
            "jsRenderSuspected": False,
            "jsFallbackDetected": False,
            "jsFallbackReason": None,
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)

    result = await tool.execute({"url": "https://example.com/"})

    assert result.error is None
    assert result.output["kind"] == "content"
    assert result.output["title"] == "Example Domain"
    assert "documentation examples" in result.output["content"]
    assert result.output["httpStatus"] == 200
    assert result.output["transportStrategy"] == "direct_http"
    assert result.output["backendAttempts"][0]["attempt"] == "direct_http"
    assert result.output["backendAttempts"][0]["status"] == "ok"
    assert result.output["jsRenderSuspected"] is False
    assert result.output["jsFallbackDetected"] is False
    assert result.output["jsFallbackReason"] is None


@pytest.mark.asyncio
async def test_web_fetch_browser_fallback_success_after_http_failures(monkeypatch):
    tool = WebFetchTool()
    attempts = []

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        attempts.append(kwargs["attempt_name"])
        raise httpx.ConnectError("All connection attempts failed")

    async def fake_browser_fallback(*, url, max_bytes):
        return {
            "url": url,
            "title": "Rendered page",
            "content": "Rendered browser fallback content",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": url,
            "truncated": False,
            "bytesRead": 256,
            "encoding": "utf-8",
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)
    monkeypatch.setattr(tool, "_browser_public_fallback", fake_browser_fallback)

    result = await tool.execute({"url": "https://example.com/"})

    assert result.error is None
    assert result.output["kind"] == "content"
    assert result.output["transportStrategy"] == "browser_public_fallback"
    assert [attempt["attempt"] for attempt in result.output["backendAttempts"]] == [
        "direct_http",
        "env_proxy_http",
        "browser_headers_http",
        "browser_public_fallback",
    ]
    assert attempts == ["direct_http", "env_proxy_http", "browser_headers_http"]


@pytest.mark.asyncio
async def test_web_fetch_browser_fallback_truncation_is_preserved(monkeypatch):
    tool = WebFetchTool()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        raise httpx.ConnectError("All connection attempts failed")

    async def fake_browser_fallback(*, url, max_bytes):
        return {
            "url": url,
            "title": "Rendered page",
            "content": "x" * max_bytes,
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": url,
            "truncated": True,
            "bytesRead": max_bytes + 1024,
            "encoding": "utf-8",
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)
    monkeypatch.setattr(tool, "_browser_public_fallback", fake_browser_fallback)

    result = await tool.execute({"url": "https://example.com/", "maxBytes": 4096})

    assert result.output["transportStrategy"] == "browser_public_fallback"
    assert result.output["truncated"] is True
    assert result.output["bytesRead"] == 4096 + 1024
    assert result.output["maxBytes"] == 4096


@pytest.mark.asyncio
async def test_web_fetch_browser_fallback_runs_via_executor_bridge(monkeypatch):
    tool = WebFetchTool()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        raise httpx.ConnectError("All connection attempts failed")

    def fake_run_playwright_sync(url, max_bytes):
        return {
            "url": url,
            "title": "Rendered page",
            "content": "Rendered browser fallback content",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": url,
            "truncated": False,
            "bytesRead": 256,
            "encoding": "utf-8",
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)
    monkeypatch.setattr(tool, "_run_playwright_sync", fake_run_playwright_sync)

    result = await tool.execute({"url": "https://example.com/"})

    assert result.error is None
    assert result.output["transportStrategy"] == "browser_public_fallback"


@pytest.mark.asyncio
async def test_web_fetch_cache_hit_on_repeated_fetch(monkeypatch):
    tool = WebFetchTool()
    calls = 0

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_execute_uncached(**kwargs):
        nonlocal calls
        calls += 1
        return httpx_to_tool_result(kwargs["input"])

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_execute_uncached", fake_execute_uncached)

    first = await tool.execute({"url": "https://example.com/"})
    second = await tool.execute({"url": "https://example.com/"})

    assert first.output["cacheHit"] is False
    assert second.output["cacheHit"] is True
    assert calls == 1


@pytest.mark.asyncio
async def test_web_fetch_concurrent_same_key_calls_deduplicate(monkeypatch):
    tool = WebFetchTool()
    calls = 0
    gate = asyncio.Event()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_execute_uncached(**kwargs):
        nonlocal calls
        calls += 1
        await gate.wait()
        return httpx_to_tool_result(kwargs["input"])

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_execute_uncached", fake_execute_uncached)

    first_task = asyncio.create_task(tool.execute({"url": "https://example.com/"}))
    second_task = asyncio.create_task(tool.execute({"url": "https://example.com/"}))
    await asyncio.sleep(0)
    gate.set()
    first, second = await asyncio.gather(first_task, second_task)

    assert calls == 1
    assert first.output["kind"] == "content"
    assert second.output["kind"] == "content"


@pytest.mark.asyncio
async def test_web_fetch_robots_status_is_exposed(monkeypatch):
    tool = WebFetchTool()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "disallowed"

    async def fake_http_attempt(**kwargs):
        return {
            "url": "https://example.com/",
            "title": "Example Domain",
            "content": "Example Domain for documentation.",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": "https://example.com/",
            "transportStrategy": kwargs["attempt_name"],
            "truncated": False,
            "bytesRead": 64,
            "maxBytes": DEFAULT_MAX_BYTES,
            "encoding": "utf-8",
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)

    result = await tool.execute({"url": "https://example.com/"})

    assert result.output["robotsStatus"] == "disallowed"


@pytest.mark.asyncio
async def test_web_fetch_marks_js_fallback_content(monkeypatch):
    tool = WebFetchTool()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        return {
            "url": "https://www.python.org/downloads/release/python-3144/",
            "title": "Python Release Python 3.14.4 | Python.org",
            "content": "Notice: This page displays a fallback because interactive scripts did not run.",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": "https://www.python.org/downloads/release/python-3144/",
            "transportStrategy": kwargs["attempt_name"],
            "truncated": False,
            "bytesRead": 128,
            "maxBytes": DEFAULT_MAX_BYTES,
            "encoding": "utf-8",
            "jsRenderSuspected": True,
            "jsFallbackDetected": True,
            "jsFallbackReason": "interactive scripts did not run",
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)

    result = await tool.execute({"url": "https://www.python.org/downloads/release/python-3144/"})

    assert result.output["kind"] == "content"
    assert result.output["jsRenderSuspected"] is True
    assert result.output["jsFallbackDetected"] is True
    assert result.output["jsFallbackReason"] == "interactive scripts did not run"


@pytest.mark.asyncio
async def test_web_fetch_marks_spa_empty_shell_after_success(monkeypatch):
    tool = WebFetchTool()

    async def fake_resolve(url):
        return _public_url_info(url)

    async def fake_robots(url, resolved):
        return "allowed"

    async def fake_http_attempt(**kwargs):
        return {
            "url": "https://developers.openai.com/api/docs/changelog",
            "title": "Changelog",
            "content": "",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": "https://developers.openai.com/api/docs/changelog",
            "transportStrategy": kwargs["attempt_name"],
            "truncated": False,
            "bytesRead": 256,
            "maxBytes": DEFAULT_MAX_BYTES,
            "encoding": "utf-8",
            "jsRenderSuspected": True,
            "jsFallbackDetected": True,
            "jsFallbackReason": 'spa_empty_shell: <div id="__next"></div>',
        }

    monkeypatch.setattr("src.tools.builtin.web_fetch._resolve_url_info", fake_resolve)
    monkeypatch.setattr(tool, "_check_robots_status", fake_robots)
    monkeypatch.setattr(tool, "_execute_http_attempt", fake_http_attempt)

    result = await tool.execute({"url": "https://developers.openai.com/api/docs/changelog"})

    assert result.error is None
    assert result.output["kind"] == "content"
    assert result.output["httpStatus"] == 200
    assert result.output["jsRenderSuspected"] is True
    assert result.output["jsFallbackDetected"] is True
    assert result.output["jsFallbackReason"] == 'spa_empty_shell: <div id="__next"></div>'


@pytest.mark.asyncio
async def test_web_fetch_unsafe_url_blocked_before_browser_fallback():
    tool = WebFetchTool()
    result = await tool.execute({"url": "http://127.0.0.1:8000/"})

    assert result.error is not None
    assert result.output["kind"] == "transport_failure"
    assert result.output["fetchFailureKind"] == "unsafe_url"


@pytest.mark.asyncio
async def test_web_fetch_diagnose_reports_stage_results(monkeypatch):
    tool = WebFetchTool()

    async def fake_dns(hostname):
        assert hostname == "example.com"
        return {"ok": True, "ip": "93.184.216.34"}

    async def fake_tcp(hostname, port):
        assert hostname == "example.com"
        assert port == 443
        return {"ok": True}

    async def fake_ssl(hostname, port):
        assert hostname == "example.com"
        assert port == 443
        return {"ok": True}

    async def fake_probe(url, *, verify):
        return {"ok": True, "status": 200 if verify else 204, "finalUrl": url}

    monkeypatch.setattr(tool, "_diagnose_dns", fake_dns)
    monkeypatch.setattr(tool, "_diagnose_tcp", fake_tcp)
    monkeypatch.setattr(tool, "_diagnose_ssl", fake_ssl)
    monkeypatch.setattr(tool, "_diagnose_httpx_probe", fake_probe)

    diagnosis = await tool.diagnose_connectivity("https://example.com")

    assert diagnosis["dns"]["ok"] is True
    assert diagnosis["tcp"]["ok"] is True
    assert diagnosis["ssl"]["ok"] is True
    assert diagnosis["httpx"]["status"] == 200
    assert diagnosis["httpxInsecure"]["status"] == 204
    assert "playwright" in diagnosis


def test_transport_diagnostics_preserves_root_cause_message():
    root = OSError(111, "Connection refused")
    exc = httpx.ConnectError("All connection attempts failed")
    exc.__cause__ = root

    from src.tools.builtin.web_fetch import _transport_diagnostics

    diagnostics = _transport_diagnostics(exc)

    assert diagnostics["fetchFailureKind"] == "connect_failure"
    assert "Connection refused" in diagnostics["networkError"]


def httpx_to_tool_result(input_payload):
    return WebFetchToolResultFactory.success(input_payload["url"])


class WebFetchToolResultFactory:
    @staticmethod
    def success(url: str):
        output = {
            "kind": "content",
            "url": url,
            "title": "Example Domain",
            "content": "Example Domain is for use in documentation examples.",
            "word_count": 8,
            "fetched_at": "2026-04-28T00:00:00Z",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": url,
            "fetchFailureKind": None,
            "networkError": None,
            "transportStrategy": "direct_http",
            "backendAttempts": [{"attempt": "direct_http", "status": "ok"}],
            "truncated": False,
            "bytesRead": 128,
            "maxBytes": DEFAULT_MAX_BYTES,
            "encoding": "utf-8",
            "cacheHit": False,
            "cacheAgeMs": None,
            "robotsStatus": "allowed",
        }
        return ToolResult(
            tool_name="web_fetch",
            input={"url": url},
            output=output,
            duration_ms=1,
            sandboxed=False,
            source_url=url,
            provenance_hint=output.copy(),
        )
