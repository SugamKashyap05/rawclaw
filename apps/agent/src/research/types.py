from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ResearchPlan(BaseModel):
    lane: str = "research"
    task_type: str
    queries: List[str] = Field(default_factory=list)
    expected_fields: List[str] = Field(default_factory=list)
    target_urls: List[str] = Field(default_factory=list)
    needs_freshness: bool = False
    recency_matters: bool = False
    allow_interaction: bool = False
    category: str = ""
    comparison_needed: bool = False
    fetch_required: bool = False
    source_preferences: List[str] = Field(default_factory=list)
    focus: List[str] = Field(default_factory=list)
    domain_bias: List[str] = Field(default_factory=list)
    exact_structured_data_needed: bool = False
    official_source_requested: bool = False


ResearchEvidenceState = Literal["evidence_found", "evidence_thin", "extraction_failed", "no_results"]


class SourceProfile(BaseModel):
    domain: str
    renderType: Literal["static", "js-app", "unknown"] = "unknown"
    extractionReliability: Literal["high", "low", "unknown"] = "unknown"
    preferredAccessMethod: Literal["direct", "search-for-article"] = "direct"


class ResearchContext(BaseModel):
    query: str
    task_type: str = ""
    category: str = ""
    search_query: str = ""
    selected_urls: List[str] = Field(default_factory=list)
    query_classification: Dict[str, Any] = Field(default_factory=dict)
    search_status: str = ""
    fetch_status: str = ""
    fetch_failure_state: str = ""
    pre_evidence: Dict[str, Any] = Field(default_factory=dict)
    extraction_decision: Dict[str, Any] = Field(default_factory=dict)
    evidence_assessment: Dict[str, Any] = Field(default_factory=dict)
    answerability: Dict[str, Any] = Field(default_factory=dict)
    confidence_risk: Dict[str, Any] = Field(default_factory=dict)
    evidence_state: Optional[ResearchEvidenceState] = None


class ExtractionDecision(BaseModel):
    page_kind: str
    backend_order: List[str] = Field(default_factory=list)
    allow_interaction: bool = False
    candidate_urls: List[str] = Field(default_factory=list)
    reason: str = ""
    should_attempt_extract: bool = False
    has_viable_search_results: bool = False
    ranked_results: List[Dict[str, Any]] = Field(default_factory=list)
    candidate_profiles: List[SourceProfile] = Field(default_factory=list)
    needs_query_broadening: bool = False
    diversity_status: str = ""


class PreEvidenceDecision(BaseModel):
    original_result_count: int = 0
    filtered_result_count: int = 0
    kept_results: List[Dict[str, Any]] = Field(default_factory=list)
    rejected_results: List[Dict[str, Any]] = Field(default_factory=list)
    reason: str = ""
    warning_flags: List[str] = Field(default_factory=list)
    snippet_only_insufficient: bool = False
    preferred_domains: List[str] = Field(default_factory=list)


class EvidenceAssessment(BaseModel):
    relevant: bool = False
    usable: bool = False
    sufficient: bool = False
    quality: str = "insufficient"
    reasons: List[str] = Field(default_factory=list)
    missing_fields: List[str] = Field(default_factory=list)
    duplicate_collapsed: bool = False
    best_evidence: List[str] = Field(default_factory=list)
    partial: bool = False
    abstain: bool = False
    fetch_quality: str = ""
    search_evidence: List[Dict[str, Any]] = Field(default_factory=list)
    records: List[Dict[str, Any]] = Field(default_factory=list)
    clusters: List[Dict[str, Any]] = Field(default_factory=list)
    evidence_breakdown: Dict[str, int] = Field(default_factory=dict)
    corroboration_mode: str = ""
    freshness_summary: str = ""


class ConfidenceRiskDecision(BaseModel):
    mode: Literal["exact_answer", "limited_answer", "refused_answer"]
    reason: str = ""
    failure_state: str = ""
    evidence_verdict: Dict[str, Any] = Field(default_factory=dict)
    synthesis: Dict[str, Any] = Field(default_factory=dict)
    loyalty: Dict[str, Any] = Field(default_factory=dict)


class StrategistDecision(BaseModel):
    lane: Literal["direct", "tool", "research"]
    intent: str = "general"
    riskLevel: Literal["low", "medium", "high"] = "low"
    freshnessMatters: bool = False
    directRouteMatched: bool = False
    directRoute: Dict[str, Any] = Field(default_factory=dict)
    expectedEvidenceType: str = "none"
    allowedToolScope: List[str] = Field(default_factory=list)
    searchQueries: List[str] = Field(default_factory=list)
    reason: str = ""


class ScoutResult(BaseModel):
    lane: Literal["direct", "tool", "research"]
    status: str = "not_started"
    directRouteUsed: bool = False
    toolCalls: List[str] = Field(default_factory=list)
    searchQueries: List[str] = Field(default_factory=list)
    selectedUrls: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    evidenceAcquisitionSummary: Dict[str, Any] = Field(default_factory=dict)


class AnalystResult(BaseModel):
    mode: Literal["exact_answer", "limited_answer", "refused_answer"]
    failureState: str = ""
    evidenceVerdict: Dict[str, Any] = Field(default_factory=dict)
    synthesis: Dict[str, Any] = Field(default_factory=dict)
    loyalty: Dict[str, Any] = Field(default_factory=dict)
    answerPreview: str = ""
    summary: str = ""


class GuardianVerdict(BaseModel):
    approved: bool
    finalMode: Literal["exact_answer", "limited_answer", "refused_answer"]
    reason: str = ""
    feedback: str = ""
    failClosed: bool = False
    reviewer: str = "local_guardian"
    answerPreview: str = ""


class RoleTrace(BaseModel):
    sessionId: str
    query: str
    strategist: Optional[StrategistDecision] = None
    scout: Optional[ScoutResult] = None
    analyst: Optional[AnalystResult] = None
    guardian: Optional[GuardianVerdict] = None
    finalOutcome: Dict[str, Any] = Field(default_factory=dict)


class AnswerabilityDecision(BaseModel):
    mode: Literal["exact", "partial", "abstain"]
    limitations: List[str] = Field(default_factory=list)
    can_answer_exactly: bool = False
    can_answer_partially: bool = False


class FinalDraft(BaseModel):
    markdown: str
    confidence: str = "limited"
    citations_or_sources: List[str] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)


class AdaptiveDomainProfile(BaseModel):
    domain: str
    preferred_transport_strategy: Optional[str] = None
    preferred_extract_backend: Optional[str] = None
    success_count: int = 0
    failure_count: int = 0
    trusted_sources: List[str] = Field(default_factory=list)
    last_success_at: Optional[str] = None
    last_failure_at: Optional[str] = None


class AdaptiveFailureRecord(BaseModel):
    domain: str
    stage: str
    failure_kind: str
    url: str = ""
    transport_strategy: Optional[str] = None
    details: Optional[str] = None
    created_at: str
