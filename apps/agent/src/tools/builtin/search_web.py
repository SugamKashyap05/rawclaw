import logging
import time
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
                error=error_msg,
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

    async def duckduckgo_search(self, query: str) -> Optional[List[Dict]]:
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
                for topic in data.get("RelatedTopics", [])[:10]:
                    if "Text" in topic:
                        results.append({
                            "title": topic.get("Text", "")[:100],
                            "url": topic.get("FirstURL", ""),
                            "snippet": topic.get("Text", ""),
                        })
                    elif "Topics" in topic:
                        for sub_topic in topic.get("Topics", [])[:3]:
                            results.append({
                                "title": sub_topic.get("Text", "")[:100],
                                "url": sub_topic.get("FirstURL", ""),
                                "snippet": sub_topic.get("Text", ""),
                            })
                
                return results if results else None
        except Exception as e:
            logger.error(f"DuckDuckGo error: {e}")
            return None

    async def health_check(self) -> str:
        return "ok"