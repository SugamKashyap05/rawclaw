from __future__ import annotations

from typing import Any, Dict, Optional

from src.research.types import AnalystResult, GuardianVerdict, RoleTrace, ScoutResult, StrategistDecision


class InProcessSwarmCoordinator:
    """
    Lightweight in-process role coordinator for Phase 1 PrivateSwarm.

    This stores the latest role trace per session so the live request path can
    remain inside the current agent process while still exposing explicit
    Strategist/Scout/Analyst/Guardian state.
    """

    def __init__(self) -> None:
        self._latest_traces: Dict[str, RoleTrace] = {}

    def start_trace(self, session_id: str, query: str) -> RoleTrace:
        trace = RoleTrace(sessionId=session_id, query=query)
        self._latest_traces[session_id] = trace
        return trace

    def _ensure_trace(self, session_id: str) -> RoleTrace:
        trace = self._latest_traces.get(session_id)
        if trace is None:
            trace = RoleTrace(sessionId=session_id, query="")
            self._latest_traces[session_id] = trace
        return trace

    def update_strategist(self, session_id: str, **payload: Any) -> StrategistDecision:
        trace = self._ensure_trace(session_id)
        trace.strategist = StrategistDecision(**payload)
        return trace.strategist

    def update_scout(self, session_id: str, **payload: Any) -> ScoutResult:
        trace = self._ensure_trace(session_id)
        trace.scout = ScoutResult(**payload)
        return trace.scout

    def update_analyst(self, session_id: str, **payload: Any) -> AnalystResult:
        trace = self._ensure_trace(session_id)
        trace.analyst = AnalystResult(**payload)
        return trace.analyst

    def update_guardian(self, session_id: str, **payload: Any) -> GuardianVerdict:
        trace = self._ensure_trace(session_id)
        trace.guardian = GuardianVerdict(**payload)
        return trace.guardian

    def set_final_outcome(self, session_id: str, **payload: Any) -> Dict[str, Any]:
        trace = self._ensure_trace(session_id)
        trace.finalOutcome = dict(payload)
        return trace.finalOutcome

    def get_trace(self, session_id: str) -> Optional[Dict[str, Any]]:
        trace = self._latest_traces.get(session_id)
        if trace is None:
            return None
        return trace.model_dump()
