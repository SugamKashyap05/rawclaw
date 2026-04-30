import asyncio

import pytest

from src.agents import AgentProfile, ResolvedAgentContext
from src.sessions import SessionManager, SessionOwnershipError


def _resolved_agent(agent_id: str) -> ResolvedAgentContext:
    profile = AgentProfile(
        id=agent_id,
        name=agent_id.title(),
        workspace_id="default",
        workspace_path="E:/workspace/rawclaw",
        default_model="ollama/llama3:8b",
        allowed_tools=[],
        memory_scope="workspace",
        prompt_files=[],
        research_defaults={},
        active=True,
    )
    return ResolvedAgentContext(
        profile=profile,
        requested_agent_id=agent_id,
        workspace_path=profile.workspace_path,
        memory_scope=profile.memory_scope,
        model_id=profile.default_model,
        allowed_tools=[],
    )


def test_session_manager_creates_and_reuses_session():
    manager = SessionManager()

    created = manager.resolve_or_create("session-1", _resolved_agent("main"), workspace_id="ws-a", sender_identifier="desktop")
    reused = manager.resolve_or_create("session-1", _resolved_agent("main"), workspace_id="ws-a", sender_identifier="desktop")

    assert created.session_id == "session-1"
    assert reused.agent_id == "main"
    assert len(manager.list_sessions()) == 1


def test_session_manager_rejects_conflicting_agent_reuse():
    manager = SessionManager()
    manager.resolve_or_create("session-1", _resolved_agent("main"))

    with pytest.raises(SessionOwnershipError):
        manager.resolve_or_create("session-1", _resolved_agent("researcher"))


@pytest.mark.asyncio
async def test_session_manager_serializes_concurrent_runs():
    manager = SessionManager()
    manager.resolve_or_create("session-1", _resolved_agent("main"))
    events: list[str] = []

    async def worker(label: str):
        async with manager.run_context("session-1"):
            events.append(f"{label}-start")
            await asyncio.sleep(0.05)
            events.append(f"{label}-end")

    await asyncio.gather(worker("a"), worker("b"))

    assert events in (["a-start", "a-end", "b-start", "b-end"], ["b-start", "b-end", "a-start", "a-end"])
