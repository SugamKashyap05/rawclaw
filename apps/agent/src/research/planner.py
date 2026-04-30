from typing import Any, Callable, Dict, List

from src.research.types import ResearchPlan


class ResearchPlannerStage:
    def __init__(
        self,
        build_research_plan: Callable[[str], Dict[str, Any]],
        build_search_query: Callable[[str, bool], str],
        query_allows_interactive_extraction: Callable[[str], bool],
    ) -> None:
        self._build_research_plan = build_research_plan
        self._build_search_query = build_search_query
        self._query_allows_interactive_extraction = query_allows_interactive_extraction

    def run(self, query: str) -> ResearchPlan:
        base_plan = self._build_research_plan(query)
        queries: List[str] = []
        target_urls: List[str] = []

        primary = self._build_search_query(query, True)
        simplified = self._build_search_query(query, False)
        for candidate in [primary, simplified]:
            normalized = str(candidate or "").strip()
            if normalized and normalized not in queries:
                queries.append(normalized)

        lowered = (query or "").lower()
        if base_plan.get("category") == "sports_standings":
            targeted = primary
            if "chennai super kings" in lowered or "csk" in lowered:
                targeted = "Chennai Super Kings IPL 2026 points table standings"
                if base_plan.get("domain_bias"):
                    targeted += " site:" + str(base_plan["domain_bias"][0])
            if targeted and targeted not in queries:
                queries.append(targeted)
            if "ipl" in lowered and "iplt20.com" in [str(item).strip().lower() for item in (base_plan.get("domain_bias") or [])]:
                target_urls.append("https://www.iplt20.com/matches/points-table")

        return ResearchPlan(
            lane="research",
            task_type=str(base_plan.get("task_type") or base_plan.get("category") or "research"),
            queries=queries[:3],
            expected_fields=[str(item) for item in (base_plan.get("expected_fields") or []) if str(item)],
            target_urls=target_urls,
            needs_freshness=bool(base_plan.get("recency_matters")),
            recency_matters=bool(base_plan.get("recency_matters")),
            allow_interaction=self._query_allows_interactive_extraction(query),
            category=str(base_plan.get("category") or ""),
            comparison_needed=bool(base_plan.get("comparison_needed")),
            fetch_required=bool(base_plan.get("fetch_required")),
            source_preferences=[str(item) for item in (base_plan.get("source_preferences") or []) if str(item)],
            focus=[str(item) for item in (base_plan.get("focus") or []) if str(item)],
            domain_bias=[str(item) for item in (base_plan.get("domain_bias") or []) if str(item)],
            exact_structured_data_needed=bool(base_plan.get("exact_structured_data_needed")),
        )
