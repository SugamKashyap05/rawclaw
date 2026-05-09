import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from html import unescape
from urllib.parse import urlparse

from src.contracts.tool import ToolResult
from src.tools.base_tool import BaseTool
from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.web_fetch import WebFetchTool, _detect_js_fallback_reason
from src.tools.builtin.page_read_types import has_weak_signal

logger = logging.getLogger("rawclaw.tools.web_extract")

GARBAGE_MARKERS = [
    "home / copy season",
    "copy role batsman",
    "primary navigation",
    "search the api docs",
    "suggested responses create reasoning_effort",
    "results squad fixtures",
    "matches fixtures results",
    "get started overview quickstart",
]

TEAM_ALIASES = {
    "chennai super kings": ["chennai super kings", "csk"],
}

PARTY_ALIASES = {
    "BJP": ["bjp", "bharatiya janata party", "saffron camp"],
    "TMC": ["tmc", "trinamool congress", "all india trinamool congress"],
    "Congress": ["congress", "inc", "indian national congress"],
    "Left Front": ["left front", "left alliance"],
    "CPI(M)": ["cpi(m)", "cpim", "communist party of india (marxist)"],
    "DMK": ["dmk", "dravida munnetra kazhagam"],
    "AIADMK": ["aiadmk", "all india anna dravida munnetra kazhagam"],
}

ELECTION_VICTORY_MARKERS = [
    "won",
    "wins",
    "winning",
    "victory",
    "victorious",
    "clinch",
    "clinches",
    "clinching",
    "sweep",
    "sweeping",
    "landslide",
    "majority",
    "forms the government",
    "form the government",
    "form its first government",
    "scripted a historic and sweeping victory",
]

PAYWALL_MARKERS = [
    "subscribe to continue",
    "subscribe to read",
    "become a member",
    "already a subscriber",
    "sign in to continue",
    "create an account to read",
    "unlock this article",
    "remaining story",
    "continue reading with a free trial",
]

JS_SHELL_MARKERS = [
    "__next",
    "__nuxt",
    "window.__apollo_state__",
    "hydrate-root",
    "id=\"root\"",
    "id=\"app\"",
    "data-reactroot",
]

HOMEPAGE_NAV_MARKERS = [
    "edition",
    "sign in",
    "weather",
    "videos",
    "city",
    "metro cities",
    "photos",
    "web stories",
    "india",
    "world",
    "business",
    "tech",
    "sports",
    "entertainment",
    "astro tv",
    "education",
    "life & style",
    "blogs",
    "live in the news",
]

GENERIC_SECTION_LABELS = {
    "home", "india", "world", "business", "tech", "sports", "cricket", "entertainment",
    "education", "photos", "videos", "weather", "cities", "city", "metro", "blogs",
    "news", "life", "style", "astro", "tv",
}

JS_FALLBACK_NOTE = (
    "[Note: This page served a no-JS fallback. Content may be incomplete. "
    "Full content requires JavaScript rendering.]"
)
EMPTY_BODY_JS_NOTE = "[Page returned empty body. JavaScript rendering required.]"

JS_NAV_WORDS = {
    "about", "downloads", "download", "docs", "documentation", "community", "success", "stories", "news",
    "events", "psf", "python", "software", "foundation", "jobs", "forums", "shop", "help", "faq",
    "windows", "macos", "linux", "source", "code", "release", "release", "releases", "all",
}

BROWSER_NAVIGATION_TOOLS = {"browser_navigate", "browser_snapshot"}


