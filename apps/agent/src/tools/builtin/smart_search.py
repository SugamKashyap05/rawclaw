"""
SmartSearchTool — Deep search with AI synthesis.

Executes a web search and uses a high-complexity model to synthesize results 
into a comprehensive report with citations.
"""
import logging
import time
from typing import Any, Dict, List, Optional

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.tools.builtin.search_web import SearchWebTool
from src.models.router import ModelRouter

logger = logging.getLogger("rawclaw.tools.smart_search")

class SmartSearchTool(BaseTool):
    name = "smart_search"
    description = (
        "Performs a deep web search and synthesizes findings into a professional report. "
        "Best for complex research questions requiring verified facts and citations."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The research query or question.",
            },
            "depth": {
                "type": "string",
                "enum": ["standard", "deep"],
                "description": "Research depth. 'deep' retrieves more sources.",
                "default": "standard",
            },
            "focus": {
                "type": "string",
                "description": "Specific focus area for the report (e.g., technical, financial, clinical).",
                "default": "comprehensive",
            },
        },
        "required": ["query"],
    }
    capability_tags = ["search", "research", "synthesis"]
    requires_sandbox = False
    requires_confirmation = False

    def __init__(self) -> None:
        self.search_tool = SearchWebTool()
        self.model_router = ModelRouter()

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start = time.time()
        query = input.get("query", "")
        depth = input.get("depth", "standard")
        focus = input.get("focus", "comprehensive")

        if not query:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Query cannot be empty",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        max_search_results = 8 if depth == "deep" else 5
        
        # 1. Search
        search_results = await self.search_tool.brave_search(query, max_search_results)
        source = "brave"
        if search_results is None:
            search_results = await self.search_tool.duckduckgo_search(query)
            source = "duckduckgo"

        if not search_results:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Could not find any search results for this query.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # 2. Synthesis Prompt
        context_block = "\n\n".join([
            f"SOURCE {i+1}: {r.get('title')}\nURL: {r.get('url')}\nSNIPPET: {r.get('snippet')}"
            for i, r in enumerate(search_results)
        ])

        system_prompt = (
            "You are a Senior Research Analyst for RawClaw. "
            "Your task is to synthesize the following search results into a professional report.\n\n"
            "REPORT GUIDELINES:\n"
            "1. Be objective, factual, and thorough.\n"
            "2. Use Markdown formatting (headings, lists, bold text).\n"
            "3. INTEGRATE CITATIONS in the format [Source N] or [Source N, M].\n"
            "4. Add a 'Sources' section at the end listing titles and URLs.\n"
            f"5. Focus: {focus}\n\n"
            "Retrieved Context:\n"
            f"{context_block}"
        )

        user_prompt = f"Provide a {depth} synthesis for the query: {query}"

        # 3. Call High Complexity Model for Synthesis
        # We use complexity="high" to trigger the best local/cloud model
        accumulated_report = ""
        try:
            async for chunk in self.model_router.complete(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                complexity="high"
            ):
                if isinstance(chunk, str):
                    accumulated_report += chunk
                elif isinstance(chunk, dict) and chunk.get("type") == "content":
                    accumulated_report += chunk.get("content", "")
        except Exception as e:
            logger.error(f"Synthesis failed: {e}")
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Research synthesis failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        duration_ms = round((time.time() - start) * 1000, 2)
        
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "report": accumulated_report,
                "sources_scanned": len(search_results),
                "search_engine": source
            },
            duration_ms=duration_ms,
            sandboxed=False,
            source_url=search_results[0].get("url") if search_results else None,
            provenance_hint={
                "synthesis_model": "high_complexity",
                "source": source,
                "depth": depth
            }
        )

    async def health_check(self) -> str:
        search_health = await self.search_tool.health_check()
        return search_health
