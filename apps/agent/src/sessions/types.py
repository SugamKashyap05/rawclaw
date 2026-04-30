from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


RunStatus = Literal["idle", "running", "error"]


class SessionRunState(BaseModel):
    run_status: RunStatus = "idle"
    last_run_started_at: Optional[datetime] = None
    last_run_finished_at: Optional[datetime] = None


class SessionRecord(BaseModel):
    session_id: str
    agent_id: str
    workspace_id: str
    sender_identifier: str = "local"
    created_at: datetime
    updated_at: datetime
    last_run_started_at: Optional[datetime] = None
    last_run_finished_at: Optional[datetime] = None
    run_status: RunStatus = "idle"

    def to_run_state(self) -> SessionRunState:
        return SessionRunState(
            run_status=self.run_status,
            last_run_started_at=self.last_run_started_at,
            last_run_finished_at=self.last_run_finished_at,
        )
