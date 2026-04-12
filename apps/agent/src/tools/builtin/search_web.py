"""
SearchWebTool — Web search via Brave Search API with DuckDuckGo fallback.

Security: No sandbox needed (outbound HTTP only, no local state).
Tags: search, read, network
"""
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.tools.search")

BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search"
DUCKDUCKGO_API_URL = "https://api.duckduckgo.com/"
SEARCH_TIMEOUT = 10


class SearchWebTool(BaseTool):
    name = "web_search"
    description = "Searches the web using Brave Search (primary) or DuckDuckGo (fallback) and returns a list of results with titles, URLs, and snippets."
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
        self._brave_api_key: Optional[str] = os.getenv("BRAVE_API_KEY")

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

        # Try Brave first, then DuckDuckGo
        results: Optional[List[Dict]] = None
        source: str = ""

        if self._brave_api_key:
            results = await self._brave_search(query, max_results)
            if results is not None:
                source = "brave"
            else:
                logger.warning("Brave Search failed, falling back to DuckDuckGo")

        if results is None:
            results = await self._duckduckgo_search(query)
            if results is not None:
                source = "duckduckgo"

        if results is None:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Both Brave Search and DuckDuckGo failed. Check API keys and network connectivity.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # Build output with source URLs
        output_results = []
        sources = []
        for r in results[:max_results]:
            output_results.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("snippet", ""),
                "source": source,
            })
            if r.get("url"):
                sources.append(r["url"])

        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "source": source,
                "results": output_results,
            },
            duration_ms=round((time.time() - start) * 1000, 2),
            sandboxed=False,
            source_url=sources[0] if sources else None,
            provenance_hint={"source": source, "result_count": len(output_results)},
        )

    async def _brave_search(self, query: str, count: int) -> Optional[List[Dict]]:
        """Search using Brave Search API."""
        try:
            async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
                resp = await client.get(
                    BRAVE_API_URL,
                    params={"q": query, "count": count},
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip",
                        "X-Subscription-Token": self._brave_api_key,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                results = []
                for item in data.get("web", {}).get("results", []):
                    results.append({
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "snippet": item.get("description", ""),
                    })
                return results
        except Exception as e:
            logger.error(f"Brave Search error: {e}")
            return None

    async def _duckduckgo_search(self, query: str) -> Optional[List[Dict]]:
        """Search using DuckDuckGo Instant Answer API."""
        try:
            async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
                resp = await client.get(
                    DUCKDUCKGO_API_URL,
                    params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
                )
                resp.raise_for_status()
                data = resp.json()
                results = []
                # Abstract
                if data.get("Abstract"):
                    results.append({
                        "title": data.get("Heading", ""),
                        "url": data.get("AbstractURL", ""),
                        "snippet": data.get("Abstract", ""),
                    })
                # Related topics
                for topic in data.get("RelatedTopics", [])[:5]:
                    if "Text" in topic:
                        results.append({
                            "title": topic.get("Text", "")[:100],
                            "url": topic.get("FirstURL", ""),
                            "snippet": topic.get("Text", ""),
                        })
                return results if results else None
        except Exception as e:
            logger.error(f"DuckDuckGo error: {e}")
            return None

    async def health_check(self) -> str:
        if self._brave_api_key:
            return "ok"
        return "degraded"  # DuckDuckGo-only mode