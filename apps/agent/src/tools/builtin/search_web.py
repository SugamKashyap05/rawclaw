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
        """Search using DuckDuckGo Html directly and fallback to Wikipedia if needed."""
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
                        
                        snippet = snippet_elem.text.strip()
                        results.append({
                            "title": title,
                            "url": url,
                            "snippet": snippet,
                        })
        except Exception as e:
            logger.warning(f"DuckDuckGo search failed, will fallback: {e}")

        if not results:
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
        
        return results if results else None

    async def health_check(self) -> str:
        return "ok"