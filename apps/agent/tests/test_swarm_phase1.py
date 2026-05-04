import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.agents import AgentProfile, AgentProfileStore
from src.contracts.chat import ChatMessage, ChatRequest, GatewayAgentProfileSnapshot, GatewayContextPayload
from src.contracts.tool import ToolResult
from src.executor import Executor
from src.gateway import GatewayService
from src.sessions import SessionManager


def _gateway_service() -> tuple[GatewayService, AgentProfileStore, SessionManager]:
    store = AgentProfileStore(workspace_root="E:/workspace/rawclaw")
    store.register(
        AgentProfile(
            id="researcher",
            name="Researcher",
            workspace_id="proj-a",
            workspace_path="E:/workspace/rawclaw",
            default_model="ollama/qwen2.5:1.5b",
            allowed_tools=["web_search", "web_extract", "list_dir", "read_file"],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={"style": "grounded"},
            active=True,
        )
    )
    session_manager = SessionManager()
    return GatewayService(store, session_manager), store, session_manager


def _routing_context() -> GatewayContextPayload:
    return GatewayContextPayload(
        resolved_agent_profile=GatewayAgentProfileSnapshot(
            id="researcher",
            name="Researcher",
            workspace_id="proj-a",
            workspace_path="E:/workspace/rawclaw",
            default_model="ollama/qwen2.5:1.5b",
            allowed_tools=["web_search", "web_extract", "list_dir", "read_file"],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={"style": "grounded"},
            active=True,
        ),
        workspace_path="E:/workspace/rawclaw",
        memory_scope="workspace",
        routing_binding={
            "bindingId": "bind-phase1",
            "routingKey": "proj-a::chat::user-1::thread-a::::researcher::0",
            "sessionId": "canonical-phase1-session",
            "workspaceId": "proj-a",
            "senderIdentifier": "user-1",
            "surfaceType": "chat",
            "threadKey": "thread-a",
            "channelKey": None,
            "agentId": "researcher",
            "parentSessionId": None,
            "parentRunId": None,
            "delegationDepth": 0,
            "allowedTools": ["web_search", "web_extract", "list_dir", "read_file"],
        },
    )


async def _collect_events(service: GatewayService, executor: Executor, request: ChatRequest) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    async for chunk in service.stream_chat(request, executor):
        events.append(json.loads(chunk))
    return events


def _tool_result(name: str, output=None, error=None, source_url=None) -> ToolResult:
    return ToolResult(
        tool_name=name,
        input={},
        output=output,
        error=error,
        duration_ms=1,
        sandboxed=False,
        source_url=source_url,
    )


@pytest.mark.asyncio
async def test_phase1_research_request_records_all_swarm_roles():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_extract":
            return _tool_result(
                "web_extract",
                output={
                    "url": "https://www.iplt20.com/matches/points-table",
                    "title": "IPL 2026 Points Table | Team Standings and Rankings | IPLT20",
                    "content": "Chennai Super Kings are 6th in the IPL 2026 points table with 6 points and NRR -0.121. Recent form: W W L W L.",
                    "structuredData": {
                        "team": "Chennai Super Kings",
                        "position": "6",
                        "points": "6",
                        "nrr": "-0.121",
                        "ranking_movement": ["W", "W", "L", "W", "L"],
                    },
                    "backendUsed": "iplt20_official_feed",
                    "taskType": "factual_extract",
                    "sourceMode": "system_chosen",
                    "pageType": "data_table",
                    "quality": "extract_clean",
                    "tier": "clean",
                    "confidence": 1.0,
                    "missingFields": [],
                    "interactionRequired": False,
                    "pageKind": "standings/table",
                    "kind": "content",
                    "wordCount": 22,
                    "structuredRecordCount": 5,
                },
                source_url="https://www.iplt20.com/matches/points-table",
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    request = ChatRequest(
        session_id="client-phase1-research",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="do a web search to find out about ipl 2026 csk match points with how many wins and losses")],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-phase1-session")
    role_trace = executor.get_role_trace("canonical-phase1-session")
    provenance = [event for event in events if event.get("type") == "provenance"][-1]["provenance_trace"]
    tool_calls = [event.get("tool_call", {}).get("name") for event in events if event.get("type") == "tool_call"]

    assert canonical_session is not None and canonical_session.run_status == "idle"
    assert tool_calls == ["web_extract"]
    assert role_trace is not None
    assert role_trace["strategist"]["lane"] == "research"
    assert role_trace["strategist"]["directRouteMatched"] is True
    assert role_trace["scout"]["lane"] == "research"
    assert role_trace["scout"]["directRouteUsed"] is True
    assert "https://www.iplt20.com/matches/points-table" in role_trace["scout"]["selectedUrls"]
    assert role_trace["analyst"]["mode"] in {"exact_answer", "limited_answer"}
    assert role_trace["guardian"]["approved"] is True
    assert role_trace["guardian"]["finalMode"] in {"exact_answer", "limited_answer"}
    assert ((provenance.get("metadata") or {}).get("roleTrace") or {}).get("guardian", {}).get("reviewer") == "local_guardian"


