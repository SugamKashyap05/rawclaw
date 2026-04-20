import logging
import time
import asyncio
from typing import Any, Dict, List, Optional

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.web_fetch import WebFetchTool

logger = logging.getLogger("rawclaw.tools.web_search")

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
        # Prefer MCP google_search if available, otherwise use builtin duckduckgo_search
        search_tool = TOOL_REGISTRY.get_optional("google_search")
        if not search_tool:
            search_tool = TOOL_REGISTRY.get_optional("duckduckgo_search")
        
        if not search_tool:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="No underlying search tools (google_search or duckduckgo_search) found in registry.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        logger.info(f"SmartWebSearch using: {search_tool.name}")
        
        # 2. Perform Search
        search_res = await search_tool.execute({"query": query, "max_results": max_results})
        if search_res.error:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Underlying search failed: {search_res.error}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        results = []
        if isinstance(search_res.output, dict):
            results = search_res.output.get("results", [])
        elif isinstance(search_res.output, list):
            results = search_res.output
            
        if not results:
            return ToolResult(
                tool_name=self.name,
                input=input,
                output={"results": [], "message": "No results found."},
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # 3. Automatic Fetching of Top Results
        top_results = results[:fetch_top]
        fetch_tasks = []
        for res in top_results:
            url = res.get("url")
            if url:
                fetch_tasks.append(self.fetch_tool.execute({"url": url}))
        
        fetch_results = await asyncio.gather(*fetch_tasks) if fetch_tasks else []
        
        # 4. Consolidate Output
        enriched_results = []
        for i, res in enumerate(results):
            enriched = {
                "title": res.get("title"),
                "url": res.get("url"),
                "snippet": res.get("snippet"),
            }
            # Attach full content if we fetched it
            if i < len(fetch_results):
                f_res = fetch_results[i]
                if not f_res.error and f_res.output:
                    # Limit content size for the tool return payload
                    content = f_res.output.get("content", "")
                    enriched["full_content"] = content[:3000] + ("..." if len(content) > 3000 else "")
            
            enriched_results.append(enriched)

        duration_ms = round((time.time() - start) * 1000, 2)
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "source_engine": search_tool.name,
                "results": enriched_results,
                "fetch_count": len(fetch_tasks)
            },
            duration_ms=duration_ms,
            sandboxed=False,
            provenance_hint={
                "engine": search_tool.name,
                "results_count": len(enriched_results),
                "fetched_count": len(fetch_tasks)
            }
        )

    async def health_check(self) -> str:
        # Check if at least one underlying engine is healthy
        engines = ["google_search", "duckduckgo_search"]
        for eng in engines:
            tool = TOOL_REGISTRY.get_optional(eng)
            if tool and await tool.health_check() == "ok":
                return "ok"
        return "degraded"
