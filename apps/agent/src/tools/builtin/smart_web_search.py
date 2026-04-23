import json
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
        # Prefer built-in search tools over MCP tools for better compatibility
        search_tool = TOOL_REGISTRY.get_optional("duckduckgo_search")
        tool_source = "built-in"
        if not search_tool:
            search_tool = TOOL_REGISTRY.get_optional("search")  # MCP search tool
            tool_source = "MCP"
        
        if not search_tool:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="No underlying search tools (built-in or MCP) found in registry.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        logger.info(f"SmartWebSearch using: {search_tool.name} ({tool_source})")
        
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

        # Debug log the search tool output
        logger.info(f"SmartWebSearch: search tool '{search_tool.name}' returned: {search_res.output}")

        results = []
        if isinstance(search_res.output, dict):
            # Handle different MCP search result formats
            if "results" in search_res.output:
                results = search_res.output.get("results", [])
            elif "content" in search_res.output:
                # MCP tools may return content directly
                content = search_res.output.get("content")
                if content and isinstance(content, str):
                    # Try to parse JSON content if it's a string
                    try:
                        parsed = json.loads(content)
                        if isinstance(parsed, dict) and "results" in parsed:
                            results = parsed.get("results", [])
                        elif isinstance(parsed, list):
                            results = parsed
                    except json.JSONDecodeError:
                        # Not JSON, treat as plain text result
                        results = [{"snippet": content, "content": content}]
            elif "items" in search_res.output:
                results = search_res.output.get("items", [])
        elif isinstance(search_res.output, list):
            results = search_res.output
            
        if not results:
            logger.warning(f"SmartWebSearch: No results extracted from search tool output: {search_res.output}")
            return ToolResult(
                tool_name=self.name,
                input=input,
                output={"results": [], "message": "No results found."},
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

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
                    
                    # Check for placeholder-like or incomplete content
                    if self._is_placeholder_content(content):
                        result_quality = "weak"
                        enriched["quality_note"] = "placeholder_or_incomplete"
            
            enriched_results.append(enriched)
        
        # If no results or all results appear placeholder-like, mark quality as weak
        if not enriched_results or all("quality_note" in r for r in enriched_results):
            result_quality = "weak"

        duration_ms = round((time.time() - start) * 1000, 2)
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "source_engine": search_tool.name,
                "results": enriched_results,
                "fetch_count": len(fetch_tasks),
                "result_quality": result_quality,
                "quality_assessment": "Results may be incomplete or placeholder-like" if result_quality == "weak" else "Results appear reliable"
            },
            duration_ms=duration_ms,
            sandboxed=False,
            provenance_hint={
                "engine": search_tool.name,
                "results_count": len(enriched_results),
                "fetched_count": len(fetch_tasks),
                "result_quality": result_quality
            }
        )

    def _is_placeholder_content(self, content: str) -> bool:
        """Check if content appears to be placeholder-like or incomplete."""
        if not content or len(content.strip()) <<  100:
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
        if len(words) <<  50:  # Very short content
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
