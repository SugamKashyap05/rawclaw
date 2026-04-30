import os

import pytest

from src.contracts.tool import ToolResult
from src.tools.base_tool import BaseTool
from src.tools.builtin.web_extract import WebExtractTool


LIVE_WEB_ENABLED = os.getenv("RAWCLAW_RUN_LIVE_WEB") == "1"
IPL_POINTS_TABLE_URL = "https://www.iplt20.com/matches/points-table"


def test_web_extract_recovers_csk_standing_from_raw_html():
    tool = WebExtractTool()
    raw_html = """
    <html>
      <body>
        <script type="application/json">
          {
            "standings": [
              {
                "team": "Chennai Super Kings",
                "position": "4",
                "points": "14",
                "nrr": "+0.455"
              }
            ]
          }
        </script>
      </body>
    </html>
    """

    content, structured = tool._recover_standings_from_raw_html(raw_html)

    assert "Chennai Super Kings" in content
    assert structured["team"] == "Chennai Super Kings"
    assert structured["position"] == "4"
    assert structured["points"] == "14"
    assert structured["nrr"] == "+0.455"


def test_web_extract_recovers_csk_standing_from_later_html_candidate():
    tool = WebExtractTool()
    filler = " lorem ipsum " * 250
    raw_html = f"""
    <html>
      <body>
        <section>
          At the IPL 2019 Player Auction, the Chennai Super Kings secured his services.
          {filler}
        </section>
        <script type="application/json">
          {{
            "standings": [
              {{
                "team": "Chennai Super Kings",
                "position": "4",
                "points": "14",
                "nrr": "+0.455",
                "note": "Top four race"
              }}
            ]
          }}
        </script>
      </body>
    </html>
    """

    content, structured = tool._recover_standings_from_raw_html(raw_html)

    assert "Position: 4." in content
    assert structured["team"] == "Chennai Super Kings"
    assert structured["position"] == "4"
    assert structured["points"] == "14"
    assert structured["nrr"] == "+0.455"


def test_web_extract_parses_iplt20_official_feed_payload():
    tool = WebExtractTool()
    payload = """
    ongroupstandings({
      "points": [
        {
          "TeamCode": "CSK",
          "TeamName": "Chennai Super Kings",
          "Points": "6",
          "NetRunRate": "-0.121",
          "OrderNo": "6",
          "PrevPosition": "6",
          "Status": "SAME",
          "Performance": "W,W,L,W,L"
        }
      ]
    });
    """

    parsed = tool._parse_jsonp_payload(payload)

    assert isinstance(parsed, dict)
    assert parsed["points"][0]["TeamCode"] == "CSK"
    assert parsed["points"][0]["OrderNo"] == "6"


def test_web_extract_recovers_article_from_raw_html_metadata_and_jsonld():
    tool = WebExtractTool()
    raw_html = """
    <html>
      <head>
        <meta property="og:title" content="Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014" />
        <meta property="og:description" content="Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience." />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014",
            "description": "Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience.",
            "datePublished": "2026-04-20",
            "articleBody": "The article argues that Ubuntu 26.04 LTS is becoming a better home for developers through cleaner defaults, modern tooling, and a workflow that feels more intentional."
          }
        </script>
      </head>
      <body></body>
    </html>
    """

    content, structured = tool._recover_article_from_raw_html(raw_html)

    assert "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014" in content
    assert "modern toolchains" in content
    assert structured["event"] == "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014"
    assert structured["what_changed"].startswith("Ubuntu 26.04 LTS focuses on developer defaults")
    assert structured["date_time"] == "2026-04-20"


def test_web_extract_quality_metadata_marks_meta_only_article_as_thin():
    tool = WebExtractTool()

    metadata = tool._extraction_quality_metadata(
        url="https://medium.com/example/dev-article",
        task_type="page_read",
        source_mode="user_named",
        page_kind="news/article",
        content="Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014\nUbuntu 26.04 LTS focuses on developer defaults.",
        structured_data={
            "event": "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014",
            "what_changed": "Ubuntu 26.04 LTS focuses on developer defaults.",
        },
        expected_fields=["event", "date_time", "what_changed"],
        quality="extract_clean",
        extraction_method="web_fetch_raw_html_article",
        raw_source_text="<meta property='og:title' content='Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014'>",
    )

    assert metadata["tier"] == "thin"
    assert metadata["confidence"] < 0.7
    assert metadata["pageType"] == "article"
    assert metadata["taskType"] == "page_read"
    assert metadata["sourceMode"] == "user_named"
    assert "linkDensity" in metadata
    assert "approximateItemCount" in metadata
    assert "tableRowCount" in metadata
    assert "structuredRecordCount" in metadata


