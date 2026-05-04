from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List
from urllib.parse import urlparse

from src.research.adaptive_store import AdaptiveResearchStore
from src.research.types import AdaptiveDomainProfile


@dataclass
class ExtractAttemptPlan:
    url: str
    backend_order: List[str]
    reason: str
    domain_profile: AdaptiveDomainProfile


class AdaptiveFetchLayer:
    def __init__(self, store: AdaptiveResearchStore) -> None:
        self._store = store

    def domain_memory_check(self, url: str) -> AdaptiveDomainProfile:
        return self._store.get_domain_profile(url)

    def prioritize_backend_order(self, url: str, backend_order: List[str]) -> List[str]:
        profile = self.domain_memory_check(url)
        preferred = str(profile.preferred_extract_backend or "").strip()
        normalized = [str(item).strip() for item in backend_order if str(item).strip()]
        if not preferred or preferred not in normalized:
            return normalized
        return [preferred] + [item for item in normalized if item != preferred]

    def retry_budget(self, url: str, default_budget: int = 3) -> int:
        profile = self.domain_memory_check(url)
        if profile.failure_count >= 6 and profile.success_count == 0:
            return 1
        if profile.failure_count >= 3 and profile.success_count <= 1:
            return min(default_budget, 2)
        return default_budget

    def build_attempt_plan(self, candidate_urls: List[str], backend_order: List[str]) -> List[ExtractAttemptPlan]:
        plans: List[ExtractAttemptPlan] = []
        budget = self.retry_budget(candidate_urls[0], default_budget=min(3, len(candidate_urls))) if candidate_urls else 0
        for url in candidate_urls[:budget]:
            profile = self.domain_memory_check(url)
            prioritized = self.prioritize_backend_order(url, backend_order)
            reason = "default backend order"
            if profile.preferred_extract_backend and prioritized and prioritized[0] == profile.preferred_extract_backend:
                reason = f"preferred backend {profile.preferred_extract_backend} restored from domain history"
            plans.append(
                ExtractAttemptPlan(
                    url=url,
                    backend_order=prioritized,
                    reason=reason,
                    domain_profile=profile,
                )
            )
        return plans

    def record_extract_result(
        self,
        *,
        url: str,
        page_kind: str,
        backend_order: List[str],
        successful_backend: str,
    ) -> None:
        self._store.record_extract_success(
            url=url,
            page_kind=page_kind,
            backend_order=backend_order,
            successful_backend=successful_backend,
        )

    def record_extract_failure(
        self,
        *,
        url: str,
        failure_kind: str,
        details: str = "",
    ) -> None:
        self._store.record_failure(
            url=url,
            stage="extract",
            failure_kind=failure_kind,
            details=details,
        )

    def diagnostics(self, url: str) -> Dict[str, Any]:
        parsed = urlparse(url)
        domain = parsed.hostname or url
        return self._store.diagnostics(domain)
