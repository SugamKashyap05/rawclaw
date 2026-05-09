"""
Memory retrieval audit — wraps every ChromaDB query with structured logging
so that memory recall failures are visible and debuggable.

Every query through this module emits a structured log event with:
- what was queried
- how many results were requested vs returned
- the similarity scores of returned results
- whether the token budget caused truncation
- the turn_id so the retrieval is traceable to a specific user request

Without this, "should have remembered" bugs are invisible.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("rawclaw.memory.retrieval")


@dataclass
class RetrievalAudit:
    turn_id: str
    collection: str
    query_preview: str
    top_k_requested: int
    results_returned: int
    scores: list[float]
    token_budget_limit: int
    token_budget_used: int
    was_truncated: bool
    latency_ms: float
    highest_score: float = field(init=False)
    lowest_score: float = field(init=False)

    def __post_init__(self):
        self.highest_score = max(self.scores) if self.scores else 0.0
        self.lowest_score = min(self.scores) if self.scores else 0.0


def retrieve_with_audit(
    collection,
    query: str,
    turn_id: str,
    k: int = 5,
    token_limit: int = 2048,
    score_threshold: float = 0.0,
    *,
    query_embedding: Optional[list[float]] = None,
    where: Optional[dict[str, Any]] = None,
    include: Optional[list[str]] = None,
) -> tuple[list[str], RetrievalAudit, dict[str, Any]]:
    """
    Retrieves from ChromaDB and emits a structured audit log.
    Returns (documents, audit, raw) — callers can keep using raw metadata/distances
    while gaining an audit trail for recall behavior.
    """
    start = time.monotonic()

    query_kwargs: dict[str, Any] = {
        "n_results": k,
        "include": include or ["documents", "distances"],
    }
    if where:
        query_kwargs["where"] = where
    if query_embedding is not None:
        query_kwargs["query_embeddings"] = [query_embedding]
    else:
        query_kwargs["query_texts"] = [query]

    raw = collection.query(**query_kwargs)

    documents: list[str] = raw.get("documents", [[]])[0]
    distances: list[float] = raw.get("distances", [[]])[0]

    filtered = [
        (doc, dist)
        for doc, dist in zip(documents, distances)
        if (1.0 - float(dist)) >= score_threshold
    ]

    kept_docs: list[str] = []
    kept_scores: list[float] = []
    kept_indices: list[int] = []
    token_count = 0

    for index, (doc, dist) in enumerate(filtered):
        estimated_tokens = int(len(str(doc or "").split()) * 1.35)
        if token_count + estimated_tokens > token_limit:
            break
        kept_docs.append(str(doc or ""))
        kept_scores.append(round(1.0 - float(dist), 4))
        kept_indices.append(index)
        token_count += estimated_tokens

    latency_ms = round((time.monotonic() - start) * 1000, 2)
    was_truncated = len(kept_docs) < len(documents)

    audit = RetrievalAudit(
        turn_id=turn_id,
        collection=getattr(collection, "name", "unknown"),
        query_preview=query[:80],
        top_k_requested=k,
        results_returned=len(kept_docs),
        scores=kept_scores,
        token_budget_limit=token_limit,
        token_budget_used=token_count,
        was_truncated=was_truncated,
        latency_ms=latency_ms,
    )

    def _slice_first(values: Any) -> list[Any]:
        first = values[0] if isinstance(values, list) and values else []
        if not isinstance(first, list):
            return []
        return [first[i] for i in kept_indices if i < len(first)]

    trimmed_raw = dict(raw)
    if "documents" in trimmed_raw:
        trimmed_raw["documents"] = [kept_docs]
    if "distances" in trimmed_raw:
        trimmed_raw["distances"] = [[distances[i] for i in kept_indices if i < len(distances)]]
    if "metadatas" in trimmed_raw:
        trimmed_raw["metadatas"] = [_slice_first(trimmed_raw["metadatas"])]
    if "ids" in trimmed_raw:
        trimmed_raw["ids"] = [_slice_first(trimmed_raw["ids"])]

    log_fn = logger.warning if was_truncated or len(kept_docs) == 0 else logger.info
    log_fn(
        "memory_retrieval turn_id=%s collection=%s results_requested=%s results_returned=%s highest_score=%s lowest_score=%s token_budget_used=%s token_budget_limit=%s was_truncated=%s latency_ms=%s empty_result=%s",
        audit.turn_id,
        audit.collection,
        audit.top_k_requested,
        audit.results_returned,
        audit.highest_score,
        audit.lowest_score,
        audit.token_budget_used,
        audit.token_budget_limit,
        audit.was_truncated,
        audit.latency_ms,
        len(kept_docs) == 0,
    )

    return kept_docs, audit, trimmed_raw
