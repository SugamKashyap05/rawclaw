import logging
import time
import re
from typing import Any, Dict, List, Optional

import httpx

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.tools.search")

DUCKDUCKGO_API_URL = "https://api.duckduckgo.com/"
SEARCH_TIMEOUT = 10


class DuckDuckGoSearchTool(BaseTool):
    name = "duckduckgo_search"
    description = "Searches the web using DuckDuckGo directly. Use this if the main 'web_search' tool is unavailable."
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query string.",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results to return. Default: 5, Max: 20.",
                "default": 5,
            },
        },
        "required": ["query"],
    }
    capability_tags = ["search", "read", "network"]
    requires_sandbox = False
    requires_confirmation = False

    def __init__(self) -> None:
        pass

    def _normalize_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", (text or "").strip().lower())

    def _trim_repetitive_snippet(self, text: str) -> str:
        snippet = re.sub(r"\s+", " ", (text or "")).strip()
        if not snippet:
            return ""

        repeated_match = re.search(r"(.{40,120}?)(?:\s+\1){2,}", snippet, re.IGNORECASE)
        if repeated_match:
            return repeated_match.group(1).strip() + "..."

        words = snippet.split()
        if len(words) > 40:
            window = " ".join(words[:16]).lower()
            later = " ".join(words[16:]).lower()
            if window and window in later:
                return " ".join(words[:24]).strip() + "..."

        return snippet

    def _dedupe_results(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        seen_keys = set()
        for result in results:
            title = self._normalize_text(result.get("title", ""))
            url = self._normalize_text(result.get("url", ""))
            snippet = self._trim_repetitive_snippet(result.get("snippet", ""))
            snippet_norm = self._normalize_text(snippet)

            dedupe_key = url or f"{title}|{snippet_norm[:160]}"
            fuzzy_key = f"{title[:120]}|{snippet_norm[:120]}"

            if dedupe_key in seen_keys or fuzzy_key in seen_keys:
                continue

            seen_keys.add(dedupe_key)
            seen_keys.add(fuzzy_key)
            deduped.append({
                **result,
                "snippet": snippet,
            })

        return deduped

    def _should_skip_wikipedia_fallback(self, query: str) -> bool:
        lowered = (query or "").lower()
        if not lowered:
            return False

        operator_markers = [
            "site:",
            "filetype:",
            "intitle:",
            "inurl:",
            "\"",
            " after:",
            " before:",
        ]
        if any(marker in lowered for marker in operator_markers):
            return True

        # Wikipedia is a poor fallback for freshness- or standings-driven queries.
        if any(token in lowered for token in [
            "latest",
            "current",
            "news",
            "updates",
            "standings",
            "points table",
            "rankings",
            "nrr",
            "openai api",
            "ipl 2026",
            "spacex starship",
        ]):
            return True

        return False

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start = time.time()
        query = input.get("query", "")
        max_results = min(input.get("max_results", 5), 20)

        if not query:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Query cannot be empty",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        results = await self.duckduckgo_search(query)
        source = "duckduckgo"

        if results is None:
            error_msg = "DuckDuckGo search failed (may be rate limited or network issue)."
            logger.error(f"web_search failed for query '{query}': {error_msg}")
            return ToolResult(
                tool_name=self.name,
                input=input,
                output={
                    "status": "execution_failure",
                    "results": [],
                    "provider": source,
                },
                error=error_msg,
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
                provenance_hint={"status": "execution_failure", "provider": source},
            )

        results = self._dedupe_results(results)

        # Build output with source URLs
        output_results = []
        sources = []
        for r in results[:max_results]:
            output_results.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("snippet", ""),
                "source": source,
                "confidence": "medium",
            })
            if r.get("url"):
                sources.append(r["url"])

        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "source": source,
                "status": "ok",
                "results": output_results,
            },
            duration_ms=round((time.time() - start) * 1000, 2),
            sandboxed=False,
            source_url=sources[0] if sources else None,
            provenance_hint={"source": source, "result_count": len(output_results)},
        )

    async def duckduckgo_search(self, query: str) -> Optional[List[Dict]]:
        """Search using DuckDuckGo HTML, then Instant Answer API, then Wikipedia."""
        results = []
        try:
            import bs4
            import urllib.parse
            async with httpx.AsyncClient(timeout=5) as client:
                data = {"q": query, "b": "", "kl": "wt-wt"}
                headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
                resp = await client.post("https://html.duckduckgo.com/html/", data=data, headers=headers)
                resp.raise_for_status()
                
                soup = bs4.BeautifulSoup(resp.text, "html.parser")
                for result in soup.find_all("div", class_="result"):
                    title_elem = result.find("a", class_="result__url")
                    snippet_elem = result.find("a", class_="result__snippet")
                    
                    if title_elem and snippet_elem:
                        h2 = result.find("h2", class_="result__title")
                        title = h2.text.strip() if h2 else title_elem.text.strip()
                        url = title_elem.get("href", "")
                        if "uddg=" in url:
                            parsed = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                            if "uddg" in parsed:
                                url = parsed["uddg"][0]
                        
                        snippet = self._trim_repetitive_snippet(snippet_elem.text.strip())
                        results.append({
                            "title": title,
                            "url": url,
                            "snippet": snippet,
                        })
        except Exception as e:
            logger.warning(f"DuckDuckGo search failed, will fallback: {e}")

        if not results:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    api_resp = await client.get(
                        DUCKDUCKGO_API_URL,
                        params={
                            "q": query,
                            "format": "json",
                            "no_html": 1,
                            "no_redirect": 1,
                            "skip_disambig": 1,
                        },
                    )
                    api_resp.raise_for_status()
                    api_data = api_resp.json()

                    abstract_text = self._trim_repetitive_snippet(str(api_data.get("AbstractText", "")).strip())
                    abstract_url = str(api_data.get("AbstractURL", "")).strip()
                    heading = str(api_data.get("Heading", "")).strip() or query
                    if abstract_text and abstract_url:
                        results.append({
                            "title": heading,
                            "snippet": abstract_text,
                            "url": abstract_url,
                        })

                    for topic in api_data.get("RelatedTopics", []) or []:
                        topic_items = topic.get("Topics") if isinstance(topic, dict) and isinstance(topic.get("Topics"), list) else [topic]
                        for item in topic_items:
                            if not isinstance(item, dict):
                                continue
                            text = self._trim_repetitive_snippet(str(item.get("Text", "")).strip())
                            url = str(item.get("FirstURL", "")).strip()
                            if text and url:
                                title = text.split(" - ", 1)[0].strip() or query
                                results.append({
                                    "title": title,
                                    "snippet": text,
                                    "url": url,
                                })
                            if len(results) >= 10:
                                break
                        if len(results) >= 10:
                            break
            except Exception as e:
                logger.warning(f"DuckDuckGo instant-answer fallback failed: {e}")

        if not results and not self._should_skip_wikipedia_fallback(query):
            # Fallback to Wikipedia Opensearch if DuckDuckGo Html returns nothing
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    wiki_resp = await client.get(
                        "https://en.wikipedia.org/w/api.php",
                        params={"action": "opensearch", "search": query, "limit": 10, "format": "json"}
                    )
                    wiki_resp.raise_for_status()
                    wiki_data = wiki_resp.json()
                    if len(wiki_data) == 4 and wiki_data[1]:
                        for i in range(len(wiki_data[1])):
                            results.append({
                                "title": wiki_data[1][i] + " (Wikipedia)",
                                "snippet": wiki_data[2][i] or f"Wikipedia article for {wiki_data[1][i]}",
                                "url": wiki_data[3][i]
                            })
            except Exception as e:
                logger.warning(f"Wikipedia fallback failed: {e}")
        elif not results:
            logger.info(f"Skipping Wikipedia fallback for operator-heavy or freshness-driven query: {query}")
        
        results = self._dedupe_results(results)
        return results if results else None

    async def health_check(self) -> str:
        return "ok"
