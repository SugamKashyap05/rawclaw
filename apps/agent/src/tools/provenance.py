"""
ProvenanceTracer — Records every tool execution with integrity hashes
and human-readable summaries.

Every ToolResult flows through ProvenanceTracer.record() which:
  1. Computes SHA-256 hashes of input and output
  2. Generates truncated (500 char) human-readable summaries
  3. Stores the record in-memory with a unique trace_id
  4. (Phase 4 will persist these to the database)

This enables full audit trails for task provenance.
"""
import hashlib
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.provenance")

# Maximum length for human-readable summaries
MAX_SUMMARY_LENGTH = 500


class ProvenanceRecord(BaseModel):
    """A single provenance record for a tool execution."""
    trace_id: str
    tool_name: str
    input_hash: str
    output_hash: str
    input_summary: str
    output_summary: str
    started_at: str
    completed_at: str
    duration_ms: float
    status: str  # 'success' | 'error' | 'timeout'
    error: Optional[str] = None
    sandbox_used: bool


def _sha256(data: Any) -> str:
    """Compute SHA-256 hash of arbitrary data (JSON-serialized)."""
    try:
        serialized = json.dumps(data, sort_keys=True, default=str)
    except (TypeError, ValueError):
        serialized = str(data)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _summarize(data: Any, max_length: int = MAX_SUMMARY_LENGTH) -> str:
    """Create a human-readable summary of data, truncated to max_length."""
    try:
        if data is None:
            return "(none)"
        if isinstance(data, str):
            text = data
        elif isinstance(data, dict):
            # For dicts, show key-value pairs
            parts = []
            for k, v in data.items():
                v_str = str(v)[:100]
                parts.append(f"{k}={v_str}")
            text = ", ".join(parts)
        elif isinstance(data, list):
            text = f"[{len(data)} items] " + str(data[:3])
        else:
            text = str(data)

        if len(text) > max_length:
            return text[: max_length - 3] + "..."
        return text
    except Exception:
        return "(summary unavailable)"


class ProvenanceTracer:
    """
    Records and stores provenance for all tool executions.
    In-memory for now; Phase 4 will add database persistence.
    """

    def __init__(self) -> None:
        self._records: List[ProvenanceRecord] = []

    def record(
        self,
        tool_result: ToolResult,
        started_at: str,
        completed_at: str,
    ) -> ProvenanceRecord:
        """
        Create a provenance record from a tool execution result.
        Returns the created ProvenanceRecord.
        """
        trace_id = str(uuid.uuid4())

        status = "success"
        if tool_result.error:
            if "timed out" in (tool_result.error or "").lower():
                status = "timeout"
            else:
                status = "error"

        record = ProvenanceRecord(
            trace_id=trace_id,
            tool_name=tool_result.tool_name,
            input_hash=_sha256(tool_result.input),
            output_hash=_sha256(tool_result.output),
            input_summary=_summarize(tool_result.input),
            output_summary=_summarize(tool_result.output),
            started_at=started_at,
            completed_at=completed_at,
            duration_ms=tool_result.duration_ms,
            status=status,
            error=tool_result.error,
            sandbox_used=tool_result.sandboxed,
        )

        self._records.append(record)
        logger.info(
            f"Provenance: trace={trace_id} tool={tool_result.tool_name} "
            f"status={status} duration={tool_result.duration_ms}ms"
        )
        return record

    def get_records(self) -> List[ProvenanceRecord]:
        """Get all recorded provenance entries."""
        return list(self._records)

    def get_by_trace_id(self, trace_id: str) -> Optional[ProvenanceRecord]:
        """Look up a specific provenance record by trace ID."""
        for r in self._records:
            if r.trace_id == trace_id:
                return r
        return None

    def get_by_session(self, tool_name: Optional[str] = None) -> List[ProvenanceRecord]:
        """Filter records by tool name."""
        if tool_name is None:
            return list(self._records)
        return [r for r in self._records if r.tool_name == tool_name]

    def clear(self) -> None:
        """Clear all in-memory records. Used for testing."""
        self._records.clear()

    @property
    def count(self) -> int:
        return len(self._records)
