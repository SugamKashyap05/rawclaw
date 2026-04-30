from __future__ import annotations

from pathlib import Path
from typing import Optional

from src.agents.types import AgentProfile, ResolvedAgentContext
from src.config import settings


class AgentProfileResolutionError(ValueError):
    pass


class AgentProfileStore:
    def __init__(self, workspace_root: Optional[str] = None, profiles: Optional[list[AgentProfile]] = None) -> None:
        root = workspace_root or str(Path(__file__).resolve().parents[4])
        self.workspace_root = str(Path(root).resolve())
        self._profiles: dict[str, AgentProfile] = {}

        self._profiles["main"] = AgentProfile(
            id="main",
            name="Main",
            workspace_id="default",
            workspace_path=self.workspace_root,
            default_model=settings.DEFAULT_HIGH_MODEL,
            allowed_tools=[],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={},
            active=True,
        )

        for profile in profiles or []:
            self._profiles[profile.id] = profile

    def list_profiles(self) -> list[AgentProfile]:
        return [self._profiles[key] for key in sorted(self._profiles.keys())]

    def get_optional(self, agent_id: Optional[str]) -> Optional[AgentProfile]:
        if not agent_id:
            return self._profiles.get("main")
        return self._profiles.get(agent_id)

    def register(self, profile: AgentProfile) -> AgentProfile:
        self._profiles[profile.id] = profile
        return profile

    def resolve(
        self,
        agent_id: Optional[str],
        runtime_profile: Optional[AgentProfile] = None,
    ) -> ResolvedAgentContext:
        requested_id = agent_id or "main"
        profile = runtime_profile
        if profile and profile.id != requested_id:
            raise AgentProfileResolutionError(
                f"Resolved runtime profile '{profile.id}' does not match requested agent '{requested_id}'."
            )

        if profile is None:
            profile = self.get_optional(requested_id)

        if profile is None:
            raise AgentProfileResolutionError(f"Unknown agent profile '{requested_id}'.")

        if not profile.active:
            raise AgentProfileResolutionError(f"Agent profile '{requested_id}' is inactive.")

        return ResolvedAgentContext(
            profile=profile,
            requested_agent_id=requested_id,
            workspace_path=profile.workspace_path,
            memory_scope=profile.memory_scope,
            model_id=profile.default_model,
            allowed_tools=list(profile.allowed_tools),
        )