def test_web_extract_quality_metadata_flags_paywall_and_js_shell():
    tool = WebExtractTool()
    raw_html = """
    <html>
      <head>
        <script>window.__NEXT_DATA__ = {};</script>
        <script>window.__APOLLO_STATE__ = {};</script>
        <script>console.log('hydrate-root')</script>
        <script>console.log('hydrate-root')</script>
        <script>console.log('hydrate-root')</script>
        <script>console.log('hydrate-root')</script>
        <script>console.log('hydrate-root')</script>
        <script>console.log('hydrate-root')</script>
        <script>console.log('hydrate-root')</script>
      </head>
      <body>
        <div id="root"></div>
        <p>Subscribe to continue reading this article.</p>
      </body>
    </html>
    """

    metadata = tool._extraction_quality_metadata(
        url="https://example.com/paywalled-story",
        task_type="page_read",
        source_mode="user_named",
        page_kind="news/article",
        content="Subscribe to continue reading this article.",
        structured_data={},
        expected_fields=["event", "date_time", "what_changed"],
        quality="extract_partial",
        extraction_method="web_fetch_raw_html_article",
        raw_source_text=raw_html,
    )

    assert metadata["paywallSignal"] is True
    assert metadata["jsRenderSuspected"] is True
    assert metadata["tier"] == "failed"
    assert metadata["pageType"] == "blocked"


def test_web_extract_quality_metadata_flags_js_fallback_and_caps_confidence():
    tool = WebExtractTool()
    content = "Python Release Python 3.14.4 Release notes and files."
    metadata = tool._extraction_quality_metadata(
        url="https://www.python.org/downloads/release/python-3144/",
        task_type="page_read",
        source_mode="user_named",
        page_kind="news/article",
        content=content,
        structured_data={"event": "Python Release Python 3.14.4"},
        expected_fields=["event", "date_time", "what_changed"],
        quality="extract_clean",
        extraction_method="web_fetch",
        raw_source_text=(
            "Notice: This page displays a fallback because interactive scripts did not run. "
            "Python Release Python 3.14.4"
        ),
        js_fallback_detected=True,
        js_fallback_reason="interactive scripts did not run",
    )

    assert metadata["jsRenderSuspected"] is True
    assert metadata["jsFallbackDetected"] is True
    assert metadata["jsFallbackReason"] == "interactive scripts did not run"
    assert metadata["confidence"] <= 0.7


@pytest.mark.asyncio
async def test_web_extract_execute_cleans_js_fallback_and_recovers_release_event(monkeypatch):
    tool = WebExtractTool()

    class _PythonFallbackBackend(BaseTool):
        name = "python_fallback_backend"
        description = "Returns a Python.org JS fallback page."
        parameters = {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}

        async def execute(self, input):
            output = {
                "kind": "content",
                "url": input["url"],
                "title": "Python Release Python 3.14.4 | Python.org",
                "content": (
                    "Notice: This page displays a fallback because interactive scripts did not run. "
                    "Downloads All releases Source code Windows macOS Other Platforms License Alternative Implementations "
                    "Python Release Python 3.14.4 Python 3.14.4 is the fourth maintenance release of Python 3.14."
                ),
                "jsRenderSuspected": True,
                "jsFallbackDetected": True,
                "jsFallbackReason": "interactive scripts did not run",
            }
            return ToolResult(tool_name=self.name, input=input, output=output, duration_ms=1, sandboxed=False)

    monkeypatch.setattr(
        tool,
        "_discover_backend_tools",
        lambda page_kind, allow_interaction, backend_order=None: [(_PythonFallbackBackend(), "reader")],
    )

    result = await tool.execute(
        {
            "url": "https://www.python.org/downloads/release/python-3144/",
            "taskType": "page_read",
            "pageKind": "news/article",
            "expectedFields": ["event", "date_time", "what_changed"],
        }
    )

    assert result.error is None
    assert result.output["kind"] == "content"
    assert result.output["jsRenderSuspected"] is True
    assert result.output["jsFallbackDetected"] is True
    assert result.output["structuredData"]["event"] == "Python Release Python 3.14.4"
    assert result.output["quality"] == "extract_partial"
    assert result.output["confidence"] <= 0.7
    assert "interactive scripts did not run" not in result.output["content"].lower()


