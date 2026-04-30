from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator, Optional

from src.agents.types import ResolvedAgentContext
from src.sessions.types import SessionRecord


class SessionOwnershipError(ValueError):
    pass


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def list_sessions(self) -> list[SessionRecord]:
        return [self._sessions[key] for key in sorted(self._sessions.keys())]

    def get_optional(self, session_id: str) -> Optional[SessionRecord]:
        return self._sessions.get(session_id)

    def resolve_or_create(
        self,
        session_id: str,
        agent_context: ResolvedAgentContext,
        workspace_id: Optional[str] = None,
        sender_identifier: Optional[str] = None,
    ) -> SessionRecord:
        existing = self._sessions.get(session_id)
        now = datetime.now(timezone.utc)
        resolved_workspace_id = workspace_id or agent_context.profile.workspace_id
        resolved_sender = sender_identifier or "local"

        if existing:
            if existing.agent_id != agent_context.profile.id:
                raise SessionOwnershipError(
                    f"Session '{session_id}' already belongs to agent '{existing.agent_id}', not '{agent_context.profile.id}'."
                )
            existing.updated_at = now
            if workspace_id:
                existing.workspace_id = workspace_id
            if sender_identifier:
                existing.sender_identifier = sender_identifier
            return existing

        record = SessionRecord(
            session_id=session_id,
            agent_id=agent_context.profile.id,
            workspace_id=resolved_workspace_id,
            sender_identifier=resolved_sender,
            created_at=now,
            updated_at=now,
        )
        self._sessions[session_id] = record
        self._locks.setdefault(session_id, asyncio.Lock())
        return record

    def mark_run_started(self, session_id: str) -> SessionRecord:
        record = self._sessions[session_id]
        now = datetime.now(timezone.utc)
        record.run_status = "running"
        record.last_run_started_at = now
        record.updated_at = now
        return record

    def mark_run_finished(self, session_id: str, had_error: bool = False) -> SessionRecord:
        record = self._sessions[session_id]
        now = datetime.now(timezone.utc)
        record.run_status = "error" if had_error else "idle"
        record.last_run_finished_at = now
        record.updated_at = now
        return record

    @asynccontextmanager
    async def run_context(self, session_id: str) -> AsyncIterator[SessionRecord]:
        lock = self._locks.setdefault(session_id, asyncio.Lock())
        await lock.acquire()
        self.mark_run_started(session_id)
        try:
            yield self._sessions[session_id]
        except Exception:
            self.mark_run_finished(session_id, had_error=True)
            raise
        else:
            self.mark_run_finished(session_id, had_error=False)
        finally:
            lock.release()
