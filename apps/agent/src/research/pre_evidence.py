from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

from src.contracts.tool import ToolResult
from src.research.types import PreEvidenceDecision, ResearchPlan


class PreEvidenceFilterStage:
    def __init__(
        self,
        rank_search_results: Callable[[str, List[Dict[str, Any]]], List[Dict[str, Any]]],
    ) -> None:
        self._rank_search_results = rank_search_results

    def _result_domains(self, plan: ResearchPlan) -> List[str]:
        return [str(domain).strip().lower() for domain in plan.domain_bias if str(domain).strip()]

    def run(
        self,
        query: str,
        plan: ResearchPlan,
        search_result: ToolResult,
    ) -> Tuple[ToolResult, PreEvidenceDecision]:
        output = search_result.output if isinstance(search_result.output, dict) else {}
        results = output.get("results", []) if isinstance(output, dict) else []
        if not isinstance(results, list) or not results:
            decision = PreEvidenceDecision(
                original_result_count=0,
                filtered_result_count=0,
                kept_results=[],
                rejected_results=[],
                reason="no search results available to pre-filter",
                preferred_domains=self._result_domains(plan),
            )
            return search_result, decision

        ranked = self._rank_search_results(query, results)
        preferred_domains = self._result_domains(plan)
        kept: List[Dict[str, Any]] = []
        rejected: List[Dict[str, Any]] = []
        seen = set()

        ranked = sorted(
            [entry for entry in ranked if isinstance(entry, dict)],
            key=lambda item: float(item.get("score", 0) or 0),
            reverse=True,
        )
        for ranked_entry in ranked:
            item = ranked_entry.get("item") if isinstance(ranked_entry, dict) else None
            score = float(ranked_entry.get("score", 0) or 0) if isinstance(ranked_entry, dict) else 0.0
            url = str((item or {}).get("url") or "").strip()
            title = str((item or {}).get("title") or "").strip()
            snippet = str((item or {}).get("snippet") or "").strip()
            tags = [str(tag).strip().lower() for tag in ((item or {}).get("quality_tags") or []) if str(tag).strip()]

            if not url:
                rejected.append({"reason": "missing_url", "title": title, "url": url})
                continue

            dedupe_key = (url.lower(), title.lower(), snippet[:160].lower())
            if dedupe_key in seen:
                rejected.append({"reason": "duplicate_result", "title": title, "url": url})
                continue
            seen.add(dedupe_key)

            official_or_biased = any(domain and domain in url.lower() for domain in preferred_domains) or "official_page" in tags
            weak_snippet = score <= 0 and not official_or_biased
            if weak_snippet:
                rejected.append({"reason": "weak_relevance", "title": title, "url": url, "score": score})
                continue

            if (
                plan.exact_structured_data_needed
                and "search_snippet" in tags
                and not official_or_biased
                and score < 6
            ):
                rejected.append({"reason": "snippet_only_insufficient_for_structured_task", "title": title, "url": url, "score": score})
                continue

            normalized = dict(item or {})
            normalized["preEvidenceScore"] = score
            kept.append(normalized)
            if len(kept) >= 5:
                break

        snippet_only_insufficient = bool(kept) and plan.exact_structured_data_needed and all(
            "official_page" not in [str(tag).strip().lower() for tag in (item.get("quality_tags") or [])]
            for item in kept
        )
        warning_flags: List[str] = []
        if snippet_only_insufficient:
            warning_flags.append("snippet_only_insufficient")
        if len(rejected) > len(kept):
            warning_flags.append("high_rejection_rate")

        filtered_output = dict(output)
        filtered_output["results"] = kept
        filtered_output["preEvidence"] = {
            "filteredResultCount": len(kept),
            "originalResultCount": len(results),
            "warningFlags": warning_flags,
        }
        filtered_result = search_result.model_copy(deep=True)
        filtered_result.output = filtered_output
        filtered_result.provenance_hint = filtered_output

        reason = "search evidence was filtered for stronger candidates"
        if snippet_only_insufficient:
            reason = "search evidence was filtered, but remaining results are still snippet-heavy for a structured task"
        elif not kept:
            reason = "all search results were too weak or duplicative after filtering"

        decision = PreEvidenceDecision(
            original_result_count=len(results),
            filtered_result_count=len(kept),
            kept_results=kept,
            rejected_results=rejected[:8],
            reason=reason,
            warning_flags=warning_flags,
            snippet_only_insufficient=snippet_only_insufficient,
            preferred_domains=preferred_domains,
        )
        return filtered_result, decision