@pytest.mark.asyncio
async def test_phase1_direct_request_still_flows_through_all_roles():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def fail_if_tool_runs(session_id, tool_call, trace, knowledge_brain=None):
        raise AssertionError(f"unexpected tool call: {tool_call.tool_name}")

    executor._execute_tool_with_confirmation = fail_if_tool_runs

    request = ChatRequest(
        session_id="client-phase1-direct",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="Jarvis, explain what you can do now after the latest system upgrades. Keep it short and concrete.")],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-phase1-session")
    role_trace = executor.get_role_trace("canonical-phase1-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")

    assert canonical_session is not None and canonical_session.run_status == "idle"
    assert role_trace is not None
    assert role_trace["strategist"]["lane"] == "direct"
    assert role_trace["scout"]["status"] in {"skipped_local_context", "local_memory_context"}
    assert role_trace["analyst"]["mode"] == "exact_answer"
    assert role_trace["guardian"]["approved"] is True
    assert "local-first JARVIS-style assistant" in final_content


@pytest.mark.asyncio
async def test_phase1_guardian_fails_closed_when_local_guardian_errors():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def fail_if_tool_runs(session_id, tool_call, trace, knowledge_brain=None):
        raise AssertionError(f"unexpected tool call: {tool_call.tool_name}")

    executor._execute_tool_with_confirmation = fail_if_tool_runs

    def broken_local_guardian(*args, **kwargs):
        raise RuntimeError("guardian exploded")

    executor._local_review_output = broken_local_guardian

    request = ChatRequest(
        session_id="client-phase1-guardian-failclosed",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="Jarvis, explain what you can do now after the latest system upgrades. Keep it short and concrete.")],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-phase1-session")
    role_trace = executor.get_role_trace("canonical-phase1-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")

    assert canonical_session is not None and canonical_session.run_status == "idle"
    assert role_trace is not None
    assert role_trace["guardian"]["approved"] is False
    assert role_trace["guardian"]["failClosed"] is True
    assert role_trace["guardian"]["finalMode"] == "refused_answer"
    assert "couldn't safely finalize" in final_content.lower()


def test_phase1_role_trace_debug_store_shape_is_endpoint_ready():
    executor = Executor()
    executor._swarm.start_trace("session-debug-shape", "example query")
    executor._swarm.update_strategist(
        "session-debug-shape",
        lane="research",
        intent="factual_extract",
        riskLevel="medium",
        freshnessMatters=True,
        directRouteMatched=True,
        directRoute={"url": "https://www.iplt20.com/matches/points-table"},
        expectedEvidenceType="web_grounded_evidence",
        allowedToolScope=["web_search", "web_extract"],
        searchQueries=["IPL 2026 Chennai Super Kings points table wins losses"],
        reason="endpoint readiness fixture",
    )

    role_trace = executor.get_role_trace("session-debug-shape")

    assert role_trace is not None
    assert set(role_trace.keys()) == {"sessionId", "query", "strategist", "scout", "analyst", "guardian", "finalOutcome"}
    assert role_trace["strategist"]["searchQueries"] == ["IPL 2026 Chennai Super Kings points table wins losses"]
