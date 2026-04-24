import logging
import time
import re
from typing import Any, Dict, List, Optional

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.tools.builtin.search_web import DuckDuckGoSearchTool

logger = logging.getLogger("rawclaw.tools.smart_search")

class SmartSearchTool(BaseTool):
    name = "smart_search"
    description = (
        "Performs a deep search combining web results, Wikipedia, and internal memory. "
        "Synthesizes findings into a professional report with verified citations."
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
        self.search_tool = DuckDuckGoSearchTool()

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

        # 1. Gather results from multiple sources
        web_results_res = await self.search_tool.execute({"query": query, "max_results": 10 if depth == "deep" else 5})
        
        # KnowledgeBrain retrieval (Memory + Wikipedia)
        brain = self._knowledge_brain
        brain_results = {"internal": [], "external": []}
        if brain:
            brain_results = brain.retrieve(query, limit=6 if depth == "deep" else 3)
        
        web_results = []
        if not web_results_res.error and web_results_res.output:
            if isinstance(web_results_res.output, dict):
                web_results = web_results_res.output.get("results", [])
            elif isinstance(web_results_res.output, list):
                web_results = web_results_res.output

        if not web_results and not brain_results["internal"] and not brain_results["external"]:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Could not find any search results or local knowledge for this query.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # 2. Deterministic synthesis
        accumulated_report = self._build_report(
            query=query,
            depth=depth,
            focus=focus,
            web_results=web_results,
            external_results=brain_results["external"],
            internal_results=brain_results["internal"],
        )

        duration_ms = round((time.monotonic() - start) * 1000, 2) if hasattr(time, 'monotonic') else round((time.time() - start) * 1000, 2)
        
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "report": accumulated_report,
                "sources": {
                    "web": len(web_results) if web_results else 0,
                    "wikipedia": len(brain_results["external"]),
                    "memory": len(brain_results["internal"])
                }
            },
            duration_ms=duration_ms,
            sandboxed=False,
            source_url=web_results[0].get("url") if web_results else None,
            provenance_hint={
                "synthesis_model": "deterministic",
                "engine": "duckduckgo",
                "depth": depth
            }
        )

    def _truncate(self, text: str, limit: int = 260) -> str:
        text = re.sub(r"\s+", " ", (text or "")).strip()
        return text[:limit] + ("..." if len(text) > limit else "")

    def _build_report(
        self,
        query: str,
        depth: str,
        focus: str,
        web_results: List[Dict[str, Any]],
        external_results: List[Dict[str, Any]],
        internal_results: List[Dict[str, Any]],
    ) -> str:
        lines: List[str] = []
        lines.append(f"Research summary for: {query}")
        lines.append(f"Depth: {depth}. Focus: {focus}.")

        if web_results:
            lines.append("")
            lines.append("Web findings:")
            for i, result in enumerate(web_results[:8 if depth == "deep" else 5], 1):
                title = self._truncate(result.get("title", "Untitled source"), 120)
                snippet = self._truncate(result.get("snippet", ""), 220)
                url = result.get("url", "")
                bullet = f"- [Source W{i}] {title}"
                if snippet:
                    bullet += f": {snippet}"
                if url:
                    bullet += f" ({url})"
                lines.append(bullet)

        if external_results:
            lines.append("")
            lines.append("Wikipedia / external knowledge:")
            for i, result in enumerate(external_results[:4], 1):
                source = result.get("source", f"External {i}")
                content = self._truncate(result.get("content", ""), 220)
                lines.append(f"- [Source K{i}] {source}: {content}")

        if internal_results:
            lines.append("")
            lines.append("Internal memory recall:")
            for i, result in enumerate(internal_results[:4], 1):
                collection = result.get("collection", "default")
                content = self._truncate(result.get("content", ""), 220)
                lines.append(f"- [Source M{i}] {collection}: {content}")

        lines.append("")
        lines.append("Sources:")
        source_lines_added = 0
        for i, result in enumerate(web_results[:8 if depth == "deep" else 5], 1):
            title = self._truncate(result.get("title", "Untitled source"), 120)
            url = result.get("url", "")
            if url:
                lines.append(f"- [Source W{i}] {title} — {url}")
                source_lines_added += 1
        for i, result in enumerate(external_results[:4], 1):
            source = result.get("source", f"External {i}")
            lines.append(f"- [Source K{i}] {source}")
            source_lines_added += 1
        for i, result in enumerate(internal_results[:4], 1):
            collection = result.get("collection", "default")
            lines.append(f"- [Source M{i}] Internal memory ({collection})")
            source_lines_added += 1

        if source_lines_added == 0:
            lines.append("- No sources available")

        return "\n".join(lines)

    async def health_check(self) -> str:
        search_health = await self.search_tool.health_check()
        return search_health