@pytest.mark.asyncio
async def test_web_extract_execute_preserves_fetch_contract_for_normal_content(monkeypatch):
    tool = WebExtractTool()

    async def fake_fetch(input):
        output = {
            "kind": "content",
            "url": input["url"],
            "title": "Example Domain",
            "content": (
                "Example Domain is for use in documentation examples and test flows. "
                "This page is intentionally simple so teams can verify fetch, extraction, "
                "and rendering behavior without noisy layout changes. It contains stable "
                "descriptive text, a clear heading, and enough body copy to look like a "
                "normal readable page instead of a thin shell or navigation fragment."
            ),
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": input["url"],
            "transportStrategy": "direct_http",
            "backendAttempts": [
                {
                    "attempt": "direct_http",
                    "strategy": "direct_http",
                    "status": "ok",
                    "httpStatus": 200,
                    "redirectedUrl": input["url"],
                    "transportStrategy": "direct_http",
                    "elapsed_ms": 12.5,
                    "contentType": "text/html; charset=utf-8",
                }
            ],
            "jsRenderSuspected": False,
            "jsFallbackDetected": False,
            "jsFallbackReason": None,
        }
        return ToolResult(
            tool_name="web_fetch",
            input=input,
            output=output,
            duration_ms=1,
            sandboxed=False,
            source_url=input["url"],
            provenance_hint=output.copy(),
        )

    monkeypatch.setattr(
        tool,
        "_discover_backend_tools",
        lambda page_kind, allow_interaction, backend_order=None: [(tool.fetch_tool, "web_fetch")],
    )
    monkeypatch.setattr(tool.fetch_tool, "execute", fake_fetch)

    result = await tool.execute(
        {
            "url": "https://example.com/",
            "taskType": "page_read",
            "pageKind": "general",
            "expectedFields": [],
        }
    )

    assert result.error is None
    assert result.output["kind"] == "content"
    assert result.output["title"] == "Example Domain"
    assert "documentation examples" in result.output["content"]
    assert result.output["backendUsed"] == "web_fetch"
    assert result.output["backendAttempts"][0]["strategy"] == "direct_http"
    assert result.output["backendAttempts"][0]["status"] == "success"
    assert result.output["jsRenderSuspected"] is False
    assert result.output["jsFallbackDetected"] is False
    assert result.output["jsFallbackReason"] is None
    assert result.output["quality"] == "extract_clean"


@pytest.mark.asyncio
async def test_web_extract_execute_classifies_spa_empty_shell_as_failed_content(monkeypatch):
    tool = WebExtractTool()

    async def fake_fetch(input):
        output = {
            "kind": "content",
            "url": input["url"],
            "title": "OpenAI Changelog",
            "content": "",
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": input["url"],
            "transportStrategy": "direct_http",
            "backendAttempts": [
                {
                    "attempt": "direct_http",
                    "strategy": "direct_http",
                    "status": "ok",
                    "httpStatus": 200,
                    "redirectedUrl": input["url"],
                    "transportStrategy": "direct_http",
                    "elapsed_ms": 18.0,
                    "contentType": "text/html; charset=utf-8",
                }
            ],
            "jsRenderSuspected": True,
            "jsFallbackDetected": True,
            "jsFallbackReason": 'spa_empty_shell: <div id="__next"></div>',
        }
        return ToolResult(
            tool_name="web_fetch",
            input=input,
            output=output,
            duration_ms=1,
            sandboxed=False,
            source_url=input["url"],
            provenance_hint=output.copy(),
        )

    monkeypatch.setattr(
        tool,
        "_discover_backend_tools",
        lambda page_kind, allow_interaction, backend_order=None: [(tool.fetch_tool, "web_fetch")],
    )
    monkeypatch.setattr(tool.fetch_tool, "execute", fake_fetch)

    result = await tool.execute(
        {
            "url": "https://developers.openai.com/api/docs/changelog",
            "taskType": "page_read",
            "pageKind": "docs/changelog",
            "expectedFields": ["update_items", "dates", "what_changed"],
        }
    )

    assert result.error is None
    assert result.output["kind"] == "content"
    assert result.output["httpStatus"] == 200
    assert result.output["fetchFailureKind"] is None
    assert result.output["jsRenderSuspected"] is True
    assert result.output["jsFallbackDetected"] is True
    assert result.output["jsFallbackReason"] == 'spa_empty_shell: <div id="__next"></div>'
    assert result.output["quality"] == "extract_garbage"
    assert result.output["tier"] == "failed"
    assert result.output["content"] == "[Page returned empty body. JavaScript rendering required.]"


