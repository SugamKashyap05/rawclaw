import logging
import time
from typing import Any, Dict, List, Optional

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.tools.builtin.search_web import DuckDuckGoSearchTool
from src.models.router import ModelRouter
from src.memory.knowledge_brain import KnowledgeBrain

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

        # 2. Synthesis Prompt
        blocks = []
        
        if web_results:
            blocks.append("### WEB SEARCH RESULTS")
            for i, r in enumerate(web_results[:8 if depth == "deep" else 5]):
                blocks.append(f"SOURCE W{i+1}: {r.get('title')}\nURL: {r.get('url')}\nSNIPPET: {r.get('snippet')}")
        
        if brain_results["external"]:
            blocks.append("### WIKIPEDIA KNOWLEDGE")
            for i, r in enumerate(brain_results["external"]):
                blocks.append(f"SOURCE K{i+1}: {r.get('source')}\nCONTENT: {r.get('content')[:1000]}")

        if brain_results["internal"]:
            blocks.append("### INTERNAL MEMORY RECALL")
            for i, r in enumerate(brain_results["internal"]):
                blocks.append(f"SOURCE M{i+1}: Local Context ({r.get('collection')})\nCONTENT: {r.get('content')}")

        context_block = "\n\n".join(blocks)

        system_prompt = (
            "You are a Senior Research Analyst for RawClaw. "
            "Your task is to synthesize the following search results and local knowledge into a professional report.\n\n"
            "REPORT GUIDELINES:\n"
            "1. Be objective, factual, and thorough.\n"
            "2. Use Markdown formatting (headings, lists, bold text).\n"
            "3. INTEGRATE CITATIONS in the format [Source W1], [Source K2], or [Source M1].\n"
            "4. Add a 'Sources' section at the end listing titles and URLs where available.\n"
            f"5. Focus: {focus}\n\n"
            "Retrieved Context:\n"
            f"{context_block}"
        )

        user_prompt = f"Provide a {depth} synthesis for the query: {query}"

        # 3. Call High Complexity Model for Synthesis
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
                "synthesis_model": "high_complexity",
                "engine": "duckduckgo",
                "depth": depth
            }
        )

    async def health_check(self) -> str:
        search_health = await self.search_tool.health_check()
        return search_health
