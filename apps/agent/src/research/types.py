from typing import Any, Dict, List, Literal

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


class ExtractionDecision(BaseModel):
    page_kind: str
    backend_order: List[str] = Field(default_factory=list)
    allow_interaction: bool = False
    candidate_urls: List[str] = Field(default_factory=list)
    reason: str = ""
    should_attempt_extract: bool = False
    has_viable_search_results: bool = False
    ranked_results: List[Dict[str, Any]] = Field(default_factory=list)


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