def test_web_extract_quality_metadata_exposes_homepage_shape_signals():
    tool = WebExtractTool()
    raw_html = """
    <html>
      <body>
        <a href="/story-1">Top Story One</a>
        <a href="/story-2">Top Story Two</a>
        <a href="/sports">Sports</a>
        <a href="/business">Business</a>
      </body>
    </html>
    """

    metadata = tool._extraction_quality_metadata(
        url="https://timesofindia.indiatimes.com/",
        task_type="page_read",
        source_mode="user_named",
        page_kind="general",
        content="Top Story One. Top Story Two. Sports section. Business section.",
        structured_data={
            "page_items": ["Top Story One", "Top Story Two"],
            "headlines": ["Top Story One", "Top Story Two"],
            "sections": ["Sports", "Business"],
        },
        expected_fields=[],
        quality="extract_clean",
        extraction_method="reader",
        raw_source_text=raw_html,
    )

    assert metadata["pageType"] == "homepage"
    assert metadata["linkDensity"] > 0
    assert metadata["approximateItemCount"] >= 2
    assert metadata["structuredRecordCount"] >= 4


def test_web_extract_homepage_quality_metadata_downgrades_nav_heavy_blob():
    tool = WebExtractTool()
    raw_html = """
    <html>
      <body>
        <a href="/signin">Sign In</a>
        <a href="/weather">Weather</a>
        <a href="/city">City</a>
        <a href="/story-1">Akhilesh visits BJP MLA who was injured while burning his effigy</a>
        <a href="/story-2">Odisha 'skeleton' row: Bank says man was inebriated</a>
      </body>
    </html>
    """

    metadata = tool._extraction_quality_metadata(
        url="https://timesofindia.indiatimes.com/",
        task_type="page_read",
        source_mode="user_named",
        page_kind="general",
        content=(
            "TOI - Breaking News | The Times of India Edition IN Weather Sign In City Metro Cities "
            "Akhilesh visits BJP MLA who was injured while burning his effigy "
            "Odisha 'skeleton' row: Bank says man was inebriated"
        ),
        structured_data={},
        expected_fields=[],
        quality="extract_clean",
        extraction_method="web_fetch",
        raw_source_text=raw_html,
    )

    assert metadata["pageType"] == "homepage"
    assert metadata["tier"] in {"thin", "partial"}
    assert metadata["confidence"] < 0.9


def test_web_extract_augment_homepage_structured_data_prefers_real_headlines():
    tool = WebExtractTool()
    raw_html = """
    <html>
      <body>
        <a href="/signin">Sign In</a>
        <a href="/weather">Weather</a>
        <a href="/story-1">Akhilesh visits BJP MLA who was injured while burning his effigy</a>
        <a href="/story-2">Odisha 'skeleton' row: Bank says man was inebriated</a>
        <a href="/story-3">Learn Agentic AI and RAG with IITM Pravartak</a>
        <a href="/sports">Sports</a>
      </body>
    </html>
    """

    structured = tool._augment_homepage_structured_data(
        "TOI homepage dump Sign In Weather Akhilesh visits BJP MLA who was injured while burning his effigy",
        raw_html,
        {},
    )

    page_items = structured.get("page_items") or []
    sections = structured.get("sections") or []

    assert any("akhilesh visits bjp mla" in str(item).lower() for item in page_items)
    assert any("agentic ai and rag" in str(item).lower() for item in page_items)
    assert all(str(item).strip().lower() not in {"sign in", "weather"} for item in page_items)
    assert any(str(item).strip().lower() == "sports" for item in sections)


