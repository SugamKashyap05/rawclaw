from typing import Any, Callable, Dict, List, Optional

from src.contracts.tool import ToolResult
from src.research.types import EvidenceAssessment, ResearchPlan


class EvidenceJudgeStage:
    def __init__(
        self,
        extract_search_evidence: Callable[[ToolResult, str, int], List[Dict[str, str]]],
        dedupe_evidence: Callable[[List[Dict[str, str]], int], List[Dict[str, str]]],
        build_research_evidence_records: Callable[[str, List[Dict[str, str]], Optional[ToolResult]], List[Dict[str, Any]]],
        cluster_research_records: Callable[[List[Dict[str, Any]]], List[Dict[str, Any]]],
        evaluate_answerability: Callable[[str, List[Dict[str, str]], Optional[ToolResult], List[Dict[str, Any]], List[Dict[str, Any]]], Dict[str, Any]],
        cluster_summary_clause: Callable[[Dict[str, Any]], str],
    ) -> None:
        self._extract_search_evidence = extract_search_evidence
        self._dedupe_evidence = dedupe_evidence
        self._build_research_evidence_records = build_research_evidence_records
        self._cluster_research_records = cluster_research_records
        self._evaluate_answerability = evaluate_answerability
        self._cluster_summary_clause = cluster_summary_clause

    def run(
        self,
        query: str,
        plan: ResearchPlan,
        search_result: ToolResult,
        fetch_result: Optional[ToolResult],
    ) -> EvidenceAssessment:
        search_evidence = self._dedupe_evidence(self._extract_search_evidence(search_result, query=query, max_items=4), limit=4)
        records = self._build_research_evidence_records(query, search_evidence, fetch_result)
        clusters = self._cluster_research_records(records)
        answerability = self._evaluate_answerability(query, search_evidence, fetch_result, records, clusters)

        duplicate_collapsed = any(int(item.get("duplicate_source_count") or 1) > 1 for item in search_evidence)
        fetch_output = fetch_result.output if fetch_result and isinstance(fetch_result.output, dict) else {}
        missing_fields = [str(item) for item in (fetch_output.get("missingFields") or []) if str(item)]
        best_evidence = [
            self._cluster_summary_clause(cluster)
            for cluster in clusters[:3]
            if self._cluster_summary_clause(cluster)
        ]

        quality = "insufficient"
        if answerability.get("sufficient"):
            quality = "sufficient"
        elif answerability.get("partial"):
            quality = "partial"
        elif answerability.get("fetch_quality") == "relevant_but_unusable_fetch":
            quality = "relevant_but_unusable"
        elif answerability.get("relevant"):
            quality = "relevant_only"

        return EvidenceAssessment(
            relevant=bool(answerability.get("relevant")),
            usable=bool(answerability.get("usable")),
            sufficient=bool(answerability.get("sufficient")),
            quality=quality,
            reasons=[str(item) for item in (answerability.get("reasons") or []) if str(item)],
            missing_fields=missing_fields,
            duplicate_collapsed=duplicate_collapsed,
            best_evidence=best_evidence,
            partial=bool(answerability.get("partial")),
            abstain=bool(answerability.get("abstain")),
            fetch_quality=str(answerability.get("fetch_quality") or ""),
            search_evidence=search_evidence,
            records=records,
            clusters=clusters,
            evidence_breakdown=dict(answerability.get("evidence_breakdown") or {}),
            corroboration_mode=str(answerability.get("corroboration_mode") or ""),
            freshness_summary=str(answerability.get("freshness_summary") or ""),
        )
