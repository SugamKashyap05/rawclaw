from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, Field

from src.agents.types import ResolvedAgentContext
from src.sessions.types import SessionRecord


class GatewayRequestContext(BaseModel):
    agent_profile: ResolvedAgentContext
    session_record: SessionRecord
    workspace_path: str
    memory_scope: str
    routing_binding: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