class WebExtractTool(BaseTool):
    name = "web_extract"
    description = (
        "Extracts usable page evidence from a URL using the best available backend. "
        "Prefers structured extraction backends such as Crawl4AI, browser automation backends such as Playwright or OpenCLI when available, "
        "and falls back to local fetch plus reader-style cleanup."
    )
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The page URL to extract."},
            "taskType": {
                "type": "string",
                "description": "Optional runtime task type such as page_read, factual_extract, research, or ambiguous.",
            },
            "sourceMode": {
                "type": "string",
                "description": "Optional source mode such as user_named, system_chosen, or hybrid.",
            },
            "expectedFields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional structured fields the extractor should try to recover.",
            },
            "allowInteraction": {
                "type": "boolean",
                "default": False,
                "description": "Whether logged-in or interaction-heavy backends like OpenCLI may be used.",
            },
            "pageKind": {
                "type": "string",
                "description": "Optional pre-classified page kind such as news/article, docs/changelog, standings/table, or interactive/authenticated.",
            },
            "backendOrder": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional preferred backend order such as crawl4ai, playwright, opencli, reader, web_fetch.",
            },
            "allowInternalBrowserEscalation": {
                "type": "boolean",
                "default": True,
                "description": "Whether web_extract may run its own browser escalation. Orchestrated direct page reads set this false.",
            },
            "maxDurationMs": {
                "type": "integer",
                "description": "Optional cooperative max duration for extraction before returning weak evidence.",
            },
        },
        "required": ["url"],
    }
    capability_tags = ["extract", "fetch", "read", "research"]
    requires_confirmation = False
    requires_sandbox = False

    def __init__(self) -> None:
        registered_fetch = TOOL_REGISTRY.get_optional("web_fetch")
        self.fetch_tool = registered_fetch if isinstance(registered_fetch, WebFetchTool) else WebFetchTool()

    def _fetch_failure_metadata(self, result: Optional[ToolResult]) -> Dict[str, Any]:
        output = result.output if result and isinstance(result.output, dict) else {}
        return {
            "kind": output.get("kind"),
            "fetchFailureKind": output.get("fetchFailureKind"),
            "httpStatus": output.get("httpStatus"),
            "networkError": output.get("networkError") or result.error if result else None,
            "redirectedUrl": output.get("redirectedUrl"),
            "transportStrategy": output.get("transportStrategy"),
            "fetchBackendAttempts": output.get("backendAttempts") if isinstance(output.get("backendAttempts"), list) else [],
        }

    def _flatten_fetch_backend_attempts(self, backend_type: str, tool_name: str, result: Optional[ToolResult]) -> List[Dict[str, Any]]:
        output = result.output if result and isinstance(result.output, dict) else {}
        nested_attempts = output.get("backendAttempts") if isinstance(output.get("backendAttempts"), list) else []
        flattened: List[Dict[str, Any]] = []
        for attempt in nested_attempts:
            if not isinstance(attempt, dict):
                continue
            flattened.append(
                {
                    "backend": backend_type,
                    "tool": tool_name,
                    "strategy": attempt.get("strategy") or attempt.get("attempt"),
                    "attempt": attempt.get("attempt"),
                    "status": "success" if attempt.get("status") == "ok" else attempt.get("status"),
                    "fetchFailureKind": attempt.get("fetchFailureKind"),
                    "httpStatus": attempt.get("httpStatus"),
                    "networkError": attempt.get("networkError"),
                    "redirectedUrl": attempt.get("redirectedUrl"),
                    "transportStrategy": attempt.get("transportStrategy"),
                    "elapsed_ms": attempt.get("elapsed_ms"),
                    "contentType": attempt.get("contentType"),
                }
            )
        return flattened

    def _normalize_text(self, text: str) -> str:
        cleaned = unescape(str(text or ""))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        return re.sub(r"\s+", " ", cleaned).strip()

    def _strip_site_suffix(self, title: str) -> str:
        raw = self._normalize_text(title)
        if not raw:
            return ""
        for separator in [" | ", " - ", " — ", " – "]:
            if separator in raw:
                return raw.split(separator, 1)[0].strip()
        return raw

    def _extract_release_event_from_title(self, title: str, page_kind: str) -> str:
        normalized = self._strip_site_suffix(title)
        if page_kind != "news/article" or not normalized:
            return ""
        if "release" in normalized.lower():
            return normalized
        return ""

    def _resolve_js_fallback_metadata(self, result: Optional[ToolResult], raw_text: str) -> Tuple[bool, Optional[str]]:
        output = result.output if result and isinstance(result.output, dict) else {}
        detected = bool(output.get("jsFallbackDetected"))
        reason = str(output.get("jsFallbackReason") or "").strip() or None
        if not reason:
            reason = _detect_js_fallback_reason(raw_text)
        return bool(detected or reason), reason

    def _clean_js_fallback_content(self, content: str, title: str, matched_signal: Optional[str]) -> str:
        cleaned = str(content or "")
        if not cleaned:
            return ""
        if matched_signal:
            sentence_pattern = rf"[^.!?\n]*{re.escape(matched_signal)}[^.!?\n]*[.!?]?"
            cleaned = re.sub(sentence_pattern, " ", cleaned, flags=re.IGNORECASE)
        heading = self._extract_release_event_from_title(title, "news/article") or self._strip_site_suffix(title)
        if heading:
            idx = cleaned.lower().find(heading.lower())
            if idx > 0:
                cleaned = cleaned[idx:]

        lines = [self._normalize_text(line) for line in re.split(r"[\n\r]+|(?<=[.!?])\s+", cleaned) if self._normalize_text(line)]
        kept: List[str] = []
        found_meaningful = False
        for line in lines:
            tokens = [token.strip(".,:;!?()[]{}\"'").lower() for token in line.split()]
            nav_tokens = [token for token in tokens if token in JS_NAV_WORDS]
            nav_heavy = len(tokens) >= 3 and (len(nav_tokens) / max(len(tokens), 1)) > 0.6
            if not found_meaningful and nav_heavy:
                continue
            if heading and line.lower().startswith(heading.lower()):
                found_meaningful = True
            if len(tokens) >= 5 and not nav_heavy:
                found_meaningful = True
            kept.append(line)

        return self._normalize_text(" ".join(kept))

    def _page_kind(self, url: str, task_type: str, allow_interaction: bool, page_kind_hint: str = "") -> str:
        if page_kind_hint:
            return str(page_kind_hint).strip()
        lowered_url = (url or "").lower()
        lowered_task = (task_type or "").lower()
        if allow_interaction or any(token in lowered_task for token in ["interactive", "authenticated"]):
            return "interactive/authenticated"
        if any(token in lowered_url for token in ["points-table", "standings", "rankings", "leaderboard", "table"]):
            return "standings/table"
        if any(
            token in lowered_url for token in ["docs", "changelog", "release", "developer", "api"]
        ):
            return "docs/changelog"
        if any(token in lowered_url for token in ["news", "article", "blog", "press"]):
            return "news/article"
        return "general"

    def _default_expected_fields(self, task_type: str, expected_fields: List[str]) -> List[str]:
        if expected_fields:
            return expected_fields
        lowered = (task_type or "").lower()
        if lowered == "sports_standings":
            return ["team", "position", "points", "nrr", "ranking_movement"]
        if lowered == "breaking_news":
            return ["event", "date_time", "what_changed"]
        if lowered in {"product_company_updates", "technical_research"}:
            return ["update_items", "dates", "what_changed"]
        return []

    def _backend_type(self, tool: BaseTool) -> str:
        haystack = " ".join(
            [
                getattr(tool, "name", ""),
                getattr(tool, "description", ""),
                " ".join(getattr(tool, "capability_tags", []) or []),
            ]
        ).lower()
        if "crawl4ai" in haystack:
            return "crawl4ai"
        if "opencli" in haystack:
            return "opencli"
        if "playwright" in haystack or getattr(tool, "name", "").lower().startswith("browser_"):
            return "playwright"
        if "reader" in haystack:
            return "reader"
        if getattr(tool, "name", "") == "web_fetch":
            return "web_fetch"
        return "unknown"

    def _backend_score(self, tool: BaseTool, page_kind: str, allow_interaction: bool, backend_order: Optional[List[str]] = None) -> int:
        name = getattr(tool, "name", "")
        if self._is_browser_action_tool(tool):
            return -100
        if getattr(tool, "capability_tags", None) and "mcp" in (getattr(tool, "capability_tags", []) or []):
            if getattr(tool, "accepts_url", True) is False:
                return -100
        if name in {self.name, "web_search", "duckduckgo_search", "smart_search", "sequential_thinking"}:
            return -100
        backend_type = self._backend_type(tool)
        score = 0
        if backend_type == "crawl4ai":
            score += 100
        elif backend_type == "playwright":
            score += 70
        elif backend_type == "opencli":
            score += 60 if allow_interaction or page_kind == "interactive/authenticated" else 20
        elif backend_type == "reader":
            score += 55 if page_kind in {"news/article", "docs/changelog"} else 10
        elif backend_type == "web_fetch":
            score += 30

        tags = set(getattr(tool, "capability_tags", []) or [])
        if "extract" in tags:
            score += 12
        if "browser" in tags:
            score += 8
        if "network" in tags:
            score += 4
        if page_kind == "interactive/authenticated" and backend_type in {"opencli", "playwright"}:
            score += 25
        if page_kind == "standings/table" and backend_type in {"crawl4ai", "playwright"}:
            score += 10
        if page_kind == "docs/changelog" and backend_type in {"crawl4ai", "reader"}:
            score += 8
        if backend_order and backend_type in backend_order:
            score += max(0, 20 - (backend_order.index(backend_type) * 4))
        return score

    def _is_browser_action_tool(self, tool: BaseTool) -> bool:
        name = str(getattr(tool, "name", "") or "").lower()
        return name.startswith("browser_")

    def _discover_backend_tools(self, page_kind: str, allow_interaction: bool, backend_order: Optional[List[str]] = None) -> List[Tuple[BaseTool, str]]:
        candidates: List[Tuple[BaseTool, str, int]] = []
        for tool_name in TOOL_REGISTRY.tool_names:
            tool = TOOL_REGISTRY.get_optional(tool_name)
            if not tool:
                continue
            score = self._backend_score(tool, page_kind, allow_interaction, backend_order=backend_order)
            if score <= 0:
                continue
            candidates.append((tool, self._backend_type(tool), score))

        candidates.sort(key=lambda item: (item[2], item[0].name != "web_fetch"), reverse=True)
        deduped: List[Tuple[BaseTool, str]] = []
        seen = set()
        for tool, backend_type, _score in candidates:
            key = (backend_type, tool.name)
            if key in seen:
                continue
            seen.add(key)
            deduped.append((tool, backend_type))
        return deduped

    def _generic_tool_input(
        self,
        tool: BaseTool,
        url: str,
        task_type: str,
        expected_fields: List[str],
        allow_interaction: bool,
    ) -> Optional[Dict[str, Any]]:
        if tool.name == "web_fetch":
            return {"url": url, "extract_text": True}

        schema = tool.parameters or {}
        properties = schema.get("properties") or {}
        tool_input: Dict[str, Any] = {}
        lowered_props = {str(key).lower(): key for key in properties.keys()}

        url_key = None
        for candidate in ["url", "uri", "link", "pageurl", "targeturl", "address"]:
            if candidate in lowered_props:
                url_key = lowered_props[candidate]
                break
        if url_key:
            tool_input[url_key] = url

        for candidate in ["tasktype", "task_type"]:
            if candidate in lowered_props and task_type:
                tool_input[lowered_props[candidate]] = task_type
        for candidate in ["expectedfields", "expected_fields", "fields"]:
            if candidate in lowered_props and expected_fields:
                tool_input[lowered_props[candidate]] = expected_fields
        for candidate in ["allowinteraction", "allow_interaction", "interactive"]:
            if candidate in lowered_props:
                tool_input[lowered_props[candidate]] = allow_interaction
        for candidate in ["extracttext", "extract_text"]:
            if candidate in lowered_props:
                tool_input[lowered_props[candidate]] = True
        for candidate in ["format", "outputformat", "output_format"]:
            if candidate in lowered_props:
                tool_input[lowered_props[candidate]] = "markdown"

        return tool_input or None

    def _extract_content_like_output(self, result: ToolResult) -> Tuple[str, str, str, Dict[str, Any]]:
        output = result.output if isinstance(result.output, dict) else {}
        title = ""
        content = ""
        url = ""
        structured: Dict[str, Any] = {}

        if isinstance(output, dict):
            title = self._normalize_text(output.get("title") or output.get("pageTitle") or output.get("name") or "")
            url = str(output.get("url") or output.get("sourceUrl") or output.get("finalUrl") or result.source_url or "").strip()
            structured = output.get("structuredData") if isinstance(output.get("structuredData"), dict) else {}

            content_candidates = [
                output.get("content"),
                output.get("markdown"),
                output.get("text"),
                output.get("body"),
                output.get("page_content"),
                output.get("pageContent"),
                output.get("result"),
            ]
            for candidate in content_candidates:
                if isinstance(candidate, str) and candidate.strip():
                    content = candidate
                    break
            if not content and isinstance(output.get("data"), dict):
                data = output.get("data") or {}
                for key in ["content", "markdown", "text", "body"]:
                    if isinstance(data.get(key), str) and data.get(key, "").strip():
                        content = data.get(key)
                        break

        if not content and isinstance(result.output, str):
            content = result.output
        return title, self._normalize_text(content), url, structured

    def _reader_style_cleanup(self, content: str, page_kind: str) -> str:
        text = re.sub(r"<[^>]+>", " ", unescape(str(content or "")))
        if not text:
            return ""
        lines = [self._normalize_text(line) for line in text.splitlines() if self._normalize_text(line)]
        cleaned: List[str] = []
        seen = set()
        for line in lines:
            lowered = line.lower()
            if any(marker in lowered for marker in GARBAGE_MARKERS):
                continue
            if lowered.count("|") >= 5:
                continue
            if re.search(r"\bseason\s+20\d{2}\s+season\s+20\d{2}\b", lowered):
                continue
            key = re.sub(r"[^a-z0-9]+", " ", lowered).strip()
            short_key = " ".join(key.split()[:12])
            if not short_key or short_key in seen:
                continue
            seen.add(short_key)
            cleaned.append(line)

        joined = "\n".join(cleaned)
        if page_kind in {"news/article", "docs/changelog"}:
            parts = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", joined) if segment.strip()]
            return "\n".join(parts[:10])
        return joined[:3500]

    def _extract_standings_data(self, content: str) -> Dict[str, Any]:
        lowered = content.lower()
        team = ""
        for canonical, aliases in TEAM_ALIASES.items():
            if any(alias in lowered for alias in aliases):
                team = canonical.title()
                break

        points_match = re.search(r"\b(\d{1,2})\s*(?:points|pts)\b", lowered)
        nrr_match = re.search(r"\b(?:nrr|net run rate)\b[:\s]*([+-]?\d+(?:\.\d+)?)", lowered)
        position_match = re.search(r"\b(?:position|rank(?:ing)?|placed)\b[:\s#-]*(\d{1,2})", lowered)
        movement = []
        for marker in ["top four", "playoff", "qualify", "qualification", "moved up", "moved down", "race"]:
            if marker in lowered:
                movement.append(marker)
        data: Dict[str, Any] = {}
        if team:
            data["team"] = team
        if position_match:
            data["position"] = position_match.group(1)
        if points_match:
            data["points"] = points_match.group(1)
        if nrr_match:
            data["nrr"] = nrr_match.group(1)
        if movement:
            data["ranking_movement"] = movement[:4]
        if "live" in lowered or "updated in real-time" in lowered or "changes as results come in" in lowered:
            data["summary"] = "The table is live and shifts as match results are added."
        return data

    def _extract_standings_window_data(self, lowered_window: str, team: str, team_alias: str) -> Dict[str, Any]:
        data: Dict[str, Any] = {"team": team}

        position_patterns = [
            rf'{re.escape(team_alias)}.{{0,320}}?"(?:position|rank|ranking|standing|pos)"\s*[:=]\s*"?(\d{{1,2}})"?',
            rf'"(?:position|rank|ranking|standing|pos)"\s*[:=]\s*"?(\d{{1,2}})"?.{{0,320}}{re.escape(team_alias)}',
            rf'(?:position|rank|placed)\s*[:#-]?\s*(\d{{1,2}}).{{0,180}}{re.escape(team_alias)}',
            rf'{re.escape(team_alias)}.{{0,180}}(?:position|rank|placed)\s*[:#-]?\s*(\d{{1,2}})',
        ]
        points_patterns = [
            rf'{re.escape(team_alias)}.{{0,320}}?"(?:points|pts)"\s*[:=]\s*"?(\d{{1,2}})"?',
            rf'"(?:points|pts)"\s*[:=]\s*"?(\d{{1,2}})"?.{{0,320}}{re.escape(team_alias)}',
            rf'{re.escape(team_alias)}.{{0,180}}(?:points|pts)\s*[:#-]?\s*(\d{{1,2}})',
            rf'(?:points|pts)\s*[:#-]?\s*(\d{{1,2}}).{{0,180}}{re.escape(team_alias)}',
        ]
        nrr_patterns = [
            rf'{re.escape(team_alias)}.{{0,320}}?"(?:nrr|netRunRate|net_run_rate|net run rate)"\s*[:=]\s*"?([+-]?\d+(?:\.\d+)?)"?',
            rf'"(?:nrr|netRunRate|net_run_rate|net run rate)"\s*[:=]\s*"?([+-]?\d+(?:\.\d+)?)"?.{{0,320}}{re.escape(team_alias)}',
            rf'{re.escape(team_alias)}.{{0,180}}(?:nrr|net run rate)\s*[:#-]?\s*([+-]?\d+(?:\.\d+)?)',
            rf'(?:nrr|net run rate)\s*[:#-]?\s*([+-]?\d+(?:\.\d+)?) .{{0,180}}{re.escape(team_alias)}',
        ]

        for pattern in position_patterns:
            match = re.search(pattern, lowered_window, re.IGNORECASE | re.DOTALL)
            if match:
                data["position"] = match.group(1)
                break
        for pattern in points_patterns:
            match = re.search(pattern, lowered_window, re.IGNORECASE | re.DOTALL)
            if match:
                data["points"] = match.group(1)
                break
        for pattern in nrr_patterns:
            match = re.search(pattern, lowered_window, re.IGNORECASE | re.DOTALL)
            if match:
                data["nrr"] = match.group(1)
                break

        movement = []
        for marker in ["top four", "playoff", "qualify", "qualification", "moved up", "moved down", "race"]:
            if marker in lowered_window:
                movement.append(marker)
        if movement:
            data["ranking_movement"] = movement[:4]
        return data

    def _standings_recovery_score(self, data: Dict[str, Any], lowered_window: str) -> int:
        score = 0
        if data.get("team"):
            score += 1
        for field in ["position", "points", "nrr"]:
            if data.get(field):
                score += 3
        if data.get("ranking_movement"):
            score += 1
        if any(marker in lowered_window for marker in ["points", "pts", "nrr", "net run rate", "position", "rank", "standing"]):
            score += 1
        return score

    def _recover_standings_from_raw_html(self, raw_html: str) -> Tuple[str, Dict[str, Any]]:
        html = str(raw_html or "")
        if not html:
            return "", {}

        lowered_html = html.lower()
        best_window_text = ""
        best_team = ""
        best_data: Dict[str, Any] = {}
        best_score = -1

        for canonical, aliases in TEAM_ALIASES.items():
            team = canonical.title()
            alias_hits: List[Tuple[str, int]] = []
            for alias in aliases:
                for match in re.finditer(re.escape(alias), lowered_html):
                    alias_hits.append((alias, match.start()))

            alias_hits.sort(key=lambda item: item[1])
            for team_alias, alias_index in alias_hits[:40]:
                window_start = max(0, alias_index - 1200)
                window_end = min(len(html), alias_index + 2200)
                window_html = html[window_start:window_end]
                window_text = self._normalize_text(
                    re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(window_html)))
                )
                lowered_window = window_text.lower()
                data = self._extract_standings_window_data(lowered_window, team, team_alias)
                score = self._standings_recovery_score(data, lowered_window)
                if score > best_score:
                    best_score = score
                    best_window_text = window_text
                    best_team = team
                    best_data = data

        if not best_team:
            return "", {}

        summary_parts = [f"{best_team} appear in the extracted standings page source."]
        if best_data.get("position"):
            summary_parts.append(f"Position: {best_data['position']}.")
        if best_data.get("points"):
            summary_parts.append(f"Points: {best_data['points']}.")
        if best_data.get("nrr"):
            summary_parts.append(f"NRR: {best_data['nrr']}.")
        if best_data.get("ranking_movement"):
            summary_parts.append(
                "Race markers: " + ", ".join(str(item) for item in best_data["ranking_movement"]) + "."
            )

        summary = " ".join(summary_parts)
        if len(best_data) <= 1:
            return best_window_text[:1000], best_data
        return summary, best_data

    def _extract_news_data(self, content: str) -> Dict[str, Any]:
        lowered = content.lower()
        sentences = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", content) if segment.strip()]
        event = ""
        what_changed = ""
        for sentence in sentences[:8]:
            low = sentence.lower()
            if not event and any(token in low for token in ["launch", "flight", "test", "update", "mission", "milestone", "announced"]):
                event = sentence
            if not what_changed and any(token in low for token in ["transition", "preparing", "demonstrated", "support", "expanded", "increasing", "regular orbital missions"]):
                what_changed = sentence
        date_match = re.search(
            r"\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b",
            lowered,
        )
        data: Dict[str, Any] = {}
        if event:
            data["event"] = event
        if what_changed:
            data["what_changed"] = what_changed
        if date_match:
            data["date_time"] = date_match.group(0)
        return data

    def _extract_update_items(self, content: str) -> Dict[str, Any]:
        sentences = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", content) if segment.strip()]
        updates: List[str] = []
        dates: List[str] = []
        for sentence in sentences[:14]:
            lowered = sentence.lower()
            if any(
                token in lowered
                for token in ["release", "released", "introduced", "supports", "support", "expanded", "added", "launch", "launched", "enhanced", "improved", "model", "sdk", "api", "endpoint"]
            ):
                updates.append(sentence)
            for match in re.finditer(
                r"\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b",
                lowered,
            ):
                dates.append(match.group(0))
        data: Dict[str, Any] = {}
        if updates:
            data["update_items"] = updates[:4]
            data["what_changed"] = updates[:2]
        if dates:
            data["dates"] = dates[:4]
        return data

    def _is_election_result_task(self, task_type: str, expected_fields: Optional[List[str]] = None) -> bool:
        lowered_task = str(task_type or "").lower()
        lowered_fields = {str(field or "").strip().lower() for field in (expected_fields or [])}
        return (
            lowered_task == "election_results_brief"
            or {"winner", "party", "seat_tally"}.issubset(lowered_fields)
            or ("winner" in lowered_fields and "seat_tally" in lowered_fields)
        )

    def _extract_election_result_data(self, content: str, title: str = "") -> Dict[str, Any]:
        text = self._normalize_text(" ".join(part for part in [title, content] if part))
        lowered = text.lower()
        title_lower = self._normalize_text(title).lower()
        data: Dict[str, Any] = {}

        date_match = re.search(
            r"\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b",
            lowered,
        )
        if date_match:
            data["date_time"] = date_match.group(0)

        seat_match = re.search(
            r"\b(\d{1,3})\s+seats?\b(?:\s+out\s+of\s+\d{2,3}\b)?",
            text,
            re.IGNORECASE,
        )
        if seat_match:
            data["seat_tally"] = seat_match.group(0).strip()

        title_window = title_lower[:320]
        title_hits: List[Tuple[int, str]] = []
        for party, aliases in PARTY_ALIASES.items():
            for alias in aliases:
                idx = title_window.find(alias.lower())
                if idx != -1:
                    title_hits.append((idx, party))
                    break
        for idx, party in sorted(title_hits, key=lambda item: item[0]):
            window = title_window[idx:idx + 120]
            if any(marker in window for marker in ELECTION_VICTORY_MARKERS) or (
                data.get("seat_tally") and str(data["seat_tally"]).lower() in window
            ):
                data["winner"] = party
                data["party"] = party
                return data

        best_party = ""
        best_score = 0
        search_window = lowered[:1600]
        victory_pattern = "|".join(re.escape(marker) for marker in ELECTION_VICTORY_MARKERS)
        for party, aliases in PARTY_ALIASES.items():
            score = 0
            for alias in aliases:
                pattern = re.escape(alias.lower())
                if re.search(rf"\b{pattern}\b", search_window):
                    score += 2
                if re.search(rf"\b{pattern}\b", title_lower):
                    score += 4
                if re.search(rf"\b{pattern}\b.{0,100}\b(?:{victory_pattern})\b", search_window):
                    score += 4
                if re.search(rf"\b(?:{victory_pattern})\b.{0,100}\b{pattern}\b", search_window):
                    score += 3
                if data.get("seat_tally") and re.search(
                    rf"\b{pattern}\b.{0,120}{re.escape(str(data['seat_tally']).lower())}",
                    search_window,
                ):
                    score += 3
            if score > best_score:
                best_score = score
                best_party = party

        if best_party:
            data["winner"] = best_party
            data["party"] = best_party

        return data

    def _extract_meta_tag(self, raw_html: str, attr_name: str, attr_value: str) -> str:
        pattern = (
            rf'<meta[^>]+{attr_name}=["\']{re.escape(attr_value)}["\'][^>]+content=["\']([^"\']+)["\']'
            rf'|<meta[^>]+content=["\']([^"\']+)["\'][^>]+{attr_name}=["\']{re.escape(attr_value)}["\']'
        )
        match = re.search(pattern, raw_html, re.IGNORECASE)
        if not match:
            return ""
        for group in match.groups():
            if group:
                return self._normalize_text(unescape(group))
        return ""

    def _extract_json_ld_articles(self, raw_html: str) -> List[Dict[str, Any]]:
        articles: List[Dict[str, Any]] = []
        for match in re.finditer(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            raw_html,
            re.IGNORECASE | re.DOTALL,
        ):
            payload = self._parse_jsonp_payload(unescape(match.group(1)))
            candidates = payload if isinstance(payload, list) else [payload]
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                candidate_type = str(candidate.get("@type") or "").lower()
                if candidate_type in {"newsarticle", "article", "blogposting", "report", "liveblogposting"}:
                    articles.append(candidate)
                if candidate_type == "liveblogposting" and isinstance(candidate.get("liveBlogUpdate"), list):
                    for update in candidate.get("liveBlogUpdate") or []:
                        if isinstance(update, dict):
                            articles.append(update)
                graph = candidate.get("@graph")
                if isinstance(graph, list):
                    for entry in graph:
                        if not isinstance(entry, dict):
                            continue
                        entry_type = str(entry.get("@type") or "").lower()
                        if entry_type in {"newsarticle", "article", "blogposting", "report"}:
                            articles.append(entry)
        return articles

    def _recover_article_from_raw_html(self, raw_html: str) -> Tuple[str, Dict[str, Any]]:
        html = str(raw_html or "")
        if not html:
            return "", {}

        title = self._extract_meta_tag(html, "property", "og:title") or self._extract_meta_tag(html, "name", "twitter:title")
        description = (
            self._extract_meta_tag(html, "property", "og:description")
            or self._extract_meta_tag(html, "name", "twitter:description")
            or self._extract_meta_tag(html, "name", "description")
        )
        article_body = ""
        date_published = ""
        article_candidates = self._extract_json_ld_articles(html)
        for candidate in article_candidates:
            if not title:
                title = self._normalize_text(candidate.get("headline") or candidate.get("name") or "")
            if not description:
                description = self._normalize_text(candidate.get("description") or "")
            if not date_published:
                date_published = self._normalize_text(candidate.get("datePublished") or candidate.get("dateCreated") or "")
            if not article_body:
                article_body = self._normalize_text(candidate.get("articleBody") or "")

        if not article_body:
            paragraph_matches = re.findall(r"<p[^>]*>(.*?)</p>", html, re.IGNORECASE | re.DOTALL)
            paragraphs = [
                self._normalize_text(re.sub(r"<[^>]+>", " ", unescape(paragraph)))
                for paragraph in paragraph_matches
            ]
            paragraphs = [
                paragraph for paragraph in paragraphs
                if len(paragraph.split()) >= 8 and not any(marker in paragraph.lower() for marker in GARBAGE_MARKERS)
            ]
            article_body = "\n".join(paragraphs[:6])

        content_parts = [part for part in [title, description, article_body] if part]
        recovered_content = "\n".join(content_parts).strip()
        if not recovered_content:
            return "", {}

        structured: Dict[str, Any] = {}
        if title:
            structured["event"] = title
        if description:
            structured["what_changed"] = description
        if date_published:
            structured["date_time"] = date_published
        return recovered_content, structured

    def _parse_jsonp_payload(self, text: str) -> Optional[Any]:
        raw = str(text or "").strip()
        if not raw:
            return None
        match = re.search(r"^[^(]+\((.*)\)\s*;?\s*$", raw, re.DOTALL)
        payload = match.group(1) if match else raw
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return None

    def _extract_iplt20_season_year(self, title: str, raw_html: str) -> Optional[str]:
        haystack = f"{title}\n{raw_html[:5000]}"
        match = re.search(r"\bIPL\s+(20\d{2})\b", haystack, re.IGNORECASE)
        if match:
            return match.group(1)
        return None

    async def _recover_iplt20_standings_feed(
        self,
        url: str,
        title: str,
        raw_html: str,
    ) -> Tuple[str, Dict[str, Any], str]:
        lowered_url = str(url or "").lower()
        if "iplt20.com" not in lowered_url or "points-table" not in lowered_url:
            return "", {}, ""

        season_year = self._extract_iplt20_season_year(title, raw_html)
        if not season_year:
            return "", {}, ""

        competition_feed_url = "https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js"
        competition_result = await self.fetch_tool.execute({"url": competition_feed_url, "extract_text": False})
        if competition_result.error or not isinstance(competition_result.output, dict):
            return "", {}, ""

        competition_payload = self._parse_jsonp_payload(str(competition_result.output.get("content") or ""))
        if not isinstance(competition_payload, dict):
            return "", {}, ""

        competitions = competition_payload.get("competition") or []
        selected_competition: Optional[Dict[str, Any]] = None
        for competition in competitions:
            if not isinstance(competition, dict):
                continue
            if str(competition.get("CompetitionName") or "").strip().lower() == f"ipl {season_year}".lower():
                selected_competition = competition
                break
        if not selected_competition:
            return "", {}, ""

        stats_feed = str(selected_competition.get("statsFeed") or selected_competition.get("feedsource") or "").strip()
        stats_coding = str(selected_competition.get("statsCoding") or "").strip()
        stats_cid = str(selected_competition.get("statsCID") or selected_competition.get("CompetitionID") or "").strip()
        if not stats_feed or not stats_cid:
            return "", {}, ""

        if stats_coding == "T20Lite":
            standings_feed_url = f"{stats_feed}/stats/{stats_cid}-groupstandings.js"
        else:
            standings_feed_url = f"{stats_feed}/stats/{stats_cid}/groupstandings.js"

        standings_result = await self.fetch_tool.execute({"url": standings_feed_url, "extract_text": False})
        if standings_result.error or not isinstance(standings_result.output, dict):
            return "", {}, ""

        standings_payload = self._parse_jsonp_payload(str(standings_result.output.get("content") or ""))
        if not isinstance(standings_payload, dict):
            return "", {}, ""

        points_rows = standings_payload.get("points") or []
        selected_row: Optional[Dict[str, Any]] = None
        for row in points_rows:
            if not isinstance(row, dict):
                continue
            team_name = str(row.get("TeamName") or "").strip().lower()
            team_code = str(row.get("TeamCode") or "").strip().lower()
            if team_name == "chennai super kings" or team_code == "csk":
                selected_row = row
                break
        if not selected_row:
            return "", {}, standings_feed_url

        ranking_movement: List[str] = []
        status = str(selected_row.get("Status") or "").strip().lower()
        if status and status not in {"same", "0"}:
            ranking_movement.append(status)
        prev_position = str(selected_row.get("PrevPosition") or "").strip()
        current_position = str(selected_row.get("OrderNo") or "").strip()
        if prev_position and current_position and prev_position != current_position:
            ranking_movement.append(f"previously {prev_position}")
        performance = str(selected_row.get("Performance") or "").strip()
        if performance:
            ranking_movement.append(f"recent form {performance}")

        structured_data: Dict[str, Any] = {
            "team": str(selected_row.get("TeamName") or "").strip(),
            "position": current_position,
            "points": str(selected_row.get("Points") or "").strip(),
            "nrr": str(selected_row.get("NetRunRate") or "").strip(),
        }
        if ranking_movement:
            structured_data["ranking_movement"] = ranking_movement[:4]

        summary_parts = [
            f"{structured_data['team']} are {structured_data['position']} in the IPL {season_year} points table.",
            f"They have {structured_data['points']} points.",
            f"NRR is {structured_data['nrr']}.",
        ]
        if ranking_movement:
            summary_parts.append("Signals: " + ", ".join(ranking_movement[:4]) + ".")

        return " ".join(summary_parts), structured_data, standings_feed_url

    def _extract_structured_data(
        self,
        task_type: str,
        page_kind: str,
        content: str,
        title: str = "",
        expected_fields: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        lowered_task = (task_type or "").lower()
        if lowered_task == "factual_extract" and page_kind == "standings/table":
            return self._extract_standings_data(content)
        if page_kind == "standings/table":
            return self._extract_standings_data(content)
        if page_kind == "news/article":
            data = self._extract_news_data(content)
            if self._is_election_result_task(task_type, expected_fields):
                data.update(self._extract_election_result_data(content, title))
            release_event = self._extract_release_event_from_title(title, page_kind)
            if release_event and not data.get("event"):
                data["event"] = release_event
            return data
        if page_kind == "docs/changelog":
            updates = self._extract_update_items(content)
            if updates.get("update_items"):
                updates["record_count"] = len(updates.get("update_items") or [])
            return updates
        return {}

    def _extract_page_items(self, content: str, limit: int = 6) -> List[str]:
        text = str(content or "")
        if not text:
            return []
        candidates: List[str] = []
        for raw_line in re.split(r"[\n\r]+|(?<=[.!?])\s+", text):
            line = self._normalize_text(raw_line)
            word_count = len(line.split())
            if word_count < 2:
                continue
            lowered = line.lower()
            if any(marker in lowered for marker in GARBAGE_MARKERS):
                continue
            if any(marker in lowered for marker in ["cookie policy", "privacy policy", "terms of service", "sign in", "subscribe"]):
                continue
            headline_like = bool(re.match(r"^[A-Z0-9][A-Za-z0-9'\"().,:;!?/& -]+$", line)) and word_count <= 14
            if word_count < 4 and not headline_like:
                continue
            candidates.append(line)
            if len(candidates) >= limit:
                break
        return candidates

    def _is_generic_section_label(self, text: str) -> bool:
        normalized = self._normalize_text(text).strip(":- ").lower()
        if not normalized:
            return True
        return normalized in GENERIC_SECTION_LABELS

    def _extract_page_items_from_raw_html(self, raw_html: str, limit: int = 8) -> List[str]:
        html = str(raw_html or "")
        if not html:
            return []
        candidates: List[str] = []
        seen = set()
        for match in re.finditer(r"<a\b[^>]*>(.*?)</a>", html, flags=re.IGNORECASE | re.DOTALL):
            line = self._normalize_text(re.sub(r"<[^>]+>", " ", unescape(match.group(1))))
            if not line:
                continue
            lowered = line.lower()
            word_count = len(line.split())
            if word_count < 3 or word_count > 22:
                continue
            if any(marker in lowered for marker in GARBAGE_MARKERS):
                continue
            if any(marker == lowered or f" {marker} " in f" {lowered} " for marker in HOMEPAGE_NAV_MARKERS):
                continue
            if self._is_generic_section_label(line):
                continue
            if not (
                word_count >= 5
                or any(token in line for token in [":", "'", "?", "!", "-", "—"])
                or bool(re.search(r"\d", line))
            ):
                continue
            key = lowered
            if key in seen:
                continue
            seen.add(key)
            candidates.append(line)
            if len(candidates) >= limit:
                break
        return candidates

    def _extract_page_sections_from_raw_html(self, raw_html: str, limit: int = 6) -> List[str]:
        html = str(raw_html or "")
        if not html:
            return []
        sections: List[str] = []
        seen = set()
        for match in re.finditer(r"<a\b[^>]*>(.*?)</a>", html, flags=re.IGNORECASE | re.DOTALL):
            line = self._normalize_text(re.sub(r"<[^>]+>", " ", unescape(match.group(1))))
            if not line:
                continue
            lowered = line.lower()
            word_count = len(line.split())
            if word_count < 1 or word_count > 4:
                continue
            if any(marker in lowered for marker in GARBAGE_MARKERS):
                continue
            if any(marker == lowered or f" {marker} " in f" {lowered} " for marker in ["sign in", "weather", "edition"]):
                continue
            if not re.match(r"^[A-Za-z][A-Za-z&/ .'-]{1,40}$", line):
                continue
            if not self._is_generic_section_label(line):
                continue
            key = lowered
            if key in seen:
                continue
            seen.add(key)
            sections.append(line.title() if line.islower() else line)
            if len(sections) >= limit:
                break
        return sections

    def _augment_homepage_structured_data(self, content: str, raw_source_text: str, structured_data: Dict[str, Any]) -> Dict[str, Any]:
        existing = structured_data if isinstance(structured_data, dict) else {}
        page_items = existing.get("page_items") if isinstance(existing.get("page_items"), list) else []
        headlines = existing.get("headlines") if isinstance(existing.get("headlines"), list) else []
        sections = existing.get("sections") if isinstance(existing.get("sections"), list) else []

        extracted_items = self._extract_page_items_from_raw_html(raw_source_text) or self._extract_page_items(content)
        extracted_sections = self._extract_page_sections_from_raw_html(raw_source_text) or self._extract_page_sections(content)

        def dedupe(values: List[str], limit: int) -> List[str]:
            seen = set()
            kept: List[str] = []
            for value in values:
                line = self._normalize_text(value)
                if not line:
                    continue
                key = line.lower()
                if key in seen:
                    continue
                seen.add(key)
                kept.append(line)
                if len(kept) >= limit:
                    break
            return kept

        merged_items = dedupe(page_items + headlines + extracted_items, 8)
        merged_sections = dedupe(sections + extracted_sections, 6)
        return {
            **existing,
            "page_items": merged_items,
            "headlines": merged_items[:6],
            "sections": merged_sections,
        }

    def _extract_page_sections(self, content: str, limit: int = 5) -> List[str]:
        sections: List[str] = []
        seen = set()
        for raw_line in re.split(r"[\n\r]+", str(content or "")):
            line = self._normalize_text(raw_line)
            if not line or len(line) > 48:
                continue
            lowered = line.lower()
            if any(marker in lowered for marker in GARBAGE_MARKERS):
                continue
            if any(marker in lowered for marker in ["subscribe", "sign in", "cookie", "privacy", "advertisement"]):
                continue
            if line.endswith(":"):
                line = line[:-1].strip()
            if len(line.split()) > 5:
                continue
            if not re.match(r"^[A-Z][A-Za-z0-9&/ .'-]{1,47}$", line):
                continue
            key = line.lower()
            if key in seen:
                continue
            seen.add(key)
            sections.append(line)
            if len(sections) >= limit:
                break
        return sections

    def _page_shape_signals(self, content: str, structured_data: Dict[str, Any], raw_source_text: str) -> Dict[str, Any]:
        word_count = len(str(content or "").split())
        link_count = len(re.findall(r"<a\b", str(raw_source_text or ""), flags=re.IGNORECASE))
        table_count = len(re.findall(r"<table\b", str(raw_source_text or ""), flags=re.IGNORECASE))
        row_count = len(re.findall(r"<tr\b", str(raw_source_text or ""), flags=re.IGNORECASE))
        link_density = round(link_count / max(word_count, 1), 4)
        page_items = structured_data.get("page_items") if isinstance(structured_data.get("page_items"), list) else []
        headlines = structured_data.get("headlines") if isinstance(structured_data.get("headlines"), list) else []
        update_items = structured_data.get("update_items") if isinstance(structured_data.get("update_items"), list) else []
        approximate_item_count = max(len(page_items), len(headlines), len(update_items))

        structured_record_count = 0
        for value in structured_data.values():
            if not value:
                continue
            if isinstance(value, list):
                structured_record_count += len([item for item in value if item])
            elif isinstance(value, dict):
                structured_record_count += len([item for item in value.values() if item])
            else:
                structured_record_count += 1

        return {
            "linkDensity": link_density,
            "approximateItemCount": approximate_item_count,
            "tableRowCount": row_count or table_count,
            "structuredRecordCount": structured_record_count,
        }

    def _classify_page_type(
        self,
        *,
        url: str,
        page_kind: str,
        content: str,
        structured_data: Dict[str, Any],
        raw_source_text: str,
        quality: str,
        paywall_signal: bool,
        js_render_suspected: bool,
    ) -> str:
        parsed = urlparse(url or "")
        path = (parsed.path or "").strip()
        lowered_content = str(content or "").lower()
        word_count = len(str(content or "").split())
        link_count = len(re.findall(r"<a\b", str(raw_source_text or ""), flags=re.IGNORECASE))
        table_count = len(re.findall(r"<table\b", str(raw_source_text or ""), flags=re.IGNORECASE))
        link_density = link_count / max(word_count, 1)

        if paywall_signal:
            return "blocked"
        if js_render_suspected and word_count < 120:
            return "sparse"
        if quality == "extract_garbage" and word_count < 80:
            return "sparse"
        if page_kind == "standings/table" or table_count >= 1 or any(key in structured_data for key in ["position", "points", "nrr", "ranking_movement"]):
            return "data_table"
        if page_kind == "news/article" and any(key in structured_data for key in ["event", "what_changed", "date_time"]):
            return "article"
        if parsed.hostname and path in {"", "/"} and word_count >= 40:
            return "homepage"
        if link_density > 0.08 and word_count < 2200:
            return "news_index" if path not in {"", "/"} else "homepage"
        if page_kind == "news/article" and word_count >= 120:
            return "article"
        if page_kind == "docs/changelog" and word_count >= 100:
            return "article"
        if word_count < 80:
            return "sparse"
        if any(marker in lowered_content for marker in ["headline", "top stories", "latest news", "breaking news"]):
            return "news_index" if path not in {"", "/"} else "homepage"
        return "general"

    def _present_fields(self, structured_data: Dict[str, Any], content: str, expected_fields: List[str]) -> List[str]:
        present: List[str] = []
        lowered = content.lower()
        for field in expected_fields:
            if field in structured_data and structured_data[field]:
                present.append(field)
                continue
            if field == "team" and any(alias in lowered for aliases in TEAM_ALIASES.values() for alias in aliases):
                present.append(field)
            elif field == "nrr" and ("nrr" in lowered or "net run rate" in lowered):
                present.append(field)
            elif field == "ranking_movement" and any(marker in lowered for marker in ["top four", "playoff", "qualify", "race"]):
                present.append(field)
            elif field == "what_changed" and any(marker in lowered for marker in ["introduced", "released", "expanded", "supports", "demonstrated", "transition"]):
                present.append(field)
            elif field == "date_time" and re.search(r"\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b", lowered):
                present.append(field)
            elif field == "winner" and any(marker in lowered for marker in [" won ", " wins ", " victory ", " clinches ", " landslide "]):
                present.append(field)
            elif field == "party" and any(
                re.search(rf"\b{re.escape(alias)}\b", lowered)
                for aliases in PARTY_ALIASES.values()
                for alias in aliases
            ):
                present.append(field)
            elif field == "seat_tally" and re.search(r"\b\d{1,3}\s+seats?\b", lowered):
                present.append(field)
        return sorted(set(present))

    def _looks_like_garbage(self, content: str) -> bool:
        lowered = content.lower()
        if not lowered or len(lowered.split()) < 40:
            return True
        if any(marker in lowered for marker in GARBAGE_MARKERS):
            return True
        if lowered.count("|") >= 8:
            return True
        return False

    def _detect_paywall_signal(self, text: str, raw_html: str = "") -> bool:
        visible = str(text or "").lower()
        if any(marker in visible for marker in PAYWALL_MARKERS):
            return True
        raw_prefix = str(raw_html or "")[:5000].lower()
        return any(marker in raw_prefix for marker in PAYWALL_MARKERS)

    def _detect_js_render_suspected(self, raw_text: str, cleaned_content: str) -> bool:
        raw = str(raw_text or "")
        lowered_raw = raw.lower()
        cleaned = str(cleaned_content or "")
        script_count = len(re.findall(r"<script\b", raw, flags=re.IGNORECASE))
        paragraph_count = len(re.findall(r"<p\b", raw, flags=re.IGNORECASE))
        shell_marker = any(marker in lowered_raw for marker in JS_SHELL_MARKERS)
        very_thin_visible_text = len(cleaned.split()) < 80
        script_heavy = script_count >= 8 and paragraph_count <= 2
        return bool(shell_marker and very_thin_visible_text) or bool(script_heavy and very_thin_visible_text)

    def _extraction_quality_metadata(
        self,
        *,
        url: str,
        task_type: str,
        source_mode: str,
        page_kind: str,
        content: str,
        structured_data: Dict[str, Any],
        expected_fields: List[str],
        quality: str,
        extraction_method: str,
        raw_source_text: str = "",
        js_fallback_detected: bool = False,
        js_fallback_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        word_count = len(str(content or "").split())
        field_hits = 0
        if expected_fields:
            field_hits = len(self._present_fields(structured_data, content, expected_fields))
        metadata_only = extraction_method == "web_fetch_raw_html_article" and word_count < 180 and field_hits <= 2
        paywall_signal = self._detect_paywall_signal(content, raw_source_text)
        js_render_suspected = js_fallback_detected or self._detect_js_render_suspected(raw_source_text, content)
        shape_signals = self._page_shape_signals(content, structured_data, raw_source_text)

        if not content or quality == "extract_garbage":
            tier = "failed"
        elif paywall_signal and word_count < 120:
            tier = "failed"
        elif metadata_only:
            tier = "thin"
        elif quality == "extract_partial":
            tier = "thin" if word_count < 90 and field_hits <= 1 else "partial"
        elif quality == "extract_clean":
            if word_count >= 220 or field_hits >= max(2, len(expected_fields) // 2):
                tier = "clean"
            elif word_count >= 80 or field_hits >= 1:
                tier = "partial"
            else:
                tier = "thin"
        else:
            tier = "partial"

        page_type = self._classify_page_type(
            url=url,
            page_kind=page_kind,
            content=content,
            structured_data=structured_data,
            raw_source_text=raw_source_text,
            quality=quality,
            paywall_signal=paywall_signal,
            js_render_suspected=js_render_suspected,
        )
        homepage_nav_hits = sum(1 for marker in HOMEPAGE_NAV_MARKERS if marker in str(content or "").lower())
        homepage_sparse_structure = (
            page_type in {"homepage", "news_index"}
            and shape_signals.get("approximateItemCount", 0) < 2
            and shape_signals.get("structuredRecordCount", 0) < 2
        )
        embedded_markup_signal = bool(re.search(r"<[a-z][^>]*>", str(raw_source_text or content), flags=re.IGNORECASE))
        if homepage_sparse_structure:
            if tier == "clean":
                tier = "thin" if homepage_nav_hits >= 6 else "partial"
            elif tier == "partial" and homepage_nav_hits >= 8:
                tier = "thin"

        base_confidence = {
            "clean": 0.9,
            "partial": 0.7,
            "thin": 0.4,
            "failed": 0.05,
        }[tier]
        confidence = base_confidence
        confidence += min(word_count / 1200, 0.12)
        confidence += min(field_hits * 0.04, 0.16)
        if metadata_only:
            confidence -= 0.18
        if paywall_signal:
            confidence -= 0.3
        if js_render_suspected:
            confidence -= 0.12
        if homepage_sparse_structure:
            confidence -= 0.28
        if homepage_nav_hits >= 8:
            confidence -= 0.16
        if embedded_markup_signal and page_type in {"homepage", "news_index"}:
            confidence -= 0.08
        if js_fallback_detected:
            confidence = min(confidence, 0.7)
        confidence = max(0.0, min(1.0, round(confidence, 3)))

        return {
            "tier": tier,
            "confidence": confidence,
            "extractionMethod": extraction_method,
            "wordCount": word_count,
            "paywallSignal": paywall_signal,
            "jsRenderSuspected": js_render_suspected,
            "jsFallbackDetected": js_fallback_detected,
            "jsFallbackReason": js_fallback_reason,
            "pageType": page_type,
            "taskType": str(task_type or "ambiguous").strip().lower() or "ambiguous",
            "sourceMode": str(source_mode or "system_chosen").strip().lower() or "system_chosen",
            **shape_signals,
        }

    def _quality_and_missing_fields(
        self,
        content: str,
        structured_data: Dict[str, Any],
        expected_fields: List[str],
        page_kind: str,
        allow_interaction: bool,
    ) -> Tuple[str, List[str], bool]:
        present = self._present_fields(structured_data, content, expected_fields)
        missing = [field for field in expected_fields if field not in present]
        if expected_fields and len(present) >= max(2, len(expected_fields) // 2):
            if not missing:
                return "extract_clean", [], False
            return "extract_partial", missing, False
        if self._looks_like_garbage(content):
            interaction_required = allow_interaction and page_kind == "interactive/authenticated"
            return "extract_garbage", expected_fields, interaction_required
        if not expected_fields:
            return "extract_clean", [], False
        if not missing:
            return "extract_clean", [], False
        if len(present) >= max(1, len(expected_fields) // 2):
            return "extract_partial", missing, False
        interaction_required = allow_interaction and page_kind == "interactive/authenticated"
        return "extract_garbage", missing, interaction_required

    def _promote_js_fallback_article_quality(
        self,
        *,
        page_kind: str,
        task_type: str,
        content: str,
        structured_data: Dict[str, Any],
        quality: str,
        missing_fields: List[str],
    ) -> Tuple[str, List[str]]:
        if quality != "extract_garbage" or page_kind != "news/article" or str(task_type or "").lower() != "page_read":
            return quality, missing_fields
        if not structured_data.get("event"):
            return quality, missing_fields
        if len(str(content or "").split()) < 8:
            return quality, missing_fields
        return "extract_partial", [field for field in missing_fields if field != "event"]

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start_time = time.monotonic()
        url = str(input.get("url") or "").strip()
        task_type = str(input.get("taskType") or "").strip()
        source_mode = str(input.get("sourceMode") or "system_chosen").strip()
        expected_fields = [str(item).strip() for item in (input.get("expectedFields") or []) if str(item).strip()]
        allow_interaction = bool(input.get("allowInteraction", False))
        page_kind_hint = str(input.get("pageKind") or "").strip()
        backend_order = [str(item).strip().lower() for item in (input.get("backendOrder") or []) if str(item).strip()]
        allow_internal_browser_escalation = bool(input.get("allowInternalBrowserEscalation", True))
        max_duration_ms = int(input.get("maxDurationMs") or 0)

        def duration_exhausted() -> bool:
            return bool(max_duration_ms and ((time.monotonic() - start_time) * 1000) >= max_duration_ms)

        if not url:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="URL cannot be empty",
                duration_ms=0,
                sandboxed=False,
            )

        page_kind = self._page_kind(url, task_type, allow_interaction, page_kind_hint=page_kind_hint)
        expected_fields = self._default_expected_fields(task_type, expected_fields)
        backend_attempts: List[Dict[str, Any]] = []
        backend_used = "none"
        best_title = ""
        best_content = ""
        best_url = url
        structured_data: Dict[str, Any] = {}
        quality = "extract_garbage"
        missing_fields = list(expected_fields)
        interaction_required = False
        best_js_fallback_detected = False
        best_js_fallback_reason: Optional[str] = None
        last_empty_success_context: Optional[Dict[str, Any]] = None
        extraction_metadata: Dict[str, Any] = self._extraction_quality_metadata(
            url=url,
            task_type=task_type,
            source_mode=source_mode,
            page_kind=page_kind,
            content="",
            structured_data={},
            expected_fields=expected_fields,
            quality="extract_garbage",
            extraction_method="none",
            raw_source_text="",
        )

        def browser_escalation_suppressed(metadata: Dict[str, Any], quality_value: str) -> bool:
            if allow_internal_browser_escalation:
                return False
            # Diagnostic only. Must not influence evidence classification,
            # fallback decisions, or result rendering.
            return has_weak_signal({**(metadata or {}), "quality": quality_value})

        candidates = self._discover_backend_tools(page_kind, allow_interaction, backend_order=backend_order)
        if not candidates:
            candidates = [(self.fetch_tool, "web_fetch")]

        for tool, backend_type in candidates[:5]:
            if duration_exhausted():
                backend_attempts.append({
                    "backend": backend_type,
                    "tool": tool.name,
                    "status": "skipped",
                    "reason": "maxDurationMs exhausted",
                })
                break
            tool_input = self._generic_tool_input(tool, url, task_type, expected_fields, allow_interaction)
            if not tool_input:
                backend_attempts.append({
                    "backend": backend_type,
                    "tool": tool.name,
                    "status": "skipped",
                    "reason": "Could not infer supported input shape",
                })
                continue

            attempt_start = time.monotonic()
            try:
                if backend_used == "none":
                    backend_used = backend_type
                result = await tool.execute(tool_input)
            except Exception as exc:
                backend_attempts.append({
                    "backend": backend_type,
                    "tool": tool.name,
                    "status": "error",
                    "error": str(exc)[:240],
                    "elapsed_ms": round((time.monotonic() - attempt_start) * 1000, 2),
                })
                continue

            if result.error:
                flattened_attempts = self._flatten_fetch_backend_attempts(backend_type, tool.name, result)
                if flattened_attempts:
                    backend_attempts.extend(flattened_attempts)
                else:
                    backend_attempts.append({
                        "backend": backend_type,
                        "tool": tool.name,
                        "status": "error",
                        "error": str(result.error)[:240],
                        **self._fetch_failure_metadata(result),
                        "elapsed_ms": round((time.monotonic() - attempt_start) * 1000, 2),
                    })
                continue

            title, raw_content, candidate_url, candidate_structured = self._extract_content_like_output(result)
            js_fallback_detected, js_fallback_reason = self._resolve_js_fallback_metadata(result, raw_content)
            if js_fallback_detected:
                raw_content = self._clean_js_fallback_content(raw_content, title, js_fallback_reason)
            cleaned_content = self._reader_style_cleanup(raw_content, page_kind)
            output_payload = result.output if isinstance(result.output, dict) else {}
            derived_structured = self._extract_structured_data(
                task_type,
                page_kind,
                cleaned_content,
                title,
                expected_fields,
            )
            extracted_structured = {
                **derived_structured,
                **(candidate_structured or {}),
            }
            candidate_quality, candidate_missing_fields, candidate_interaction_required = self._quality_and_missing_fields(
                cleaned_content,
                extracted_structured,
                expected_fields,
                page_kind,
                allow_interaction,
            )
            if js_fallback_detected and candidate_quality == "extract_clean":
                candidate_quality = "extract_partial"
            if page_kind == "news/article":
                release_event = self._extract_release_event_from_title(title, page_kind)
                if release_event and not extracted_structured.get("event"):
                    extracted_structured["event"] = release_event
                    candidate_quality, candidate_missing_fields, candidate_interaction_required = self._quality_and_missing_fields(
                        cleaned_content,
                        extracted_structured,
                        expected_fields,
                        page_kind,
                        allow_interaction,
                    )
                    if js_fallback_detected and candidate_quality == "extract_clean":
                        candidate_quality = "extract_partial"
            if js_fallback_detected:
                candidate_quality, candidate_missing_fields = self._promote_js_fallback_article_quality(
                    page_kind=page_kind,
                    task_type=task_type,
                    content=cleaned_content,
                    structured_data=extracted_structured,
                    quality=candidate_quality,
                    missing_fields=candidate_missing_fields,
                )
            if js_fallback_detected and candidate_missing_fields and cleaned_content:
                cleaned_content = f"{JS_FALLBACK_NOTE} {cleaned_content}".strip()

            flattened_attempts = self._flatten_fetch_backend_attempts(backend_type, tool.name, result)
            if flattened_attempts:
                backend_attempts.extend(flattened_attempts)
            else:
                backend_attempts.append({
                    "backend": backend_type,
                    "tool": tool.name,
                    "status": "ok" if cleaned_content else "empty",
                    "quality": candidate_quality,
                    "elapsed_ms": round((time.monotonic() - attempt_start) * 1000, 2),
                })

            if not cleaned_content and output_payload.get("httpStatus") is not None:
                last_empty_success_context = {
                    "title": title,
                    "url": candidate_url or str(output_payload.get("redirectedUrl") or output_payload.get("url") or url),
                    "httpStatus": output_payload.get("httpStatus"),
                    "redirectedUrl": output_payload.get("redirectedUrl"),
                    "transportStrategy": str(output_payload.get("transportStrategy") or backend_type or "none"),
                    "backendUsed": backend_type,
                    "jsFallbackDetected": bool(output_payload.get("jsFallbackDetected") or js_fallback_detected),
                    "jsFallbackReason": output_payload.get("jsFallbackReason") or js_fallback_reason,
                }

            if cleaned_content:
                best_title = title or best_title
                best_content = cleaned_content
                best_url = candidate_url or best_url
                structured_data = extracted_structured
                quality = candidate_quality
                missing_fields = candidate_missing_fields
                interaction_required = candidate_interaction_required
                backend_used = backend_type
                best_js_fallback_detected = js_fallback_detected
                best_js_fallback_reason = js_fallback_reason
                if page_kind in {"general", "news/article"}:
                    extracted_structured = self._augment_homepage_structured_data(cleaned_content, raw_content, extracted_structured)
                    structured_data = extracted_structured
                extraction_metadata = self._extraction_quality_metadata(
                    url=candidate_url or url,
                    task_type=task_type,
                    source_mode=source_mode,
                    page_kind=page_kind,
                    content=cleaned_content,
                    structured_data=extracted_structured,
                    expected_fields=expected_fields,
                    quality=candidate_quality,
                    extraction_method=backend_type,
                    raw_source_text=raw_content,
                    js_fallback_detected=js_fallback_detected,
                    js_fallback_reason=js_fallback_reason,
                )
                if candidate_quality in {"extract_clean", "extract_partial"}:
                    break

        if page_kind == "standings/table" and (not best_content or quality == "extract_garbage"):
            raw_fetch_result = await self.fetch_tool.execute({"url": url, "extract_text": False})
            if not raw_fetch_result.error and isinstance(raw_fetch_result.output, dict):
                raw_title = str(raw_fetch_result.output.get("title") or "").strip()
                raw_url = str(raw_fetch_result.output.get("url") or url).strip()
                raw_html = str(raw_fetch_result.output.get("content") or "")
                recovered_content, recovered_structured = self._recover_standings_from_raw_html(raw_html)
                recovered_quality, recovered_missing_fields, recovered_interaction_required = self._quality_and_missing_fields(
                    recovered_content,
                    recovered_structured,
                    expected_fields,
                    page_kind,
                    allow_interaction,
                )
                backend_attempts.append({
                    "backend": "web_fetch_raw_html",
                    "tool": "web_fetch",
                    "status": "ok" if recovered_content else "empty",
                    "quality": recovered_quality,
                })
                if recovered_content and recovered_quality in {"extract_clean", "extract_partial"}:
                    if page_kind in {"general", "news/article"}:
                        recovered_structured = self._augment_homepage_structured_data(recovered_content, raw_html, recovered_structured)
                    recovered_metadata = self._extraction_quality_metadata(
                        url=raw_url,
                        task_type=task_type,
                        source_mode=source_mode,
                        page_kind=page_kind,
                        content=recovered_content,
                        structured_data=recovered_structured,
                        expected_fields=expected_fields,
                        quality=recovered_quality,
                        extraction_method="web_fetch_raw_html",
                        raw_source_text=raw_html,
                    )
                    duration_ms = round((time.monotonic() - start_time) * 1000, 2)
                    return ToolResult(
                        tool_name=self.name,
                        input=input,
                        output={
                            "kind": "content",
                            "url": raw_url,
                            "title": raw_title,
                            "content": recovered_content,
                            "structuredData": recovered_structured,
                            "backendUsed": "web_fetch_raw_html",
                            "backendAttempts": backend_attempts,
                            "quality": recovered_quality,
                            "missingFields": recovered_missing_fields,
                            "interactionRequired": recovered_interaction_required,
                            "pageKind": page_kind,
                            **recovered_metadata,
                        },
                        duration_ms=duration_ms,
                        sandboxed=False,
                        source_url=raw_url,
                        provenance_hint={
                            "backendUsed": "web_fetch_raw_html",
                            "backendAttempts": backend_attempts,
                            "missingFields": recovered_missing_fields,
                            "pageKind": page_kind,
                            "quality": recovered_quality,
                            "interactionRequired": recovered_interaction_required,
                            **recovered_metadata,
                        },
                    )
                official_content, official_structured, official_feed_url = await self._recover_iplt20_standings_feed(
                    raw_url,
                    raw_title,
                    raw_html,
                )
                official_quality, official_missing_fields, official_interaction_required = self._quality_and_missing_fields(
                    official_content,
                    official_structured,
                    expected_fields,
                    page_kind,
                    allow_interaction,
                )
                backend_attempts.append({
                    "backend": "iplt20_official_feed",
                    "tool": "web_fetch",
                    "status": "ok" if official_content else "empty",
                    "quality": official_quality,
                    "source": official_feed_url,
                })
                if official_content and official_quality in {"extract_clean", "extract_partial"}:
                    official_metadata = self._extraction_quality_metadata(
                        url=raw_url,
                        task_type=task_type,
                        source_mode=source_mode,
                        page_kind=page_kind,
                        content=official_content,
                        structured_data=official_structured,
                        expected_fields=expected_fields,
                        quality=official_quality,
                        extraction_method="iplt20_official_feed",
                        raw_source_text=raw_html,
                    )
                    duration_ms = round((time.monotonic() - start_time) * 1000, 2)
                    return ToolResult(
                        tool_name=self.name,
                        input=input,
                        output={
                            "kind": "content",
                            "url": raw_url,
                            "title": raw_title,
                            "content": official_content,
                            "structuredData": official_structured,
                            "backendUsed": "iplt20_official_feed",
                            "backendAttempts": backend_attempts,
                            "quality": official_quality,
                            "missingFields": official_missing_fields,
                            "interactionRequired": official_interaction_required,
                            "pageKind": page_kind,
                            **official_metadata,
                        },
                        duration_ms=duration_ms,
                        sandboxed=False,
                        source_url=official_feed_url or raw_url,
                        provenance_hint={
                            "backendUsed": "iplt20_official_feed",
                            "backendAttempts": backend_attempts,
                            "missingFields": official_missing_fields,
                            "pageKind": page_kind,
                            "quality": official_quality,
                            "interactionRequired": official_interaction_required,
                            **official_metadata,
                        },
                    )

        if page_kind in {"news/article", "general"} and (not best_content or quality == "extract_garbage"):
            raw_fetch_result = await self.fetch_tool.execute({"url": url, "extract_text": False})
            if not raw_fetch_result.error and isinstance(raw_fetch_result.output, dict):
                raw_title = str(raw_fetch_result.output.get("title") or "").strip()
                raw_url = str(raw_fetch_result.output.get("url") or url).strip()
                raw_html = str(raw_fetch_result.output.get("content") or "")
                recovered_content, recovered_structured = self._recover_article_from_raw_html(raw_html)
                recovered_structured = {
                    **self._extract_structured_data(
                        task_type,
                        page_kind,
                        recovered_content,
                        raw_title,
                        expected_fields,
                    ),
                    **recovered_structured,
                }
                js_fallback_detected, js_fallback_reason = self._resolve_js_fallback_metadata(raw_fetch_result, raw_html or recovered_content)
                if js_fallback_detected:
                    recovered_content = self._clean_js_fallback_content(recovered_content, raw_title, js_fallback_reason)
                recovered_quality, recovered_missing_fields, recovered_interaction_required = self._quality_and_missing_fields(
                    recovered_content,
                    recovered_structured,
                    expected_fields,
                    page_kind,
                    allow_interaction,
                )
                if page_kind == "news/article":
                    release_event = self._extract_release_event_from_title(raw_title, page_kind)
                    if release_event and not recovered_structured.get("event"):
                        recovered_structured["event"] = release_event
                        recovered_quality, recovered_missing_fields, recovered_interaction_required = self._quality_and_missing_fields(
                            recovered_content,
                            recovered_structured,
                            expected_fields,
                            page_kind,
                            allow_interaction,
                        )
                if js_fallback_detected:
                    recovered_quality, recovered_missing_fields = self._promote_js_fallback_article_quality(
                        page_kind=page_kind,
                        task_type=task_type,
                        content=recovered_content,
                        structured_data=recovered_structured,
                        quality=recovered_quality,
                        missing_fields=recovered_missing_fields,
                    )
                if js_fallback_detected and recovered_quality == "extract_clean":
                    recovered_quality = "extract_partial"
                if js_fallback_detected and recovered_missing_fields and recovered_content:
                    recovered_content = f"{JS_FALLBACK_NOTE} {recovered_content}".strip()
                backend_attempts.append({
                    "backend": "web_fetch_raw_html_article",
                    "tool": "web_fetch",
                    "status": "ok" if recovered_content else "empty",
                    "quality": recovered_quality,
                })
                if recovered_content and recovered_quality in {"extract_clean", "extract_partial"}:
                    recovered_metadata = self._extraction_quality_metadata(
                        url=raw_url,
                        task_type=task_type,
                        source_mode=source_mode,
                        page_kind=page_kind,
                        content=recovered_content,
                        structured_data=recovered_structured,
                        expected_fields=expected_fields,
                        quality=recovered_quality,
                        extraction_method="web_fetch_raw_html_article",
                        raw_source_text=raw_html,
                        js_fallback_detected=js_fallback_detected,
                        js_fallback_reason=js_fallback_reason,
                    )
                    duration_ms = round((time.monotonic() - start_time) * 1000, 2)
                    return ToolResult(
                        tool_name=self.name,
                        input=input,
                        output={
                            "kind": "content",
                            "url": raw_url,
                            "title": raw_title,
                            "content": recovered_content,
                            "structuredData": recovered_structured,
                            "backendUsed": "web_fetch_raw_html_article",
                            "backendAttempts": backend_attempts,
                            "quality": recovered_quality,
                            "missingFields": recovered_missing_fields,
                            "interactionRequired": recovered_interaction_required,
                            "pageKind": page_kind,
                            **recovered_metadata,
                        },
                        duration_ms=duration_ms,
                        sandboxed=False,
                        source_url=raw_url,
                        provenance_hint={
                            "backendUsed": "web_fetch_raw_html_article",
                            "backendAttempts": backend_attempts,
                            "missingFields": recovered_missing_fields,
                            "pageKind": page_kind,
                            "quality": recovered_quality,
                            "interactionRequired": recovered_interaction_required,
                            **recovered_metadata,
                        },
                    )

        if not best_content:
            if (
                last_empty_success_context
                and last_empty_success_context.get("httpStatus") is not None
            ):
                empty_content = EMPTY_BODY_JS_NOTE
                empty_metadata = self._extraction_quality_metadata(
                    url=str(last_empty_success_context.get("url") or url),
                    task_type=task_type,
                    source_mode=source_mode,
                    page_kind=page_kind,
                    content=empty_content,
                    structured_data={},
                    expected_fields=expected_fields,
                    quality="extract_garbage",
                    extraction_method=str(last_empty_success_context.get("backendUsed") or "none"),
                    raw_source_text="",
                    js_fallback_detected=bool(last_empty_success_context.get("jsFallbackDetected")),
                    js_fallback_reason=last_empty_success_context.get("jsFallbackReason"),
                )
                duration_ms = round((time.monotonic() - start_time) * 1000, 2)
                return ToolResult(
                    tool_name=self.name,
                    input=input,
                    output={
                        "kind": "content",
                        "url": str(last_empty_success_context.get("url") or url),
                        "title": str(last_empty_success_context.get("title") or ""),
                        "content": empty_content,
                        "structuredData": {},
                        "backendUsed": str(last_empty_success_context.get("backendUsed") or backend_used or "none"),
                        "backendAttempts": backend_attempts,
                        "quality": "extract_garbage",
                        "missingFields": expected_fields,
                        "interactionRequired": interaction_required,
                        "pageKind": page_kind,
                        "fetchFailureKind": None,
                        "httpStatus": last_empty_success_context.get("httpStatus"),
                        "networkError": None,
                        "redirectedUrl": last_empty_success_context.get("redirectedUrl"),
                        "transportStrategy": last_empty_success_context.get("transportStrategy"),
                        "browserEscalationSuppressed": browser_escalation_suppressed(empty_metadata, "extract_garbage"),
                        **empty_metadata,
                    },
                    duration_ms=duration_ms,
                    sandboxed=False,
                    source_url=str(last_empty_success_context.get("url") or url),
                    provenance_hint={
                        "backendUsed": str(last_empty_success_context.get("backendUsed") or backend_used or "none"),
                        "backendAttempts": backend_attempts,
                        "missingFields": expected_fields,
                        "pageKind": page_kind,
                        "quality": "extract_garbage",
                        "fetchFailureKind": None,
                        "httpStatus": last_empty_success_context.get("httpStatus"),
                        "networkError": None,
                        "redirectedUrl": last_empty_success_context.get("redirectedUrl"),
                        "transportStrategy": last_empty_success_context.get("transportStrategy"),
                        "browserEscalationSuppressed": browser_escalation_suppressed(empty_metadata, "extract_garbage"),
                        **empty_metadata,
                    },
                )

            backend_attempts.append({
                "backend": "web_fetch",
                "tool": "web_fetch",
                "status": "error",
                "reason": "No extractor backend returned usable content",
            })
            fetch_failure_kind = None
            http_status = None
            network_error = None
            redirected_url = None
            transport_strategy = "none"
            result_kind = "content"
            for attempt in reversed(backend_attempts):
                if not isinstance(attempt, dict):
                    continue
                if attempt.get("fetchFailureKind") or attempt.get("networkError"):
                    fetch_failure_kind = attempt.get("fetchFailureKind")
                    http_status = attempt.get("httpStatus")
                    network_error = attempt.get("networkError") or attempt.get("error")
                    redirected_url = attempt.get("redirectedUrl")
                    transport_strategy = attempt.get("transportStrategy") or attempt.get("attempt") or "none"
                    result_kind = "transport_failure"
                    break
            duration_ms = round((time.monotonic() - start_time) * 1000, 2)
            return ToolResult(
                tool_name=self.name,
                input=input,
                output={
                    "kind": result_kind,
                    "url": url,
                    "title": "",
                    "content": "",
                    "structuredData": {},
                    "backendUsed": backend_used or "none",
                    "backendAttempts": backend_attempts,
                    "quality": "extract_garbage",
                    "missingFields": expected_fields,
                    "interactionRequired": interaction_required,
                    "pageKind": page_kind,
                    "fetchFailureKind": fetch_failure_kind,
                    "httpStatus": http_status,
                    "networkError": network_error,
                    "redirectedUrl": redirected_url,
                    "transportStrategy": transport_strategy,
                    "browserEscalationSuppressed": browser_escalation_suppressed(
                        self._extraction_quality_metadata(
                            url=url,
                            task_type=task_type,
                            source_mode=source_mode,
                            page_kind=page_kind,
                            content="",
                            structured_data={},
                            expected_fields=expected_fields,
                            quality="extract_garbage",
                            extraction_method=backend_used or "none",
                            raw_source_text="",
                        ),
                        "extract_garbage",
                    ),
                    **self._extraction_quality_metadata(
                        url=url,
                        task_type=task_type,
                        source_mode=source_mode,
                        page_kind=page_kind,
                        content="",
                        structured_data={},
                        expected_fields=expected_fields,
                        quality="extract_garbage",
                        extraction_method=backend_used or "none",
                        raw_source_text="",
                    ),
                },
                error="No extraction backend produced usable content.",
                duration_ms=duration_ms,
                sandboxed=False,
                source_url=url,
                provenance_hint={
                    "backendAttempts": backend_attempts,
                    "pageKind": page_kind,
                    "quality": "extract_garbage",
                    "fetchFailureKind": fetch_failure_kind,
                    "httpStatus": http_status,
                    "networkError": network_error,
                    "redirectedUrl": redirected_url,
                    "transportStrategy": transport_strategy,
                    "browserEscalationSuppressed": browser_escalation_suppressed(
                        self._extraction_quality_metadata(
                            url=url,
                            task_type=task_type,
                            source_mode=source_mode,
                            page_kind=page_kind,
                            content="",
                            structured_data={},
                            expected_fields=expected_fields,
                            quality="extract_garbage",
                            extraction_method=backend_used or "none",
                            raw_source_text="",
                        ),
                        "extract_garbage",
                    ),
                    **self._extraction_quality_metadata(
                        url=url,
                        task_type=task_type,
                        source_mode=source_mode,
                        page_kind=page_kind,
                        content="",
                        structured_data={},
                        expected_fields=expected_fields,
                        quality="extract_garbage",
                        extraction_method=backend_used or "none",
                        raw_source_text="",
                    ),
                },
            )

        if extraction_metadata.get("pageType") in {"homepage", "news_index"}:
            structured_data = self._augment_homepage_structured_data(best_content, best_content, structured_data)
            extraction_metadata = self._extraction_quality_metadata(
                url=best_url,
                task_type=task_type,
                source_mode=source_mode,
                page_kind=page_kind,
                content=best_content,
                structured_data=structured_data,
                expected_fields=expected_fields,
                quality=quality,
                extraction_method=backend_used or "none",
                raw_source_text=best_content,
                js_fallback_detected=best_js_fallback_detected,
                js_fallback_reason=best_js_fallback_reason,
            )

        duration_ms = round((time.monotonic() - start_time) * 1000, 2)
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "kind": "content",
                "url": best_url,
                "title": best_title,
                "content": best_content,
                "structuredData": structured_data,
                "backendUsed": backend_used,
                "backendAttempts": backend_attempts,
                "quality": quality,
                "missingFields": missing_fields,
                "interactionRequired": interaction_required,
                "pageKind": page_kind,
                "browserEscalationSuppressed": browser_escalation_suppressed(extraction_metadata, quality),
                **extraction_metadata,
            },
            duration_ms=duration_ms,
            sandboxed=False,
            source_url=best_url,
            provenance_hint={
                "backendUsed": backend_used,
                "backendAttempts": backend_attempts,
                "missingFields": missing_fields,
                "pageKind": page_kind,
                "quality": quality,
                "interactionRequired": interaction_required,
                "browserEscalationSuppressed": browser_escalation_suppressed(extraction_metadata, quality),
                **extraction_metadata,
            },
        )

    async def health_check(self) -> str:
        return "ok"
