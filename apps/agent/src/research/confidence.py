from __future__ import annotations

from typing import Any, Dict, Optional

from src.contracts.tool import ToolResult
from src.research.evidence_pipeline import loyalty_check, select_evidence, synthesize_answer
from src.research.types import AnswerabilityDecision, ConfidenceRiskDecision, EvidenceAssessment, ResearchPlan


class ConfidenceRiskModelStage:
    def _sports_fallback_answer(self, query: str, year: str) -> str:
        return (
            f"I searched for {query.strip()} but the pages I found did not expose live {year} IPL data I could verify.\n"
            "For current IPL results or standings, check directly:\n"
            "- https://www.iplt20.com/matches\n"
            "- https://www.iplt20.com/matches/points-table\n"
            "- https://www.cricbuzz.com/cricket-series"
        )

    def run(
        self,
        query: str,
        plan: ResearchPlan,
        assessment: EvidenceAssessment,
        answerability: AnswerabilityDecision,
        fetch_result: Optional[ToolResult],
    ) -> ConfidenceRiskDecision:
        output = fetch_result.output if fetch_result and isinstance(fetch_result.output, dict) else {}
        task = str(output.get("taskType") or plan.task_type or "research").strip()

        if fetch_result and isinstance(output, dict) and output.get("kind") == "transport_failure":
            failure_kind = str(output.get("fetchFailureKind") or "transport_failure").strip()
            reason = f"transport failure: {failure_kind}"
            if output.get("networkError"):
                reason += f" ({output.get('networkError')})"
            synthesis: Dict[str, Any] = {}
            if plan.category in {"sports_standings", "sports_results"}:
                year = next((token for token in str(query).split() if token.isdigit() and len(token) == 4), "2026")
                synthesis = {
                    "answer": self._sports_fallback_answer(query, year),
                    "answerSource": "fallback_refused",
                    "groundedFields": [],
                    "usedFallback": True,
                    "fallbackReason": reason,
                }
            return ConfidenceRiskDecision(
                mode="refused_answer",
                reason=reason,
                failure_state="transport_failure",
                synthesis=synthesis,
            )

        if fetch_result and isinstance(output, dict) and output.get("kind") == "content":
            verdict = select_evidence(output)
            synthesis = synthesize_answer(output, task)
            loyalty = loyalty_check(synthesis.answer, output)

            if not verdict.usable:
                if str(verdict.reason).startswith("empty_body"):
                    failure_state = "empty_body_js_required"
                else:
                    failure_state = "extract_failure"
                if plan.category in {"sports_standings", "sports_results"}:
                    year = next((token for token in str(query).split() if token.isdigit() and len(token) == 4), "2026")
                    synthesis = {
                        "answer": self._sports_fallback_answer(query, year),
                        "answerSource": "fallback_refused",
                        "groundedFields": [],
                        "usedFallback": True,
                        "fallbackReason": verdict.reason,
                    }
                else:
                    synthesis = synthesis.model_dump()
                return ConfidenceRiskDecision(
                    mode="refused_answer",
                    reason=verdict.reason,
                    failure_state=failure_state,
                    evidence_verdict=verdict.model_dump(),
                    synthesis=synthesis,
                    loyalty=loyalty.model_dump(),
                )

            if answerability.mode == "exact" and loyalty.loyal and not verdict.warningFlags:
                return ConfidenceRiskDecision(
                    mode="exact_answer",
                    reason="evidence is usable, loyal, and exact enough for a grounded answer",
                    failure_state="exact_answer",
                    evidence_verdict=verdict.model_dump(),
                    synthesis=synthesis.model_dump(),
                    loyalty=loyalty.model_dump(),
                )

            failure_state = "partial_extract" if verdict.evidenceSource == "page_content" else "limited_answer"
            return ConfidenceRiskDecision(
                mode="limited_answer",
                reason=verdict.reason,
                failure_state=failure_state,
                evidence_verdict=verdict.model_dump(),
                synthesis=synthesis.model_dump(),
                loyalty=loyalty.model_dump(),
            )

        if answerability.mode == "exact":
            mode = "exact_answer"
            failure_state = "exact_answer"
        elif answerability.mode == "partial":
            mode = "limited_answer"
            failure_state = "limited_answer"
        else:
            mode = "refused_answer"
            failure_state = "refused_answer"

        return ConfidenceRiskDecision(
            mode=mode,
            reason="answerability stage decision without usable fetched page content",
            failure_state=failure_state,
            evidence_verdict={},
            synthesis={},
            loyalty={},
        )
