import json
import logging
import time
import asyncio
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.web_fetch import WebFetchTool

logger = logging.getLogger("rawclaw.tools.web_search")
PROVIDER_TIMEOUT_SECONDS = 8
TOTAL_SEARCH_BUDGET_SECONDS = 20
MIN_PROVIDER_TIMEOUT_SECONDS = 1.5
SEARCH_BUDGET_RESERVE_SECONDS = 1.0
PROVIDER_TIMEOUT_OVERRIDES = {
    "duckduckgo_search": 4.0,
    "web-search": 4.0,
    "iask-search": 6.0,
    "monica-search": 5.0,
    "search": 5.0,
    "google_search": 6.0,
}
PROVIDER_FAILURE_SKIP_CLASSES = {
    "timeout",
    "rate_limited",
    "network_failure",
    "transport_failure",
}
AD_NOISE_PATTERNS = [
    "viewing ad",
    "tickets ad",
    "ad ",
    "buy tickets",
    "ticket booking",
    "sponsored",
]

class SmartWebSearchTool(BaseTool):
    name = "web_search"
    description = (
        "Powerful web search that queries multiple sources (Google/DuckDuckGo) "
        "and automatically fetches/summarizes the top results for deep context."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query string.",
            },
            "max_results": {
                "type": "integer",
                "description": "Number of search results to consider. Default: 5.",
                "default": 5,
            },
            "fetch_top": {
                "type": "integer",
                "description": "Number of top results to automatically fetch and summarize. Default: 2.",
                "default": 2,
            }
        },
        "required": ["query"],
    }
    capability_tags = ["search", "read", "network", "research"]
    requires_sandbox = False
    requires_confirmation = False

    def __init__(self) -> None:
        self.fetch_tool = WebFetchTool()

    def _normalize_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", (text or "").strip().lower())

    def _clean_source_title(self, title: str) -> str:
        cleaned = re.sub(r"\s+", " ", (title or "").strip(" .:-"))
        return cleaned[:160]

    def _extract_embedded_sources(self, text: str) -> List[Dict[str, str]]:
        snippet = str(text or "")
        if not snippet:
            return []

        sources: List[Dict[str, str]] = []
        seen_urls = set()

        authoritative_matches = re.finditer(
            r"(?:^|\n)\s*\d+\.\s*([^\n]{3,180}?)\.\s*\[[^\]]{1,120}\]\((https?://[^\s)]+)\)",
            snippet,
            flags=re.IGNORECASE,
        )
        for match in authoritative_matches:
            title = self._clean_source_title(match.group(1))
            url = match.group(2).strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            sources.append({"title": title or urlparse(url).netloc, "url": url})

        markdown_link_matches = re.finditer(r"\[([^\]]{2,160})\]\((https?://[^\s)]+)\)", snippet)
        for match in markdown_link_matches:
            title = self._clean_source_title(match.group(1))
            url = match.group(2).strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            sources.append({"title": title or urlparse(url).netloc, "url": url})

        bare_url_matches = re.finditer(r"(https?://[^\s)\]>]+)", snippet, flags=re.IGNORECASE)
        for match in bare_url_matches:
            url = match.group(1).strip().rstrip(".,;:")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            sources.append({"title": urlparse(url).netloc or url, "url": url})

        return sources

    def _provider_id(self, tool: BaseTool, source: str) -> str:
        tags = getattr(tool, "capability_tags", []) or []
        server_hint = next((tag for tag in tags if tag not in {"search", "read", "network", "research", "mcp"}), "")
        return f"{source}:{tool.name}:{server_hint or 'default'}"

    def _remaining_budget_seconds(self, start: float) -> float:
        return max(0.0, TOTAL_SEARCH_BUDGET_SECONDS - (time.time() - start))

    def _provider_timeout_seconds(self, tool_name: str, remaining_budget_seconds: float) -> float:
        configured = float(PROVIDER_TIMEOUT_OVERRIDES.get(tool_name, PROVIDER_TIMEOUT_SECONDS))
        capped = min(configured, max(0.0, remaining_budget_seconds - SEARCH_BUDGET_RESERVE_SECONDS))
        if capped <= 0:
            return 0.0
        return round(max(MIN_PROVIDER_TIMEOUT_SECONDS, capped), 2)

    def _append_provider_attempt(
        self,
        attempts: List[Dict[str, Any]],
        *,
        provider: str,
        source: str,
        query: str,
        status: str,
        remaining_budget_seconds: float,
        timeout_seconds: float = 0.0,
        elapsed_ms: float = 0.0,
        error: str = "",
        failure_classification: str = "",
        results_count: int = 0,
    ) -> None:
        attempt: Dict[str, Any] = {
            "provider": provider,
            "source": source,
            "query": query,
            "status": status,
            "remaining_budget_s": round(max(0.0, remaining_budget_seconds), 2),
            "elapsed_ms": round(max(0.0, elapsed_ms), 2),
        }
        if timeout_seconds:
            attempt["timeout_s"] = round(max(0.0, timeout_seconds), 2)
        if error:
            attempt["error"] = error[:240]
        if failure_classification:
            attempt["failure_classification"] = failure_classification
        if results_count:
            attempt["results_count"] = results_count
        attempts.append(attempt)

    def _summarize_provider_scoreboard(self, attempts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        scoreboard: Dict[str, Dict[str, Any]] = {}
        for attempt in attempts:
            provider = str(attempt.get("provider") or "unknown")
            source = str(attempt.get("source") or "unknown")
            key = f"{source}:{provider}"
            entry = scoreboard.setdefault(
                key,
                {
                    "provider": provider,
                    "source": source,
                    "attempts": 0,
                    "successes": 0,
                    "timeouts": 0,
                    "rate_limited": 0,
                    "network_failures": 0,
                    "transport_failures": 0,
                    "unparseable_or_empty": 0,
                    "execution_failures": 0,
                    "budget_exhausted": 0,
                    "total_elapsed_ms": 0.0,
                    "queries": [],
                    "last_error": "",
                },
            )
            entry["attempts"] += 1
            entry["total_elapsed_ms"] = round(
                float(entry.get("total_elapsed_ms", 0.0)) + float(attempt.get("elapsed_ms", 0.0)),
                2,
            )
            query = str(attempt.get("query") or "")
            if query and query not in entry["queries"]:
                entry["queries"].append(query)
            status = str(attempt.get("status") or "")
            failure = str(attempt.get("failure_classification") or status)
            if status == "ok":
                entry["successes"] += 1
            elif status == "unparseable_or_empty":
                entry["unparseable_or_empty"] += 1
            elif failure == "timeout":
                entry["timeouts"] += 1
            elif failure == "rate_limited":
                entry["rate_limited"] += 1
            elif failure == "network_failure":
                entry["network_failures"] += 1
            elif failure == "transport_failure":
                entry["transport_failures"] += 1
            elif status == "budget_exhausted":
                entry["budget_exhausted"] += 1
            else:
                entry["execution_failures"] += 1
            error = str(attempt.get("error") or "")
            if error:
                entry["last_error"] = error
        return sorted(
            scoreboard.values(),
            key=lambda item: (-int(item.get("successes", 0)), int(item.get("attempts", 0)), str(item.get("provider", ""))),
        )

    def _summarize_query_trace(self, attempts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        trace: Dict[str, Dict[str, Any]] = {}
        for attempt in attempts:
            query = str(attempt.get("query") or "").strip()
            if not query:
                continue
            entry = trace.setdefault(
                query,
                {
                    "query": query,
                    "providers_tried": [],
                    "attempts": 0,
                    "successful_provider": "",
                    "status": "failed",
                    "results_count": 0,
                    "last_error": "",
                },
            )
            provider = str(attempt.get("provider") or "")
            if provider and provider not in entry["providers_tried"]:
                entry["providers_tried"].append(provider)
            entry["attempts"] += 1
            status = str(attempt.get("status") or "")
            if status == "ok":
                entry["status"] = "ok"
                entry["successful_provider"] = provider
                entry["results_count"] = int(attempt.get("results_count") or 0)
            elif status == "budget_exhausted" and entry["status"] != "ok":
                entry["status"] = "budget_exhausted"
            error = str(attempt.get("error") or "")
            if error:
                entry["last_error"] = error
        return list(trace.values())

    def _classify_provider_failure(self, error: str) -> str:
        lowered = (error or "").lower()
        if any(token in lowered for token in [
            "chunk is longer than limit",
            "stdio read error",
            "transport",
            "separator is found",
        ]):
            return "transport_failure"
        if any(token in lowered for token in [
            "timeout",
            "timed out",
        ]):
            return "timeout"
        if any(token in lowered for token in [
            "rate limited",
            "429",
            "too many requests",
        ]):
            return "rate_limited"
        if any(token in lowered for token in [
            "connection refused",
            "network",
            "dns",
            "unreachable",
            "connect",
        ]):
            return "network_failure"
        return "execution_failure"

    def _trim_repetitive_text(self, text: str, max_words: int = 36) -> str:
        clean = re.sub(r"\s+", " ", (text or "")).strip()
        if not clean:
            return ""

        repeated_match = re.search(r"(.{40,120}?)(?:\s+\1){2,}", clean, re.IGNORECASE)
        if repeated_match:
            return repeated_match.group(1).strip() + "..."

        words = clean.split()
        if len(words) > max_words:
            prefix = " ".join(words[:16]).lower()
            suffix = " ".join(words[16:]).lower()
            if prefix and prefix in suffix:
                return " ".join(words[:24]).strip() + "..."

        return clean

    def _dedupe_results(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for res in results:
            title = self._normalize_text(res.get("title", ""))
            url = self._normalize_text(res.get("url", ""))
            snippet = self._trim_repetitive_text(res.get("snippet", ""))
            full_content = self._trim_repetitive_text(res.get("full_content", ""), max_words=60)
            key = url or f"{title}|{self._normalize_text(snippet)[:160]}"
            fuzzy = f"{title[:120]}|{self._normalize_text(snippet or full_content)[:120]}"
            if key in seen or fuzzy in seen:
                continue
            seen.add(key)
            seen.add(fuzzy)
            deduped.append({
                **res,
                "snippet": snippet,
                **({"full_content": full_content} if full_content else {}),
            })
        return deduped

    def _snippet_fingerprint(self, text: str) -> str:
        normalized = self._normalize_text(self._trim_repetitive_text(text, max_words=50))
        normalized = re.sub(r"https?://\S+", " ", normalized)
        normalized = re.sub(r"according to [^.]+", " ", normalized)
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
        tokens = [token for token in normalized.split() if token not in {
            "the", "and", "that", "with", "from", "this", "current", "latest", "official",
            "today", "page", "website", "portal", "you", "can", "view", "access",
        }]
        return " ".join(tokens[:40]).strip()

    def _looks_like_fetch_garbage(self, text: str) -> bool:
        lowered = self._normalize_text(text)
        if not lowered:
            return True
        garbage_markers = [
            "home / copy season",
            "copy role batsman",
            "primary navigation",
            "search the api docs",
            "suggested responses create reasoning_effort",
            "title title",
            "results squad fixtures",
            "matches fixtures results",
        ]
        if any(marker in lowered for marker in garbage_markers):
            return True
        if lowered.count("|") >= 6:
            return True
        if re.search(r"\bseason\s+20\d{2}\s+season\s+20\d{2}\b", lowered):
            return True
        return False

    def _merge_quality_tags(self, result: Dict[str, Any], *tags: str) -> Dict[str, Any]:
        merged = list(result.get("quality_tags") or [])
        for tag in tags:
            if tag and tag not in merged:
                merged.append(tag)
        if merged:
            result["quality_tags"] = merged
        return result

    def _collapse_synthetic_duplicates(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        grouped: Dict[str, Dict[str, Any]] = {}
        ordered: List[Dict[str, Any]] = []
        for res in results:
            fingerprint = self._snippet_fingerprint(str(res.get("snippet", "")))
            if not fingerprint or len(fingerprint.split()) < 8:
                ordered.append(res)
                continue
            if fingerprint not in grouped:
                grouped[fingerprint] = {
                    **res,
                    "duplicate_source_count": 1,
                    "duplicate_urls": [res.get("url", "")] if res.get("url") else [],
                }
                ordered.append(grouped[fingerprint])
                continue
            existing = grouped[fingerprint]
            existing["duplicate_source_count"] = int(existing.get("duplicate_source_count", 1)) + 1
            urls = existing.setdefault("duplicate_urls", [])
            candidate_url = res.get("url", "")
            if candidate_url and candidate_url not in urls:
                urls.append(candidate_url)
            self._merge_quality_tags(existing, "synthetic_aggregator")
            if len(str(res.get("snippet", ""))) > len(str(existing.get("snippet", ""))):
                existing["snippet"] = res.get("snippet", "")
            if not existing.get("title") and res.get("title"):
                existing["title"] = res.get("title")
        return ordered

    def _extract_results(self, output: Any) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        if isinstance(output, dict):
            if "results" in output:
                results = output.get("results", [])
            elif "structuredContent" in output:
                return self._extract_results(output.get("structuredContent"))
            elif "result" in output:
                return self._extract_results(output.get("result"))
            elif "data" in output and isinstance(output.get("data"), list):
                results = output.get("data", [])
            elif "organic" in output and isinstance(output.get("organic"), list):
                results = output.get("organic", [])
            elif "items" in output:
                results = output.get("items", [])
            elif "sources" in output and isinstance(output.get("sources"), list):
                results = output.get("sources", [])
            elif "hits" in output and isinstance(output.get("hits"), list):
                results = output.get("hits", [])
            elif "content" in output:
                content = output.get("content")
                if content and isinstance(content, str):
                    try:
                        parsed = json.loads(content)
                        if isinstance(parsed, dict) and "results" in parsed:
                            results = parsed.get("results", [])
                        elif isinstance(parsed, list):
                            results = parsed
                    except json.JSONDecodeError:
                        results = [{"snippet": content, "content": content}]
            elif "answer" in output and isinstance(output.get("answer"), str):
                results = [{"title": "Search answer", "snippet": output.get("answer", ""), "content": output.get("answer", "")}]
        elif isinstance(output, list):
            results = output
        elif isinstance(output, str):
            try:
                parsed = json.loads(output)
                return self._extract_results(parsed)
            except json.JSONDecodeError:
                results = [{"title": "Search result", "snippet": output, "content": output}]
        return results

    def _normalize_results(
        self,
        raw_results: List[Dict[str, Any]],
        source: str,
        confidence: str = "medium",
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        error_markers = [
            "error executing tool",
            "search failed for",
            "failed to fetch search results",
            "http 202",
            "mcp tool call returned no result",
            "no results found",
        ]
        for item in raw_results or []:
            if not isinstance(item, dict):
                continue
            title = self._trim_repetitive_text(
                str(
                    item.get("title")
                    or item.get("name")
                    or item.get("headline")
                    or item.get("source")
                    or ""
                )
            )
            url = str(item.get("url") or item.get("link") or item.get("href") or item.get("sourceUrl") or "").strip()
            snippet = self._trim_repetitive_text(
                str(
                    item.get("snippet")
                    or item.get("description")
                    or item.get("summary")
                    or item.get("text")
                    or item.get("content")
                    or item.get("full_content")
                    or ""
                )
            )
            lowered_blob = " ".join([title, url, snippet]).lower()
            if any(marker in lowered_blob for marker in error_markers):
                continue
            embedded_sources = self._extract_embedded_sources(snippet)
            if embedded_sources:
                primary_source = embedded_sources[0]
                if not title:
                    title = primary_source.get("title", "")
                if not url:
                    url = primary_source.get("url", "")
            quality_tags: List[str] = ["search_snippet"]
            if embedded_sources and len(embedded_sources) > 1:
                quality_tags.append("synthetic_aggregator")
            if url and any(domain in urlparse(url).netloc.lower() for domain in ["openai.com", "developers.openai.com", "platform.openai.com", "spacex.com", "iplt20.com", "nasa.gov", "faa.gov"]):
                quality_tags.append("official_page")
            entry = {
                "title": title,
                "url": url,
                "snippet": snippet,
                "source": source,
                "confidence": confidence,
                "quality_tags": quality_tags,
            }
            if item.get("full_content"):
                entry["full_content"] = self._trim_repetitive_text(str(item.get("full_content")), max_words=60)
            if any(entry.values()):
                normalized.append(entry)
            for extra_source in embedded_sources[1:4]:
                extra_url = extra_source.get("url", "").strip()
                if not extra_url:
                    continue
                normalized.append({
                    "title": extra_source.get("title", ""),
                    "url": extra_url,
                    "snippet": snippet,
                    "source": source,
                    "confidence": confidence,
                    "quality_tags": ["search_snippet", "synthetic_aggregator"],
                })
        return normalized

    def _canonicalize_query(self, query: str) -> str:
        text = re.sub(r"\s+", " ", str(query or "").strip())
        lowered = text.lower()

        if not text:
            return text

        if "csk" in lowered and "chennai super kings" not in lowered:
            text = re.sub(r"\bcsk\b", "Chennai Super Kings", text, flags=re.IGNORECASE)
            lowered = text.lower()

        if any(token in lowered for token in ["chennai super kings", "csk"]) and "site:iplt20.com" in lowered:
            if not any(token in lowered for token in ["points table", "standings", "rankings", "nrr"]):
                text = re.sub(
                    r"\b(chennai super kings|csk)\b",
                    "Chennai Super Kings IPL 2026 points table standings",
                    text,
                    count=1,
                    flags=re.IGNORECASE,
                )
                lowered = text.lower()

        if "ipl 2026" in lowered and "standings race" in lowered and "points table" not in lowered:
            text = re.sub(
                r"ipl 2026 standings race",
                "IPL 2026 points table standings race",
                text,
                count=1,
                flags=re.IGNORECASE,
            )
            lowered = text.lower()

        if "openai" in lowered and "api" in lowered and "site:openai.com" in lowered and "changelog" not in lowered:
            text = f"{text} changelog"

        return re.sub(r"\s+", " ", text).strip()

    def _fallback_queries(self, query: str) -> List[str]:
        canonical = self._canonicalize_query(query)
        candidates = [canonical] if canonical else [str(query or "").strip()]
        raw_query = str(query or "").strip()
        if raw_query and raw_query not in candidates:
            candidates.append(raw_query)
        simplified = candidates[0]
        simplified = re.sub(r"\bsite:[^\s]+\b", "", simplified, flags=re.IGNORECASE)
        simplified = re.sub(r"\bOR\b", " ", simplified, flags=re.IGNORECASE)
        simplified = re.sub(r"\b(ignore|be careful)\b.*$", "", simplified, flags=re.IGNORECASE).strip()
        simplified = re.sub(r"\s+", " ", simplified).strip(" .:-")
        if simplified and simplified not in candidates:
            candidates.append(simplified)

        lowered = simplified.lower()
        if "csk" in lowered and "chennai super kings" not in lowered:
            csk_expanded = re.sub(r"\bcsk\b", "Chennai Super Kings", simplified, flags=re.IGNORECASE)
            if csk_expanded and csk_expanded not in candidates:
                candidates.append(csk_expanded)
        if any(token in lowered for token in ["chennai super kings", "csk"]) and not any(
            token in lowered for token in ["points table", "standings", "rankings", "nrr"]
        ):
            standings_variant = f"{simplified} IPL 2026 points table standings".strip()
            if standings_variant not in candidates:
                candidates.append(standings_variant)
        if "openai" in lowered and "api" in lowered and "changelog" not in lowered:
            changelog_variant = f"{simplified} changelog releases".strip()
            if changelog_variant not in candidates:
                candidates.append(changelog_variant)
        if any(token in lowered for token in ["gta 6", "gta6", "gta vi"]):
            for variant in [
                "GTA 6 launch latest news Rockstar",
                "Rockstar GTA 6 release date launch update",
                "GTA VI launch news",
            ]:
                if variant not in candidates:
                    candidates.append(variant)
        return [candidate for candidate in candidates if candidate]

    def _discover_search_tools(self) -> List[tuple[BaseTool, str]]:
        preferred_names = [
            "duckduckgo_search",
            "web-search",
            "iask-search",
            "monica-search",
            "search",
            "google_search",
        ]

        discovered: List[tuple[BaseTool, str]] = []
        seen = set()
        excluded_loopback_tools = {"smart_search", self.name}

        for name in preferred_names:
            tool = TOOL_REGISTRY.get_optional(name)
            if not tool or tool.name in excluded_loopback_tools or tool.name in seen:
                continue
            source = "MCP" if "mcp" in getattr(tool, "capability_tags", []) else "built-in"
            discovered.append((tool, source))
            seen.add(tool.name)

        for tool in TOOL_REGISTRY.list_by_tag("search"):
            if not tool or tool.name in excluded_loopback_tools or tool.name in seen:
                continue
            source = "MCP" if "mcp" in getattr(tool, "capability_tags", []) else "built-in"
            discovered.append((tool, source))
            seen.add(tool.name)

        return discovered

    def _build_tool_input(self, tool: BaseTool, query: str, max_results: int) -> Dict[str, Any]:
        name = getattr(tool, "name", "")
        if name == "web-search":
            return {
                "query": query,
                "numResults": max(3, min(max_results, 10)),
                "mode": "detailed",
            }
        if name == "iask-search":
            return {
                "query": query,
                "mode": "question",
                "detailLevel": "detailed",
            }
        if name == "monica-search":
            return {"query": query}
        if name == "duckduckgo_search":
            return {"query": query, "max_results": max_results}
        return {"query": query, "max_results": max_results}

    def _build_failure_result(
        self,
        input: Dict[str, Any],
        start: float,
        classification: str,
        provider_attempts: List[Dict[str, Any]],
        message: str,
        query_variants: Optional[List[str]] = None,
        budget_exhausted: bool = False,
    ) -> ToolResult:
        provider_scoreboard = self._summarize_provider_scoreboard(provider_attempts)
        query_trace = self._summarize_query_trace(provider_attempts)
        final_message = message
        if budget_exhausted:
            attempted_providers = len([attempt for attempt in provider_attempts if attempt.get("provider") != "budget_guard"])
            attempted_queries = len({str(attempt.get("query") or "").strip() for attempt in provider_attempts if attempt.get("query")})
            final_message = (
                f"{message} Attempted {attempted_providers} provider calls across {attempted_queries} query variants before the search budget was exhausted."
            ).strip()
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "status": classification,
                "results": [],
                "provider_attempts": provider_attempts,
                "provider_scoreboard": provider_scoreboard,
                "query_trace": query_trace,
                "query_variants": list(query_variants or []),
                "budget_exhausted": budget_exhausted,
            },
            error=final_message,
            duration_ms=round((time.time() - start) * 1000, 2),
            sandboxed=False,
            provenance_hint={
                "status": classification,
                "provider_attempts": provider_attempts,
                "provider_scoreboard": provider_scoreboard,
                "query_trace": query_trace,
                "query_variants": list(query_variants or []),
                "budget_exhausted": budget_exhausted,
            },
        )

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start = time.time()
        query = input.get("query", "")
        max_results = min(input.get("max_results", 5), 10)
        fetch_top = min(input.get("fetch_top", 2), 3)

        if not query:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Query cannot be empty",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # 1. Source Discovery & Selection
        # Prefer built-in search tools first, but fall back to any search-capable MCP tools.
        available_search_tools = self._discover_search_tools()

        if not available_search_tools:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="No underlying search tools (built-in or MCP) found in registry.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # 2. Perform Search with runtime fallback
        search_res = None
        search_tool = None
        tool_source = ""
        last_error = ""
        last_failure_classification = "execution_failure"
        results: List[Dict[str, Any]] = []
        provider_attempts: List[Dict[str, Any]] = []
        unavailable_providers = set()
        provider_empty_counts: Dict[str, int] = {}
        fallback_queries = self._fallback_queries(query)
        budget_exhausted = False
        for search_query in fallback_queries:
            for candidate_tool, candidate_source in available_search_tools:
                remaining_budget_seconds = self._remaining_budget_seconds(start)
                if remaining_budget_seconds <= (MIN_PROVIDER_TIMEOUT_SECONDS + SEARCH_BUDGET_RESERVE_SECONDS):
                    last_error = f"Search budget exceeded after {TOTAL_SEARCH_BUDGET_SECONDS}s."
                    last_failure_classification = "budget_exhausted"
                    budget_exhausted = True
                    self._append_provider_attempt(
                        provider_attempts,
                        provider="budget_guard",
                        source="internal",
                        query=search_query,
                        status="budget_exhausted",
                        remaining_budget_seconds=remaining_budget_seconds,
                        error=last_error,
                        failure_classification=last_failure_classification,
                    )
                    logger.warning(
                        f"SmartWebSearch search budget exceeded for query '{query}' after {TOTAL_SEARCH_BUDGET_SECONDS}s"
                    )
                    break
                if not candidate_tool:
                    continue
                provider_id = self._provider_id(candidate_tool, candidate_source)
                if provider_id in unavailable_providers:
                    continue
                timeout_seconds = self._provider_timeout_seconds(candidate_tool.name, remaining_budget_seconds)
                if timeout_seconds <= 0:
                    continue
                logger.info(f"SmartWebSearch using: {candidate_tool.name} ({candidate_source}) with query '{search_query}'")
                candidate_input = self._build_tool_input(candidate_tool, search_query, max_results)
                attempt_start = time.time()
                try:
                    candidate_result = await asyncio.wait_for(
                        candidate_tool.execute(candidate_input),
                        timeout=timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    elapsed_ms = (time.time() - attempt_start) * 1000
                    last_error = f"Search provider timed out after {timeout_seconds}s."
                    last_failure_classification = "timeout"
                    self._append_provider_attempt(
                        provider_attempts,
                        provider=candidate_tool.name,
                        source=candidate_source,
                        query=search_query,
                        status=last_failure_classification,
                        remaining_budget_seconds=remaining_budget_seconds,
                        timeout_seconds=timeout_seconds,
                        elapsed_ms=elapsed_ms,
                        error=last_error,
                        failure_classification=last_failure_classification,
                    )
                    unavailable_providers.add(provider_id)
                    logger.warning(
                        f"SmartWebSearch candidate '{candidate_tool.name}' timed out for query '{search_query}'"
                    )
                    continue
                if candidate_result.error:
                    elapsed_ms = (time.time() - attempt_start) * 1000
                    last_error = candidate_result.error
                    last_failure_classification = self._classify_provider_failure(candidate_result.error)
                    self._append_provider_attempt(
                        provider_attempts,
                        provider=candidate_tool.name,
                        source=candidate_source,
                        query=search_query,
                        status=last_failure_classification,
                        remaining_budget_seconds=remaining_budget_seconds,
                        timeout_seconds=timeout_seconds,
                        elapsed_ms=elapsed_ms,
                        error=candidate_result.error,
                        failure_classification=last_failure_classification,
                    )
                    if last_failure_classification in PROVIDER_FAILURE_SKIP_CLASSES:
                        unavailable_providers.add(provider_id)
                        logger.warning(
                            f"SmartWebSearch marking provider unavailable for this request: {candidate_tool.name} ({candidate_source})"
                        )
                    logger.warning(
                        f"SmartWebSearch candidate '{candidate_tool.name}' failed for query '{search_query}': {candidate_result.error}"
                    )
                    continue
                candidate_results = self._normalize_results(
                    self._extract_results(candidate_result.output),
                    source=candidate_tool.name,
                    confidence="medium" if candidate_source == "built-in" else "low",
                )
                if candidate_results:
                    elapsed_ms = (time.time() - attempt_start) * 1000
                    search_res = candidate_result
                    search_tool = candidate_tool
                    tool_source = candidate_source
                    query = search_query
                    results = candidate_results
                    self._append_provider_attempt(
                        provider_attempts,
                        provider=candidate_tool.name,
                        source=candidate_source,
                        query=search_query,
                        status="ok",
                        remaining_budget_seconds=remaining_budget_seconds,
                        timeout_seconds=timeout_seconds,
                        elapsed_ms=elapsed_ms,
                        results_count=len(candidate_results),
                    )
                    break
                elapsed_ms = (time.time() - attempt_start) * 1000
                self._append_provider_attempt(
                    provider_attempts,
                    provider=candidate_tool.name,
                    source=candidate_source,
                    query=search_query,
                    status="unparseable_or_empty",
                    remaining_budget_seconds=remaining_budget_seconds,
                    timeout_seconds=timeout_seconds,
                    elapsed_ms=elapsed_ms,
                )
                provider_empty_counts[provider_id] = provider_empty_counts.get(provider_id, 0) + 1
                if provider_empty_counts[provider_id] >= 2:
                    unavailable_providers.add(provider_id)
                logger.warning(
                    f"SmartWebSearch candidate '{candidate_tool.name}' returned no parseable results for query '{search_query}'"
                )
            if search_res and results:
                break
            if budget_exhausted:
                break

        if not search_res or not search_tool or not results:
            if last_error:
                return self._build_failure_result(
                    input=input,
                    start=start,
                    classification=last_failure_classification,
                    provider_attempts=provider_attempts,
                    message=f"Underlying search failed: {last_error}",
                    query_variants=fallback_queries,
                    budget_exhausted=budget_exhausted,
                )
            return self._build_failure_result(
                input=input,
                start=start,
                classification="empty_or_unparseable_results",
                provider_attempts=provider_attempts,
                message="Underlying search failed: no results extracted from available search providers.",
                query_variants=fallback_queries,
                budget_exhausted=budget_exhausted,
            )

        logger.info(f"SmartWebSearch: search tool '{search_tool.name}' returned: {search_res.output}")

        # 3. Automatic Fetching of Top Results (with bounded timeout)
        FETCH_TIMEOUT = 30  # seconds — hard deadline for all fetches combined
        top_results = results[:fetch_top]
        fetch_tasks = []
        for res in top_results:
            url = res.get("url")
            if url:
                fetch_tasks.append(self.fetch_tool.execute({"url": url}))
        
        try:
            fetch_results = await asyncio.wait_for(
                asyncio.gather(*fetch_tasks, return_exceptions=True),
                timeout=FETCH_TIMEOUT,
            ) if fetch_tasks else []
        except asyncio.TimeoutError:
            logger.warning(f"SmartWebSearch fetch timeout after {FETCH_TIMEOUT}s — returning results without full content")
            fetch_results = []
        
        # 4. Consolidate Output
        enriched_results = []
        result_quality = "good"
        
        filtered_results = []
        for res in results:
            if self._is_low_quality_result(query, res):
                continue
            filtered_results.append(res)

        if filtered_results:
            results = filtered_results

        results = self._collapse_synthetic_duplicates(results)
        results = self._dedupe_results(results)

        for i, res in enumerate(results):
            enriched = {
                "title": res.get("title"),
                "url": res.get("url"),
                "snippet": self._trim_repetitive_text(res.get("snippet", "")),
                "quality_tags": list(res.get("quality_tags") or []),
            }
            if res.get("duplicate_source_count", 1) > 1:
                enriched["duplicate_source_count"] = res.get("duplicate_source_count")
                enriched["duplicate_urls"] = res.get("duplicate_urls", [])
            # Attach full content if we fetched it
            if i < len(fetch_results):
                f_res = fetch_results[i]
                if not f_res.error and f_res.output:
                    # Limit content size for the tool return payload
                    content = self._trim_repetitive_text(f_res.output.get("content", ""), max_words=80)
                    enriched["full_content"] = content[:3000] + ("..." if len(content) > 3000 else "")

                    # Check for placeholder-like or incomplete content
                    if self._is_placeholder_content(content) or self._looks_like_fetch_garbage(content):
                        result_quality = "weak"
                        enriched["quality_note"] = "placeholder_or_incomplete" if self._is_placeholder_content(content) else "fetch_extract_garbage"
                        self._merge_quality_tags(enriched, "fetch_extract_garbage")
                    else:
                        self._merge_quality_tags(enriched, "fetch_extract_clean")
                else:
                    self._merge_quality_tags(enriched, "fetch_extract_unavailable")
            
            enriched_results.append(enriched)
        
        # If no results or all results appear placeholder-like, mark quality as weak
        if not enriched_results or all("quality_note" in r for r in enriched_results):
            result_quality = "weak"

        duration_ms = round((time.time() - start) * 1000, 2)
        provider_scoreboard = self._summarize_provider_scoreboard(provider_attempts)
        query_trace = self._summarize_query_trace(provider_attempts)
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "status": "ok",
                "source_engine": search_tool.name,
                "results": enriched_results,
                "fetch_count": len(fetch_tasks),
                "result_quality": result_quality,
                "quality_assessment": "Results may be incomplete or placeholder-like" if result_quality == "weak" else "Results appear reliable",
                "provider_attempts": provider_attempts,
                "provider_scoreboard": provider_scoreboard,
                "query_trace": query_trace,
                "query_variants": fallback_queries,
                "budget_exhausted": budget_exhausted,
            },
            duration_ms=duration_ms,
            sandboxed=False,
            provenance_hint={
                "status": "ok",
                "engine": search_tool.name,
                "results_count": len(enriched_results),
                "fetched_count": len(fetch_tasks),
                "result_quality": result_quality,
                "provider_attempts": provider_attempts,
                "provider_scoreboard": provider_scoreboard,
                "query_trace": query_trace,
                "query_variants": fallback_queries,
                "budget_exhausted": budget_exhausted,
            }
        )

    def _is_low_quality_result(self, query: str, result: Dict[str, Any]) -> bool:
        title = str(result.get("title", "")).strip().lower()
        snippet = str(result.get("snippet", "")).strip().lower()
        combined = f"{title} {snippet}"
        query_lower = (query or "").lower()

        if any(pattern in combined for pattern in AD_NOISE_PATTERNS):
            if "ticket" not in query_lower and "tickets" not in query_lower:
                return True

        if re.search(r"\bviewing\s+ad\b", combined):
            return True

        if title and snippet and title == snippet:
            return True

        compact_title = self._normalize_text(title)
        compact_snippet = self._normalize_text(snippet)
        if compact_title and compact_snippet and compact_title in compact_snippet and len(compact_snippet) > len(compact_title) * 3:
            return True

        if snippet:
            repeated_match = re.search(r"(.{40,120}?)(?:\s+\1){2,}", snippet, re.IGNORECASE)
            if repeated_match:
                return True

        return False

    def _is_placeholder_content(self, content: str) -> bool:
        """Check if content appears to be placeholder-like or incomplete."""
        if not content or len(content.strip()) < 100:
            return True
        
        placeholder_indicators = [
            "page not found", "coming soon", "under construction",
            "404", "no results", "no matches", "no information available",
            "placeholder", "template", "example.com", "test content",
            "lorem ipsum", "this is a sample", "to be updated",
            "check back later", "content pending", "page is empty",
        ]
        
        content_lower = content.lower()
        for indicator in placeholder_indicators:
            if indicator in content_lower:
                return True
        
        # Check for excessive repetition (like the repeated LIVE action text)
        lines = content_lower.split('.')
        if len(lines) > 10:
            line_counts = {}
            for line in lines:
                line = line.strip()
                if len(line) > 20:  # Only count substantial lines
                    line_counts[line] = line_counts.get(line, 0) + 1
            
            # If any line appears more than 3 times, it's likely boilerplate
            if any(count > 3 for count in line_counts.values()):
                return True
        
        # Check for very low information density
        words = content_lower.split()
        if len(words) < 50:  # Very short content
            return True
            
        return False

    async def health_check(self) -> str:
        # Check if at least one underlying engine is healthy
        engines = ["google_search", "duckduckgo_search"]
        for eng in engines:
            tool = TOOL_REGISTRY.get_optional(eng)
            if tool and await tool.health_check() == "ok":
                return "ok"
        return "degraded"
