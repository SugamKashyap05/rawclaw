from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.contracts.tool import ToolResult
from src.research.adaptive_store import AdaptiveResearchStore
from src.research.parallel import ParallelExecutor
from src.research.types import ConfidenceRiskDecision, ResearchContext


class SelfLearningLoop:
    def __init__(self, store: AdaptiveResearchStore, parallel_executor: ParallelExecutor) -> None:
        self._store = store
        self._parallel = parallel_executor

    async def record_outcome(
        self,
        *,
        context: ResearchContext,
        confidence_risk: ConfidenceRiskDecision,
        search_result: ToolResult,
        fetch_result: Optional[ToolResult],
    ) -> None:
        search_output = search_result.output if isinstance(search_result.output, dict) else {}
        search_results = search_output.get("results", []) if isinstance(search_output, dict) else []
        fetch_output = fetch_result.output if fetch_result and isinstance(fetch_result.output, dict) else {}

        trusted_urls: List[str] = []
        if confidence_risk.mode in {"exact_answer", "limited_answer"}:
            for item in search_results[:3]:
                if not isinstance(item, dict):
                    continue
                if "official_page" in [str(tag).strip().lower() for tag in (item.get("quality_tags") or [])]:
                    url = str(item.get("url") or "").strip()
                    if url:
                        trusted_urls.append(url)
            if fetch_result and not fetch_result.error:
                fetch_url = str(fetch_output.get("url") or fetch_result.source_url or "").strip()
                if fetch_url:
                    trusted_urls.append(fetch_url)

        async def _record_trusted(url: str) -> None:
            self._store.record_trusted_source(url)

        await self._parallel.run(_record_trusted(url) for url in dict.fromkeys(trusted_urls))

        if confidence_risk.mode == "refused_answer":
            failed_url = ""
            if fetch_result:
                failed_url = str(fetch_output.get("url") or fetch_result.source_url or "").strip()
            elif context.selected_urls:
                failed_url = context.selected_urls[0]
            if failed_url:
                self._store.record_failure(
                    url=failed_url,
                    stage="post_response",
                    failure_kind=confidence_risk.failure_state or "refused_answer",
                    details=confidence_risk.reason,
                )
