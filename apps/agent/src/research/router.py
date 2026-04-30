from typing import Any, Callable, Dict, List

from src.contracts.tool import ToolResult
from src.research.types import ExtractionDecision, ResearchPlan


class ExtractRouterStage:
    def __init__(
        self,
        rank_search_results: Callable[[str, List[Dict[str, Any]]], List[Dict[str, Any]]],
        search_result_has_viable_results: Callable[[ToolResult, str], bool],
    ) -> None:
        self._rank_search_results = rank_search_results
        self._search_result_has_viable_results = search_result_has_viable_results

    def _page_kind(self, plan: ResearchPlan) -> str:
        if plan.allow_interaction:
            return "interactive/authenticated"
        if plan.category == "sports_standings":
            return "standings/table"
        if plan.category in {"product_company_updates", "technical_research"}:
            return "docs/changelog"
        if plan.category == "breaking_news":
            return "news/article"
        return "general"

    def _backend_order(self, page_kind: str) -> List[str]:
        if page_kind == "interactive/authenticated":
            return ["opencli", "playwright", "crawl4ai", "reader", "web_fetch"]
        if page_kind == "standings/table":
            return ["crawl4ai", "playwright", "opencli", "reader", "web_fetch"]
        if page_kind == "docs/changelog":
            return ["crawl4ai", "reader", "playwright", "opencli", "web_fetch"]
        if page_kind == "news/article":
            return ["crawl4ai", "reader", "playwright", "opencli", "web_fetch"]
        return ["crawl4ai", "playwright", "reader", "opencli", "web_fetch"]

    def run(self, query: str, plan: ResearchPlan, search_result: ToolResult) -> ExtractionDecision:
        results = (search_result.output or {}).get("results", []) if isinstance(search_result.output, dict) else []
        ranked_results = self._rank_search_results(query, results)
        page_kind = self._page_kind(plan)
        backend_order = self._backend_order(page_kind)
        has_viable_search_results = self._search_result_has_viable_results(search_result, query)

        candidate_urls: List[str] = []
        for url in plan.target_urls:
            normalized = str(url or "").strip()
            if normalized and normalized not in candidate_urls:
                candidate_urls.append(normalized)

        preferred_count = 3 if page_kind in {"standings/table", "interactive/authenticated"} or plan.comparison_needed else 2
        for ranked in ranked_results[:preferred_count]:
            normalized = str(ranked.get("url") or "").strip()
            if normalized and normalized not in candidate_urls:
                candidate_urls.append(normalized)

        if not candidate_urls:
            for item in results[:preferred_count]:
                if not isinstance(item, dict):
                    continue
                normalized = str(item.get("url") or item.get("link") or "").strip()
                if normalized and normalized not in candidate_urls:
                    candidate_urls.append(normalized)

        reason = "planner-led extraction routing"
        if page_kind == "standings/table":
            reason = "table-like research task with structured standings requirements"
        elif page_kind == "docs/changelog":
            reason = "docs/changelog task that benefits from structured update extraction"
        elif page_kind == "news/article":
            reason = "news-style task that benefits from article-oriented extraction"
        elif page_kind == "interactive/authenticated":
            reason = "interaction-required task that may need browser/session tooling"

        return ExtractionDecision(
            page_kind=page_kind,
            backend_order=backend_order,
            allow_interaction=plan.allow_interaction,
            candidate_urls=candidate_urls[:3],
            reason=reason,
            should_attempt_extract=bool(candidate_urls) and (plan.fetch_required or plan.exact_structured_data_needed or has_viable_search_results),
            has_viable_search_results=has_viable_search_results,
            ranked_results=ranked_results[:5],
        )
