from __future__ import annotations

from src.agents.store import AgentProfileStore
from src.sessions.manager import SessionManager


class GatewayRegistry:
    def __init__(self, profile_store: AgentProfileStore, session_manager: SessionManager) -> None:
        self.profile_store = profile_store
        self.session_manager = session_manager

    def list_agents(self):
        return self.profile_store.list_profiles()

    def list_sessions(self):
        return self.session_manager.list_sessions()

    def get_session(self, session_id: str):
        return self.session_manager.get_optional(session_id)

    def health_summary(self) -> dict:
        return {
            "status": "ok",
            "profiles_loaded": len(self.profile_store.list_profiles()),
            "active_sessions": len(self.session_manager.list_sessions()),
        }
