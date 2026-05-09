import logging
from typing import Callable, List, Optional

from src.contracts.tool import ToolResult
from src.research.types import AnswerabilityDecision, EvidenceAssessment, FinalDraft, ResearchPlan


logger = logging.getLogger("rawclaw.research.writer")


class FinalWriterStage:
    def __init__(
        self,
        render_grounded_web_answer: Callable[..., str],
        build_source_lines: Callable[[List[dict], int], List[str]],
        fetch_source_line: Callable[[Optional[ToolResult]], Optional[str]],
        is_provider_outage_status: Callable[[str], bool],
    ) -> None:
        self._render_grounded_web_answer = render_grounded_web_answer
        self._build_source_lines = build_source_lines
        self._fetch_source_line = fetch_source_line
        self._is_provider_outage_status = is_provider_outage_status

    def run(
        self,
        query: str,
        plan: ResearchPlan,
        assessment: EvidenceAssessment,
        decision: AnswerabilityDecision,
        search_result: ToolResult,
        fetch_result: Optional[ToolResult],
        search_status: str,
        fetch_status: str,
    ) -> FinalDraft:
        evidence = assessment.search_evidence or []
        evidence_chars = sum(
            len(str(item.get("title") or ""))
            + len(str(item.get("snippet") or ""))
            + len(str(item.get("url") or ""))
            for item in evidence
            if isinstance(item, dict)
        )
        source_count = len({
            str(item.get("url") or "").strip()
            for item in evidence
            if isinstance(item, dict) and str(item.get("url") or "").strip()
        })
        logger.debug(
            "[SYNTHESIS_HANDOFF] query=%r category=%s decision=%s "
            "evidence_count=%d search_status=%s fetch_status=%s "
            "fetch_quality=%s source_count=%d evidence_chars=%d",
            query[:160],
            plan.category,
            decision.mode,
            len(evidence),
            search_status,
            fetch_status,
            assessment.quality,
            source_count,
            evidence_chars,
        )

        markdown = self._render_grounded_web_answer(
            query,
            search_result,
            fetch_result,
            search_status=search_status,
            fetch_status=fetch_status,
            plan_override=plan.model_dump(),
            evidence_override=assessment.search_evidence,
            assessment_override=assessment.model_dump(),
            answerability_override=decision.model_dump(),
        )
        logger.debug(
            "[SYNTHESIS_RENDERED] query=%r category=%s decision=%s rendered_chars=%d",
            query[:160],
            plan.category,
            decision.mode,
            len(markdown or ""),
        )

        confidence = "grounded" if decision.mode == "exact" else "limited"
        if self._is_provider_outage_status(search_status) and not assessment.search_evidence:
            confidence = "provider-outage"

        citations_or_sources = self._build_source_lines(assessment.search_evidence, limit=3)
        fetch_line = self._fetch_source_line(fetch_result)
        if fetch_line and fetch_line not in citations_or_sources:
            citations_or_sources.append(fetch_line)

        return FinalDraft(
            markdown=markdown,
            confidence=confidence,
            citations_or_sources=citations_or_sources[:4],
            limitations=decision.limitations,
        )