class _GarbageStandingsBackend(BaseTool):
    name = "fake_standings_backend"
    description = "Returns weak standings content that should trigger raw HTML recovery."
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string"},
            "taskType": {"type": "string"},
            "expectedFields": {"type": "array"},
        },
        "required": ["url"],
    }

    async def execute(self, input):
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "url": input["url"],
                "title": "IPL 2026 Points Table",
                "content": "IPL 2026 Team Standings Home Copy Season 2026 Role Batsman Ruturaj Gaikwad Title",
            },
            duration_ms=1,
            sandboxed=False,
        )


@pytest.mark.asyncio
async def test_web_extract_execute_uses_raw_html_recovery_for_garbage_standings(monkeypatch):
    tool = WebExtractTool()
    raw_html = """
    <html>
      <body>
        <section>Chennai Super Kings player profile and team archive.</section>
        <script type="application/json">
          {
            "standings": [
              {
                "team": "Chennai Super Kings",
                "position": "4",
                "points": "14",
                "nrr": "+0.455",
                "summary": "Top four race"
              }
            ]
          }
        </script>
      </body>
    </html>
    """

    async def fake_fetch(input):
        return ToolResult(
            tool_name="web_fetch",
            input=input,
            output={
                "kind": "content",
                "url": input["url"],
                "title": "IPL 2026 Points Table | Team Standings and Rankings | IPLT20",
                "content": raw_html,
            },
            duration_ms=1,
            sandboxed=False,
        )

    monkeypatch.setattr(
        tool,
        "_discover_backend_tools",
        lambda page_kind, allow_interaction, backend_order=None: [(_GarbageStandingsBackend(), "reader")],
    )
    monkeypatch.setattr(tool.fetch_tool, "execute", fake_fetch)

    result = await tool.execute(
        {
            "url": IPL_POINTS_TABLE_URL,
            "taskType": "sports_standings",
            "expectedFields": ["team", "position", "points", "nrr", "ranking_movement"],
            "pageKind": "standings/table",
        }
    )

    assert result.error is None
    assert isinstance(result.output, dict)
    assert result.output["backendUsed"] == "web_fetch_raw_html"
    assert result.output["quality"] in {"extract_clean", "extract_partial"}
    assert result.output["structuredData"]["team"] == "Chennai Super Kings"
    assert result.output["structuredData"]["position"] == "4"
    assert result.output["tier"] in {"clean", "partial"}
    assert isinstance(result.output["confidence"], float)


class _GarbageArticleBackend(BaseTool):
    name = "fake_article_backend"
    description = "Returns weak article content that should trigger raw HTML article recovery."
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string"},
        },
        "required": ["url"],
    }

    async def execute(self, input):
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "url": input["url"],
                "title": "Medium",
                "content": "Home / Copy Season Suggested Responses Create reasoning_effort",
            },
            duration_ms=1,
            sandboxed=False,
        )


@pytest.mark.asyncio
async def test_web_extract_execute_uses_raw_html_recovery_for_garbage_article(monkeypatch):
    tool = WebExtractTool()
    raw_html = """
    <html>
      <head>
        <meta property="og:title" content="Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014" />
        <meta property="og:description" content="Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience." />
      </head>
      <body>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014",
            "description": "Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience.",
            "datePublished": "2026-04-20",
            "articleBody": "The article argues that Ubuntu 26.04 LTS is becoming a better home for developers through cleaner defaults, modern tooling, and a workflow that feels more intentional."
          }
        </script>
      </body>
    </html>
    """

    async def fake_fetch(input):
        return ToolResult(
            tool_name="web_fetch",
            input=input,
            output={
                "kind": "content",
                "url": input["url"],
                "title": "Medium article",
                "content": raw_html,
            },
            duration_ms=1,
            sandboxed=False,
        )

    monkeypatch.setattr(
        tool,
        "_discover_backend_tools",
        lambda page_kind, allow_interaction, backend_order=None: [(_GarbageArticleBackend(), "reader")],
    )
    monkeypatch.setattr(tool.fetch_tool, "execute", fake_fetch)

    result = await tool.execute(
        {
            "url": "https://medium.com/example/dev-article",
            "taskType": "breaking_news",
            "expectedFields": ["event", "date_time", "what_changed"],
            "pageKind": "news/article",
        }
    )

    assert result.error is None
    assert isinstance(result.output, dict)
    assert result.output["backendUsed"] == "web_fetch_raw_html_article"
    assert result.output["quality"] in {"extract_clean", "extract_partial"}
    assert "Ubuntu 26.04 LTS" in result.output["content"]
    assert result.output["structuredData"]["event"] == "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014"
    assert result.output["tier"] in {"thin", "partial", "clean"}


