from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AgentProfile(BaseModel):
    id: str
    name: str
    workspace_id: str = "default"
    workspace_path: str
    default_model: Optional[str] = None
    allowed_tools: List[str] = Field(default_factory=list)
    memory_scope: str = "workspace"
    prompt_files: List[str] = Field(default_factory=list)
    research_defaults: Dict[str, Any] = Field(default_factory=dict)
    active: bool = True


class ResolvedAgentContext(BaseModel):
    profile: AgentProfile
    requested_agent_id: str
    workspace_path: str
    memory_scope: str
    model_id: Optional[str] = None
    allowed_tools: List[str] = Field(default_factory=list)
