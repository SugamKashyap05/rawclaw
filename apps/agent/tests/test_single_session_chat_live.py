import json
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

import src.tools.builtin  # noqa: F401
from src.agents import AgentProfile, AgentProfileStore
from src.contracts.chat import (
    ChatMessage,
    ChatRequest,
    GatewayAgentProfileSnapshot,
    GatewayContextPayload,
)
from src.executor import Executor
from src.gateway import GatewayService
from src.sessions import SessionManager


LIVE_WEB_ENABLED = os.getenv("RAWCLAW_RUN_LIVE_WEB") == "1"


def _live_gateway_service() -> tuple[GatewayService, SessionManager]:
    store = AgentProfileStore(workspace_root="E:/workspace/rawclaw")
    store.register(
        AgentProfile(
            id="researcher",
            name="Researcher",
            workspace_id="proj-a",
            workspace_path="E:/workspace/rawclaw",
            default_model="ollama/qwen2.5:1.5b",
            allowed_tools=["web_search", "web_extract"],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={"style": "grounded"},
            active=True,
        )
    )
    session_manager = SessionManager()
    return GatewayService(store, session_manager), session_manager


def _live_routing_context() -> GatewayContextPayload:
    return GatewayContextPayload(
        resolved_agent_profile=GatewayAgentProfileSnapshot(
            id="researcher",
            name="Researcher",
            workspace_id="proj-a",
            workspace_path="E:/workspace/rawclaw",
            default_model="ollama/qwen2.5:1.5b",
            allowed_tools=["web_search", "web_extract"],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={"style": "grounded"},
            active=True,
        ),
        workspace_path="E:/workspace/rawclaw",
        memory_scope="workspace",
        routing_binding={
            "bindingId": "bind-live-chat",
            "routingKey": "proj-a::chat::live-user::thread-live::::researcher::0",
            "sessionId": "live-chat-session",
            "workspaceId": "proj-a",
            "senderIdentifier": "live-user",
            "surfaceType": "chat",
            "threadKey": "thread-live",
            "channelKey": None,
            "agentId": "researcher",
            "parentSessionId": None,
            "parentRunId": None,
            "delegationDepth": 0,
            "allowedTools": ["web_search", "web_extract"],
        },
    )


async def _collect_live_events(service: GatewayService, executor: Executor, request: ChatRequest) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    async for chunk in service.stream_chat(request, executor):
        events.append(json.loads(chunk))
    return events


@pytest.mark.asyncio
@pytest.mark.skipif(
    not LIVE_WEB_ENABLED,
    reason="Set RAWCLAW_RUN_LIVE_WEB=1 to run live single-session chat tests.",
)
async def test_live_single_session_chat_recovers_csk_standing_from_real_iplt20_flow():
    service, session_manager = _live_gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    greeting_request = ChatRequest(
        session_id="client-live-session",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="hello")],
        gateway_context=_live_routing_context(),
    )
    greeting_events = await _collect_live_events(service, executor, greeting_request)

    research_request = ChatRequest(
        session_id="client-live-session",
        agent_id="researcher",
        messages=[
            ChatMessage(role="user", content="hello"),
            ChatMessage(
                role="user",
                content="Open the official IPL 2026 points table page and tell me Chennai Super Kings standing.",
            ),
        ],
        gateway_context=_live_routing_context(),
    )
    research_events = await _collect_live_events(service, executor, research_request)

    canonical_session = session_manager.get_optional("live-chat-session")
    final_content = "\n".join(event.get("content", "") for event in research_events if event.get("type") == "content")
    provenance_events = [event for event in research_events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    stage_metadata = (final_provenance.get("metadata") or {}).get("internalResearchStages") or {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in research_events
        if event.get("type") == "tool_call"
    ]
    tool_results = [
        event.get("tool_result", {})
        for event in research_events
        if event.get("type") == "tool_result"
    ]
    extract_tool_result = next(
        (item for item in tool_results if item.get("tool_name") == "web_extract"),
        {},
    )
    extract_output = extract_tool_result.get("output") or {}
    extract_structured = extract_output.get("structuredData") if isinstance(extract_output, dict) else {}

    live_feature_status: dict[str, Any] = {
        "routing_binding_applied": canonical_session is not None and canonical_session.session_id == "live-chat-session",
        "session_reused_and_owned": canonical_session is not None and canonical_session.agent_id == "researcher",
        "greeting_short_circuit": any(
            event.get("type") == "content" and "How can I help you today?" in event.get("content", "")
            for event in greeting_events
        ),
        "research_tools_called": tool_call_names == ["web_extract"],
        "research_stage_metadata_present": {
            "research-planner",
            "extract-router",
            "evidence-judge",
            "answerability-gate",
            "final-writer",
        }.issubset(stage_metadata.keys()),
        "extract_succeeded": bool(extract_tool_result) and not extract_tool_result.get("error"),
        "extract_backend_present": str(extract_output.get("backendUsed") or "").strip() not in {"", "none"},
        "extract_structured_team": str((extract_structured or {}).get("team") or "").strip().lower() == "chennai super kings",
        "extract_structured_fields_present": any(
            (extract_structured or {}).get(field)
            for field in ["position", "points", "nrr", "ranking_movement"]
        ),
        "answerability_not_abstain": stage_metadata.get("answerability-gate", {}).get("mode") in {"partial", "exact"},
        "meaningful_csk_output": (
            "chennai super kings" in final_content.lower()
            and any(token in final_content.lower() for token in ["points", "nrr", "position", "6th", "6 points"])
            and "could not verify the exact current standings race picture" not in final_content.lower()
        ),
        "provenance_kept_gateway_metadata": (
            (final_provenance.get("metadata") or {}).get("agentId") == "researcher"
            and ((final_provenance.get("metadata") or {}).get("routingBinding") or {}).get("bindingId") == "bind-live-chat"
            and ((final_provenance.get("metadata") or {}).get("gatewaySession") or {}).get("session_id") == "live-chat-session"
        ),
        "session_returns_idle": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(live_feature_status.values()), live_feature_status