@pytest.mark.asyncio
async def test_web_extract_surfaces_fetch_transport_failure_metadata(monkeypatch):
    tool = WebExtractTool()

    async def fake_fetch(input):
        return ToolResult(
            tool_name="web_fetch",
            input=input,
            output={
                "kind": "transport_failure",
                "url": input["url"],
                "title": "",
                "content": "",
                "fetchFailureKind": "socket_permission_denied",
                "networkError": "All connection attempts failed",
                "httpStatus": None,
                "redirectedUrl": input["url"],
                "backendAttempts": [
                    {
                        "attempt": "primary_http_fetch",
                        "status": "error",
                        "fetchFailureKind": "socket_permission_denied",
                        "networkError": "All connection attempts failed",
                    }
                ],
            },
            error="HTTP error: All connection attempts failed",
            duration_ms=1,
            sandboxed=False,
            source_url=input["url"],
        )

    monkeypatch.setattr(tool.fetch_tool, "execute", fake_fetch)
    monkeypatch.setattr(tool, "_discover_backend_tools", lambda *args, **kwargs: [(tool.fetch_tool, "web_fetch")])

    result = await tool.execute(
        {
            "url": "https://example.com/",
            "taskType": "page_read",
            "pageKind": "general",
            "backendOrder": ["web_fetch"],
        }
    )

    assert result.error == "No extraction backend produced usable content."
    assert isinstance(result.output, dict)
    assert result.output["kind"] == "transport_failure"
    assert result.output["fetchFailureKind"] == "socket_permission_denied"
    assert result.output["networkError"] == "All connection attempts failed"


@pytest.mark.asyncio
@pytest.mark.skipif(
    not LIVE_WEB_ENABLED,
    reason="Set RAWCLAW_RUN_LIVE_WEB=1 to run live web extraction tests.",
)
async def test_web_extract_live_iplt20_points_table_finds_csk_standing():
    tool = WebExtractTool()

    result = await tool.execute(
        {
            "url": IPL_POINTS_TABLE_URL,
            "taskType": "sports_standings",
            "expectedFields": ["team", "position", "points", "nrr", "ranking_movement"],
            "pageKind": "standings/table",
            "backendOrder": ["crawl4ai", "playwright", "opencli", "reader", "web_fetch"],
        }
    )

    assert result.error is None, f"Live extraction failed: {result.error}"
    assert isinstance(result.output, dict)

    output = result.output
    content = str(output.get("content") or "").lower()
    structured = output.get("structuredData") if isinstance(output.get("structuredData"), dict) else {}

    assert output.get("pageKind") == "standings/table"
    assert output.get("quality") in {"extract_clean", "extract_partial"}
    assert "iplt20.com" in str(output.get("url") or IPL_POINTS_TABLE_URL)
    assert output.get("backendUsed") not in {"", "none"}

    has_csk_team = str(structured.get("team") or "").strip().lower() == "chennai super kings"
    content_mentions_csk = "chennai super kings" in content or " csk " in f" {content} "

    assert has_csk_team or content_mentions_csk, (
        "Expected live IPL points-table extraction to expose Chennai Super Kings in either "
        "structured data or extracted content."
    )

    present_fields = {
        field
        for field in ["position", "points", "nrr", "ranking_movement"]
        if structured.get(field)
    }
    assert present_fields, (
        "Expected at least one standings field for CSK to be present in structured extraction. "
        f"Structured data was: {structured}"
    )
