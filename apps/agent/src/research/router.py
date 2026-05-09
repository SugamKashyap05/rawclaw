from typing import Any, Callable, Dict, List
from urllib.parse import urlparse

from src.contracts.tool import ToolResult
from src.research.types import ExtractionDecision, ResearchPlan, SourceProfile


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
        if plan.category in {"sports_standings", "sports_results"}:
            return "standings/table"
        if plan.category == "election_results":
            return "news/article"
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
        candidate_profiles: List[SourceProfile] = []
        seen_domains = set()

        def normalized_domain(url: str) -> str:
            return str(urlparse(url).hostname or "").lower().strip()

        def profile_from_ranked(ranked_entry: Dict[str, Any], url: str) -> SourceProfile:
            profile = ranked_entry.get("sourceProfile") if isinstance(ranked_entry, dict) else None
            if isinstance(profile, dict):
                return SourceProfile(**profile)
            return SourceProfile(domain=normalized_domain(url) or url)

        def add_candidate(url: str, ranked_entry: Dict[str, Any] | None = None) -> None:
            normalized = str(url or "").strip()
            domain = normalized_domain(normalized)
            if not normalized or normalized in candidate_urls or domain in seen_domains:
                return
            candidate_urls.append(normalized)
            candidate_profiles.append(profile_from_ranked(ranked_entry or {}, normalized))
            if domain:
                seen_domains.add(domain)

        for url in plan.target_urls:
            add_candidate(url)

        preferred_count = 3 if page_kind in {"standings/table", "interactive/authenticated"} or plan.comparison_needed else 2
        for ranked in ranked_results:
            add_candidate(str(ranked.get("url") or "").strip(), ranked)
            if len(candidate_urls) >= preferred_count:
                break

        if not candidate_urls:
            for item in results[:preferred_count]:
                if not isinstance(item, dict):
                    continue
                add_candidate(str(item.get("url") or item.get("link") or "").strip())

        reason = "planner-led extraction routing"
        if page_kind == "standings/table":
            reason = "table-like research task with structured standings requirements"
        elif page_kind == "docs/changelog":
            reason = "docs/changelog task that benefits from structured update extraction"
        elif page_kind == "news/article":
            reason = "news-style task that benefits from article-oriented extraction"
        elif page_kind == "interactive/authenticated":
            reason = "interaction-required task that may need browser/session tooling"

        diversity_status = "no_candidates"
        if candidate_urls:
            diversity_status = "diverse" if len({profile.domain for profile in candidate_profiles if profile.domain}) > 1 else "single_domain"

        primary_profile = candidate_profiles[0] if candidate_profiles else None
        primary_prefers_article_search = (
            primary_profile is not None
            and primary_profile.preferredAccessMethod == "search-for-article"
        )
        all_candidates_prefer_article_search = bool(candidate_profiles) and all(
            profile.preferredAccessMethod == "search-for-article"
            for profile in candidate_profiles
        )
        needs_query_broadening = bool(
            candidate_urls
            and (diversity_status == "single_domain" or all_candidates_prefer_article_search)
            and primary_prefers_article_search
            and not plan.allow_interaction
            and not plan.official_source_requested
        )
        if needs_query_broadening:
            reason = "search results collapsed to a single low-reliability domain; broaden search before extraction"

        return ExtractionDecision(
            page_kind=page_kind,
            backend_order=backend_order,
            allow_interaction=plan.allow_interaction,
            candidate_urls=candidate_urls[:3],
            candidate_profiles=candidate_profiles[:3],
            reason=reason,
            should_attempt_extract=bool(candidate_urls) and not needs_query_broadening and (plan.fetch_required or plan.exact_structured_data_needed or has_viable_search_results),
            has_viable_search_results=has_viable_search_results,
            ranked_results=ranked_results[:5],
            needs_query_broadening=needs_query_broadening,
            diversity_status=diversity_status,
        )
