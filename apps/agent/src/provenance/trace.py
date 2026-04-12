"""
ProvenanceTrace — Records every step of agent execution with tool details.

Provides a step-by-step audit trail of:
  - Plan steps (model reasoning)
  - Tool calls (what was requested)
  - Tool results (what was returned)
  - Synthesis steps (final answer generation)
  - Errors (any failures)

This enables full traceability for task provenance.
"""
import hashlib
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.provenance")

# Maximum length for human-readable summaries
MAX_SUMMARY_LENGTH = 500


class ProvenanceStep(BaseModel):
    """A single step in a provenance trace."""
    step_index: int
    step_type: Literal["plan", "tool_call", "tool_result", "synthesis", "error"]
    tool_name: Optional[str] = None
    input_summary: Optional[str] = None
    output_summary: Optional[str] = None
    source_url: Optional[str] = None
    duration_ms: int = 0
    sandboxed: bool = False
    timestamp: str


def _summarize(data: Any, max_length: int = MAX_SUMMARY_LENGTH) -> str:
    """Create a human-readable summary of data, truncated to max_length."""
    try:
        if data is None:
            return "(none)"
        if isinstance(data, str):
            text = data
        elif isinstance(data, dict):
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


class ProvenanceTrace:
    """
    Records and stores provenance steps for a single agent execution.
    Each execution instantiates a new ProvenanceTrace with a unique run_id.
    """

    def __init__(self) -> None:
        self.run_id: str = str(uuid.uuid4())
        self._steps: List[ProvenanceStep] = []
        self._step_counter: int = 0

    def add_step(
        self,
        step_type: Literal["plan", "tool_call", "tool_result", "synthesis", "error"],
        tool_name: Optional[str] = None,
        input_summary: Optional[str] = None,
        output_summary: Optional[str] = None,
        source_url: Optional[str] = None,
        duration_ms: int = 0,
        sandboxed: bool = False,
    ) -> ProvenanceStep:
        """
        Add a step to the trace.
        Returns the created ProvenanceStep.
        """
        step = ProvenanceStep(
            step_index=self._step_counter,
            step_type=step_type,
            tool_name=tool_name,
            input_summary=input_summary[:MAX_SUMMARY_LENGTH] if input_summary else None,
            output_summary=output_summary[:MAX_SUMMARY_LENGTH] if output_summary else None,
            source_url=source_url,
            duration_ms=duration_ms,
            sandboxed=sandboxed,
            timestamp=datetime.utcnow().isoformat() + "Z",
        )
        self._steps.append(step)
        self._step_counter += 1

        logger.info(
            f"Provenance: run={self.run_id} step={step.step_index} "
            f"type={step_type} tool={tool_name or 'N/A'} duration={duration_ms}ms"
        )
        return step

    def add_tool_call(
        self,
        tool_name: str,
        input_data: Dict[str, Any],
    ) -> ProvenanceStep:
        """Convenience method to add a tool call step."""
        return self.add_step(
            step_type="tool_call",
            tool_name=tool_name,
            input_summary=_summarize(input_data),
        )

    def add_tool_result(
        self,
        result: ToolResult,
        duration_ms: int,
    ) -> ProvenanceStep:
        """Convenience method to add a tool result step."""
        step_type: Literal["tool_result", "error"] = "tool_result"
        if result.error:
            step_type = "error"

        return self.add_step(
            step_type=step_type,
            tool_name=result.tool_name,
            input_summary=_summarize(result.input),
            output_summary=_summarize(result.output) if result.output else result.error,
            source_url=result.source_url,
            duration_ms=duration_ms,
            sandboxed=result.sandboxed,
        )

    def add_plan_step(self, summary: str) -> ProvenanceStep:
        """Add a planning/reasoning step."""
        return self.add_step(
            step_type="plan",
            input_summary=summary,
        )

    def add_synthesis_step(self, summary: str, duration_ms: int) -> ProvenanceStep:
        """Add a synthesis/final answer step."""
        return self.add_step(
            step_type="synthesis",
            output_summary=summary,
            duration_ms=duration_ms,
        )

    def add_error_step(self, error: str, tool_name: Optional[str] = None) -> ProvenanceStep:
        """Add an error step."""
        return self.add_step(
            step_type="error",
            tool_name=tool_name,
            output_summary=error,
        )

    def get_steps(self) -> List[ProvenanceStep]:
        """Get all recorded steps."""
        return list(self._steps)

    def to_dict(self) -> Dict[str, Any]:
        """Export the trace as a dictionary for API responses."""
        return {
            "run_id": self.run_id,
            "steps": [step.model_dump() for step in self._steps],
            "step_count": len(self._steps),
            "created_at": datetime.utcnow().isoformat() + "Z",
        }

    @property
    def step_count(self) -> int:
        return len(self._steps)


# Legacy ProvenanceRecord for backwards compatibility
class ProvenanceRecord(BaseModel):
    """A single provenance record for a tool execution. (Legacy)"""
    trace_id: str
    tool_name: str
    input_hash: str
    output_hash: str
    input_summary: str
    output_summary: str
    started_at: str
    completed_at: str
    duration_ms: float
    status: str
    error: Optional[str] = None
    sandbox_used: bool


def _sha256(data: Any) -> str:
    """Compute SHA-256 hash of arbitrary data (JSON-serialized)."""
    try:
        serialized = json.dumps(data, sort_keys=True, default=str)
    except (TypeError, ValueError):
        serialized = str(data)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class ProvenanceTracer:
    """
    Legacy tracer for backwards compatibility.
    Use ProvenanceTrace for new code.
    """

    def __init__(self) -> None:
        self._records: List[ProvenanceRecord] = []

    def record(
        self,
        tool_result: ToolResult,
        started_at: str,
        completed_at: str,
    ) -> ProvenanceRecord:
        """Create a provenance record from a tool execution result."""
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
        return list(self._records)

    def get_by_trace_id(self, trace_id: str) -> Optional[ProvenanceRecord]:
        for r in self._records:
            if r.trace_id == trace_id:
                return r
        return None

    def get_by_session(self, tool_name: Optional[str] = None) -> List[ProvenanceRecord]:
        if tool_name is None:
            return list(self._records)
        return [r for r in self._records if r.tool_name == tool_name]

    def clear(self) -> None:
        self._records.clear()

    @property
    def count(self) -> int:
        return len(self._records)