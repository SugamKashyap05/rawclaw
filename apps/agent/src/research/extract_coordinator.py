from __future__ import annotations

from typing import List

from src.research.adaptive_fetch import AdaptiveFetchLayer, ExtractAttemptPlan
from src.research.types import ExtractionDecision, ResearchPlan


class MultiAttemptExtractCoordinator:
    def __init__(self, adaptive_fetch_layer: AdaptiveFetchLayer) -> None:
        self._adaptive_fetch_layer = adaptive_fetch_layer

    def run(self, plan: ResearchPlan, extraction_decision: ExtractionDecision) -> List[ExtractAttemptPlan]:
        candidate_urls = [str(url).strip() for url in extraction_decision.candidate_urls if str(url).strip()]
        if not candidate_urls:
            return []
        return self._adaptive_fetch_layer.build_attempt_plan(candidate_urls, extraction_decision.backend_order)
