import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.agents import AgentProfile, AgentProfileStore
from src.contracts.chat import (
    ChatMessage,
    ChatRequest,
    GatewayAgentProfileSnapshot,
    GatewayContextPayload,
)
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
            allowed_tools=["web_search", "web_extract"],
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
            allowed_tools=["web_search", "web_extract"],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={"style": "grounded"},
            active=True,
        ),
        workspace_path="E:/workspace/rawclaw",
        memory_scope="workspace",
        routing_binding={
            "bindingId": "bind-chat-smoke",
            "routingKey": "proj-a::chat::user-1::thread-a::::researcher::0",
            "sessionId": "canonical-chat-session",
            "workspaceId": "proj-a",
            "senderIdentifier": "user-1",
            "surfaceType": "chat",
            "threadKey": "thread-a",
            "channelKey": None,
            "agentId": "researcher",
            "parentSessionId": None,
            "parentRunId": None,
            "delegationDepth": 0,
            "allowedTools": ["web_search", "web_extract"],
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
async def test_single_session_chat_smoke_covers_gateway_research_and_standings_answer():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_search":
            return _tool_result(
                "web_search",
                output={
                    "results": [
                        {
                            "title": "IPL 2026 Points Table",
                            "url": "https://www.iplt20.com/matches/points-table",
                            "snippet": "Official IPL 2026 points table with Chennai Super Kings listed 6th on 6 points with NRR -0.121.",
                            "quality_tags": ["official_page"],
                        }
                    ],
                    "status": "ok",
                },
            )
        if tool_call.tool_name == "web_extract":
            return _tool_result(
                "web_extract",
                output={
                    "url": "https://www.iplt20.com/matches/points-table",
                    "title": "IPL 2026 Points Table | Team Standings and Rankings | IPLT20",
                    "content": (
                        "Chennai Super Kings are 6 in the IPL 2026 points table. "
                        "They have 6 points. NRR is -0.121. Signals: recent form W,W,L,W,L."
                    ),
                    "structuredData": {
                        "team": "Chennai Super Kings",
                        "position": "6",
                        "points": "6",
                        "nrr": "-0.121",
                        "ranking_movement": ["recent form W,W,L,W,L"],
                    },
                    "backendUsed": "iplt20_official_feed",
                    "backendAttempts": [
                        {"backend": "iplt20_official_feed", "tool": "web_fetch", "status": "ok", "quality": "extract_partial"}
                    ],
                    "taskType": "factual_extract",
                    "sourceMode": "hybrid",
                    "pageType": "data_table",
                    "quality": "extract_partial",
                    "missingFields": [],
                    "interactionRequired": False,
                    "pageKind": "standings/table",
                },
                source_url="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/feeds/stats/284-groupstandings.js",
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    greeting_request = ChatRequest(
        session_id="client-session",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="hello")],
        gateway_context=_routing_context(),
    )
    greeting_events = await _collect_events(service, executor, greeting_request)

    research_request = ChatRequest(
        session_id="client-session",
        agent_id="researcher",
        messages=[
            ChatMessage(role="user", content="hello"),
            ChatMessage(
                role="user",
                content="Open the official IPL 2026 points table page and tell me Chennai Super Kings standing.",
            ),
        ],
        gateway_context=_routing_context(),
    )
    research_events = await _collect_events(service, executor, research_request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in research_events if event.get("type") == "content")
    provenance_events = [event for event in research_events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    stage_metadata = (final_provenance.get("metadata") or {}).get("internalResearchStages") or {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in research_events
        if event.get("type") == "tool_call"
    ]

    feature_status = {
        "routing_binding_applied": canonical_session is not None and canonical_session.session_id == "canonical-chat-session",
        "session_reused_and_owned": canonical_session is not None and canonical_session.agent_id == "researcher",
        "greeting_short_circuit": any(
            event.get("type") == "content" and "How can I help you today?" in event.get("content", "")
            for event in greeting_events
        ),
        "research_tools_called": tool_call_names == ["web_extract"],
        "planner_and_router_metadata_present": {
            "research-planner",
            "extract-router",
            "multi-attempt-extract",
            "confidence-risk-model",
        }.issubset(stage_metadata.keys()),
        "task_context_marked_factual_extract": (final_provenance.get("metadata") or {}).get("webTaskContext", {}).get("taskType") == "factual_extract",
        "task_classification_alias_present": (final_provenance.get("metadata") or {}).get("taskClassification", {}).get("taskType") == "factual_extract",
        "page_classification_alias_present": (final_provenance.get("metadata") or {}).get("pageClassification", {}).get("pageType") == "data_table",
        "source_mode_alias_present": (final_provenance.get("metadata") or {}).get("sourceSelectionMode") == "hybrid",
        "evidence_gate_full_or_cautious": (final_provenance.get("metadata") or {}).get("evidenceGate", {}).get("mode") in {"PROCEED_FULL", "PROCEED_CAUTIOUS"},
        "evidence_gate_alias_present": (final_provenance.get("metadata") or {}).get("evidenceGateDecision", {}).get("mode") in {"PROCEED_FULL", "PROCEED_CAUTIOUS"},
        "meaningful_csk_output": (
            "chennai super kings" in final_content.lower()
            and ("6 points" in final_content.lower() or "-0.121" in final_content.lower())
            and "could not verify the exact current standings race picture" not in final_content.lower()
        ),
        "provenance_kept_gateway_metadata": (
            (final_provenance.get("metadata") or {}).get("agentId") == "researcher"
            and ((final_provenance.get("metadata") or {}).get("routingBinding") or {}).get("bindingId") == "bind-chat-smoke"
            and ((final_provenance.get("metadata") or {}).get("gatewaySession") or {}).get("session_id") == "canonical-chat-session"
        ),
        "session_returns_idle": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), feature_status


@pytest.mark.asyncio
async def test_single_session_chat_uses_planner_target_url_when_search_provider_fails():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_search":
            return _tool_result(
                "web_search",
                output={"status": "network_failure", "results": []},
                error="DuckDuckGo search failed (may be rate limited or network issue).",
            )
        if tool_call.tool_name == "web_extract":
            assert tool_call.input.get("url") == "https://www.iplt20.com/matches/points-table"
            return _tool_result(
                "web_extract",
                output={
                    "url": "https://www.iplt20.com/matches/points-table",
                    "title": "IPL 2026 Points Table | Team Standings and Rankings | IPLT20",
                    "content": "Chennai Super Kings are 6th with 6 points and NRR -0.121.",
                    "structuredData": {
                        "team": "Chennai Super Kings",
                        "position": "6",
                        "points": "6",
                        "nrr": "-0.121",
                    },
                    "backendUsed": "iplt20_official_feed",
                    "taskType": "factual_extract",
                    "sourceMode": "hybrid",
                    "pageType": "data_table",
                    "quality": "extract_partial",
                    "missingFields": [],
                    "interactionRequired": False,
                    "pageKind": "standings/table",
                },
                source_url="https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/feeds/stats/284-groupstandings.js",
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    research_request = ChatRequest(
        session_id="client-session-provider-outage",
        agent_id="researcher",
        messages=[
            ChatMessage(
                role="user",
                content="Open the official IPL 2026 points table page and tell me Chennai Super Kings standing.",
            ),
        ],
        gateway_context=_routing_context(),
    )
    research_events = await _collect_events(service, executor, research_request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in research_events if event.get("type") == "content")
    provenance_events = [event for event in research_events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    stage_metadata = (final_provenance.get("metadata") or {}).get("internalResearchStages") or {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in research_events
        if event.get("type") == "tool_call"
    ]

    feature_status = {
        "direct_extract_happened": tool_call_names == ["web_extract"],
        "extract_router_kept_target_url": "https://www.iplt20.com/matches/points-table"
        in (stage_metadata.get("extract-router", {}) or {}).get("candidate_urls", []),
        "confidence_risk_stage_present": "confidence-risk-model" in stage_metadata,
        "task_context_marked_factual_extract": (final_provenance.get("metadata") or {}).get("webTaskContext", {}).get("taskType") == "factual_extract",
        "evidence_gate_stayed_live": (final_provenance.get("metadata") or {}).get("evidenceGate", {}).get("mode") in {"PROCEED_FULL", "PROCEED_CAUTIOUS"},
        "final_answer_mentions_csk_standing": "chennai super kings" in final_content.lower()
        and any(token in final_content.lower() for token in ["6th", "6 points", "-0.121"]),
        "session_idle_again": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), feature_status


@pytest.mark.asyncio
async def test_single_session_chat_typo_standings_query_escalates_to_direct_official_extract():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_search":
            return _tool_result(
                "web_search",
                output={
                    "results": [
                        {
                            "title": "IPL 2026 Points Table",
                            "url": "https://www.iplt20.com/matches/points-table",
                            "snippet": "Official IPL 2026 points table with Chennai Super Kings listed 6th on 6 points with NRR -0.121.",
                            "quality_tags": ["official_page"],
                        }
                    ],
                    "status": "ok",
                },
            )
        if tool_call.tool_name == "web_extract":
            return _tool_result(
                "web_extract",
                output={
                    "url": "https://www.iplt20.com/matches/points-table",
                    "title": "IPL 2026 Points Table | Team Standings and Rankings | IPLT20",
                    "content": "Chennai Super Kings are 6 in the IPL 2026 points table. They have 6 points. NRR is -0.121.",
                    "structuredData": {
                        "team": "Chennai Super Kings",
                        "position": "6",
                        "points": "6",
                        "nrr": "-0.121",
                    },
                    "backendUsed": "iplt20_official_feed",
                    "taskType": "factual_extract",
                    "sourceMode": "system_chosen",
                    "pageType": "data_table",
                    "quality": "extract_partial",
                    "tier": "partial",
                    "confidence": 0.68,
                    "missingFields": [],
                    "interactionRequired": False,
                    "pageKind": "standings/table",
                },
                source_url="https://www.iplt20.com/matches/points-table",
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    request = ChatRequest(
        session_id="client-session-typo-standings",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="csk standing in ipl point tabel")],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]

    assert tool_call_names == ["web_extract"]
    assert "chennai super kings" in final_content.lower()
    assert any(token in final_content.lower() for token in ["6 points", "-0.121", "position 6", "6th"])
    assert canonical_session is not None and canonical_session.run_status == "idle"


@pytest.mark.asyncio
async def test_single_session_chat_live_sports_query_direct_routes_to_official_extract():
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
                },
                source_url="https://www.iplt20.com/matches/points-table",
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    request = ChatRequest(
        session_id="client-session-direct-route",
        agent_id="researcher",
        messages=[
            ChatMessage(
                role="user",
                content="do a web search to find out about ipl 2026 csk match points with how many wins and losses",
            )
        ],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    provenance_events = [event for event in events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]
    direct_route_metadata = (final_provenance.get("metadata") or {}).get("directRoute") or {}

    assert tool_call_names == ["web_extract"]
    assert direct_route_metadata.get("url") == "https://www.iplt20.com/matches/points-table"
    assert "chennai super kings" in final_content.lower()
    assert "6 points" in final_content.lower()
    assert canonical_session is not None and canonical_session.run_status == "idle"


@pytest.mark.asyncio
async def test_single_session_chat_direct_url_thin_extract_stays_cautious():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_extract":
            return _tool_result(
                "web_extract",
                output={
                    "url": "https://medium.com/example/dev-article",
                    "title": "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014",
                    "content": "Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience.",
                    "structuredData": {
                        "event": "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014",
                        "what_changed": "Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience.",
                    },
                    "backendUsed": "web_fetch_raw_html_article",
                    "backendAttempts": [
                        {"backend": "web_fetch_raw_html_article", "tool": "web_fetch", "status": "ok", "quality": "extract_clean"}
                    ],
                    "quality": "extract_clean",
                    "taskType": "page_read",
                    "sourceMode": "user_named",
                    "pageType": "article",
                    "tier": "thin",
                    "confidence": 0.44,
                    "extractionMethod": "web_fetch_raw_html_article",
                    "wordCount": 16,
                    "paywallSignal": False,
                    "jsRenderSuspected": False,
                    "missingFields": ["date_time"],
                    "interactionRequired": False,
                    "pageKind": "news/article",
                },
                source_url="https://medium.com/example/dev-article",
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    request = ChatRequest(
        session_id="client-session-direct-url",
        agent_id="researcher",
        messages=[
            ChatMessage(
                role="user",
                content="https://medium.com/example/dev-article tell me about this article",
            ),
        ],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    provenance_events = [event for event in events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    metadata = final_provenance.get("metadata") or {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]

    feature_status = {
        "forced_direct_extract": tool_call_names == ["web_extract"],
        "quality_summary_thin": (metadata.get("extractionQualitySummary") or {}).get("tier") == "thin",
        "evidence_gate_cautious": (metadata.get("evidenceGate") or {}).get("mode") == "PROCEED_CAUTIOUS",
        "final_answer_stays_cautious": "Based on the recovered article fragments" in final_content
        and "recovered page fragments directly support" in final_content,
        "session_idle_again": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), feature_status


@pytest.mark.asyncio
async def test_single_session_chat_direct_url_failed_extract_falls_back_to_search_summary():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_extract":
            return _tool_result(
                "web_extract",
                output={
                    "url": "https://www.msn.com/en-in/sports/cricket/rinku-singh-creates-history-breaks-ms-dhoni-s-15-year-old-record-during-lsg-vs-kkr-tie/ar-AA21MNqQ",
                    "title": "",
                    "content": "",
                    "structuredData": {},
                    "backendUsed": "none",
                    "backendAttempts": [{"backend": "web_fetch", "tool": "web_fetch", "status": "error"}],
                    "quality": "extract_garbage",
                    "taskType": "page_read",
                    "sourceMode": "user_named",
                    "pageType": "sparse",
                    "tier": "failed",
                    "confidence": 0.05,
                    "extractionMethod": "none",
                    "wordCount": 0,
                    "paywallSignal": False,
                    "jsRenderSuspected": False,
                    "missingFields": [],
                    "interactionRequired": False,
                    "pageKind": "news/article",
                },
                error="No extraction backend produced usable content.",
                source_url="https://www.msn.com/en-in/sports/cricket/rinku-singh-creates-history-breaks-ms-dhoni-s-15-year-old-record-during-lsg-vs-kkr-tie/ar-AA21MNqQ",
            )
        if tool_call.tool_name == "web_search":
            assert "site:msn.com" in str(tool_call.input.get("query") or "")
            return _tool_result(
                "web_search",
                output={
                    "results": [
                        {
                            "title": "Rinku Singh creates history, breaks MS Dhoni's 15-year-old record",
                            "url": "https://www.msn.com/en-in/sports/cricket/rinku-singh-creates-history-breaks-ms-dhoni-s-15-year-old-record-during-lsg-vs-kkr-tie/ar-AA21MNqQ",
                            "snippet": "Rinku Singh set a new wicketkeeping-related milestone during the LSG vs KKR tie, surpassing a record held by MS Dhoni.",
                            "quality_tags": ["search_snippet"],
                        }
                    ],
                    "status": "ok",
                },
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    request = ChatRequest(
        session_id="client-session-direct-url-search-fallback",
        agent_id="researcher",
        messages=[
            ChatMessage(
                role="user",
                content="https://www.msn.com/en-in/sports/cricket/rinku-singh-creates-history-breaks-ms-dhoni-s-15-year-old-record-during-lsg-vs-kkr-tie/ar-AA21MNqQ what on this",
            ),
        ],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]

    feature_status = {
        "extract_then_search_fallback": tool_call_names == ["web_extract", "web_search"],
        "fallback_answer_mentions_direct_failure": "could not read the requested page directly" in final_content.lower(),
        "fallback_answer_mentions_search_evidence": "fallback summary rather than a direct page reading" in final_content.lower(),
        "fallback_answer_mentions_rinku": "rinku singh" in final_content.lower(),
        "session_idle_again": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), feature_status


@pytest.mark.asyncio
async def test_single_session_chat_direct_url_transport_failure_mentions_fetch_layer():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_extract":
            return _tool_result(
                "web_extract",
                output={
                    "url": "https://example.com/",
                    "title": "",
                    "content": "",
                    "structuredData": {},
                    "backendUsed": "none",
                    "backendAttempts": [
                        {
                            "backend": "web_fetch",
                            "tool": "web_fetch",
                            "status": "error",
                            "fetchFailureKind": "socket_permission_denied",
                            "networkError": "All connection attempts failed",
                        }
                    ],
                    "quality": "extract_garbage",
                    "taskType": "page_read",
                    "sourceMode": "user_named",
                    "pageType": "sparse",
                    "tier": "failed",
                    "confidence": 0.05,
                    "extractionMethod": "none",
                    "wordCount": 0,
                    "paywallSignal": False,
                    "jsRenderSuspected": False,
                    "missingFields": [],
                    "interactionRequired": False,
                    "pageKind": "general",
                    "fetchFailureKind": "socket_permission_denied",
                    "networkError": "All connection attempts failed",
                    "httpStatus": None,
                    "redirectedUrl": "https://example.com/",
                },
                error="HTTP error: All connection attempts failed",
                source_url="https://example.com/",
            )
        if tool_call.tool_name == "web_search":
            return _tool_result(
                "web_search",
                output={"status": "network_failure", "results": []},
                error="DuckDuckGo search failed (may be rate limited or network issue).",
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    request = ChatRequest(
        session_id="client-session-transport-failure",
        agent_id="researcher",
        messages=[
            ChatMessage(
                role="user",
                content="https://example.com/ what is on this page",
            ),
        ],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]

    feature_status = {
        "extract_then_search_attempted": tool_call_names == ["web_extract", "web_search"],
        "final_answer_mentions_transport_layer": "transport layer" in final_content.lower(),
        "final_answer_mentions_failure_kind": "socket_permission_denied" in final_content.lower(),
        "session_idle_again": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), feature_status


@pytest.mark.asyncio
async def test_single_session_chat_self_capability_prompt_stays_local_and_skips_web_tools():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def fail_if_tool_runs(session_id, tool_call, trace, knowledge_brain=None):
        raise AssertionError(f"unexpected tool call: {tool_call.tool_name}")

    executor._execute_tool_with_confirmation = fail_if_tool_runs

    request = ChatRequest(
        session_id="client-session-self-capability",
        agent_id="researcher",
        messages=[
            ChatMessage(
                role="user",
                content="Jarvis, explain what you can do now after the latest system upgrades. Keep it short and concrete.",
            ),
        ],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    provenance_events = [event for event in events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    metadata = final_provenance.get("metadata") or {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]

    feature_status = {
        "no_tools_called": tool_call_names == [],
        "intent_type_recorded": metadata.get("intentType") == "self_capability",
        "intent_metadata_marks_local_answer": (metadata.get("initialIntentClassification") or {}).get("usedLocalSelfKnowledge") is True,
        "local_capability_answer_returned": "local-first JARVIS-style assistant" in final_content
        and "ask a short clarifying question" in final_content,
        "session_idle_again": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), feature_status


@pytest.mark.asyncio
async def test_single_session_chat_ambiguous_top_news_prompt_asks_clarifying_question():
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def fail_if_tool_runs(session_id, tool_call, trace, knowledge_brain=None):
        raise AssertionError(f"unexpected tool call: {tool_call.tool_name}")

    executor._execute_tool_with_confirmation = fail_if_tool_runs

    request = ChatRequest(
        session_id="client-session-clarification",
        agent_id="researcher",
        messages=[
            ChatMessage(
                role="user",
                content="Jarvis, tell me the top news.",
            ),
        ],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    provenance_events = [event for event in events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    metadata = final_provenance.get("metadata") or {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]

    feature_status = {
        "no_tools_called": tool_call_names == [],
        "intent_type_recorded": metadata.get("intentType") == "clarification_needed",
        "intent_metadata_marks_clarification": (metadata.get("initialIntentClassification") or {}).get("clarificationQuestion") is True,
        "clarifying_question_returned": final_content.strip() == "Do you want general web news, or top news from a specific site?",
        "session_idle_again": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), feature_status


VERIFIED_WEB_LOYALTY_CASES = [
    {
        "id": "example_domain",
        "query": "Search the web for example.com and tell me what the page says.",
        "search_query_contains": "example.com",
        "url": "https://example.com/",
        "title": "Example Domain",
        "search_snippet": "Example Domain is a placeholder site used in examples.",
        "extract_content": (
            "Example Domain. This domain is for use in documentation examples without needing permission. "
            "Avoid use in operations."
        ),
        "structured_data": {
            "page_items": [
                "This domain is for use in documentation examples without needing permission.",
                "Avoid use in operations.",
            ]
        },
        "page_kind": "general",
        "page_type": "article",
        "expected_phrases": [
            "documentation examples",
            "avoid use in operations",
        ],
    },
    {
        "id": "iana_reserved_domains",
        "query": "Search the web for the IANA reserved domains page and tell me what it says about example domains.",
        "search_query_contains": "iana",
        "url": "https://www.iana.org/domains/reserved",
        "title": "IANA-managed Reserved Domains",
        "search_snippet": "The IANA reserved domains page lists example.com, example.org, and example.net.",
        "extract_content": (
            "Example domains are maintained for documentation purposes. "
            "These domains may be used as illustrative examples in documents without prior coordination with us. "
            "They are not available for registration or transfer."
        ),
        "structured_data": {
            "page_items": [
                "Example domains are maintained for documentation purposes.",
                "They are not available for registration or transfer.",
            ]
        },
        "page_kind": "general",
        "page_type": "article",
        "expected_phrases": [
            "documentation purposes",
            "not available for registration or transfer",
        ],
    },
    {
        "id": "python_3144_release",
        "query": "Search the web for the Python 3.14.4 release page and summarize the release details.",
        "search_query_contains": "Python 3.14.4",
        "url": "https://www.python.org/downloads/release/python-3144/",
        "title": "Python Release Python 3.14.4",
        "search_snippet": "Python 3.14.4 is a maintenance release in the Python 3.14 series.",
        "extract_content": (
            "Python 3.14.4 is the fourth maintenance release of Python 3.14. "
            "Release date: April 7, 2026."
        ),
        "structured_data": {
            "event": "Python 3.14.4 release",
            "what_changed": "Fourth maintenance release of Python 3.14.",
            "date_time": "April 7, 2026",
        },
        "page_kind": "news/article",
        "page_type": "article",
        "expected_phrases": [
            "fourth maintenance release",
            "april 7, 2026",
        ],
    },
]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", VERIFIED_WEB_LOYALTY_CASES, ids=[case["id"] for case in VERIFIED_WEB_LOYALTY_CASES])
async def test_single_session_chat_search_summary_stays_loyal_to_web_extract_facts(case):
    service, _store, session_manager = _gateway_service()
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_tool_execution(session_id, tool_call, trace, knowledge_brain=None):
        if tool_call.tool_name == "web_search":
            assert case["search_query_contains"].lower() in str(tool_call.input.get("query") or "").lower()
            return _tool_result(
                "web_search",
                output={
                    "results": [
                        {
                            "title": case["title"],
                            "url": case["url"],
                            "snippet": case["search_snippet"],
                            "quality_tags": ["official_page"],
                        }
                    ],
                    "status": "ok",
                },
            )
        if tool_call.tool_name == "web_extract":
            assert str(tool_call.input.get("url") or "") == case["url"]
            return _tool_result(
                "web_extract",
                output={
                    "url": case["url"],
                    "title": case["title"],
                    "content": case["extract_content"],
                    "structuredData": case["structured_data"],
                    "backendUsed": "verified_fixture_extract",
                    "backendAttempts": [
                        {
                            "backend": "verified_fixture_extract",
                            "tool": "web_fetch",
                            "status": "ok",
                            "quality": "extract_clean",
                        }
                    ],
                    "taskType": "research",
                    "sourceMode": "system_chosen",
                    "pageType": case["page_type"],
                    "quality": "extract_clean",
                    "tier": "clean",
                    "confidence": 1,
                    "extractionMethod": "verified_fixture_extract",
                    "wordCount": len(case["extract_content"].split()),
                    "paywallSignal": False,
                    "jsRenderSuspected": False,
                    "missingFields": [],
                    "interactionRequired": False,
                    "pageKind": case["page_kind"],
                },
                source_url=case["url"],
            )
        return _tool_result(tool_call.tool_name, output={"status": "ok"})

    executor._execute_tool_with_confirmation = mock_tool_execution

    request = ChatRequest(
        session_id=f"client-session-loyalty-{case['id']}",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content=case["query"])],
        gateway_context=_routing_context(),
    )
    events = await _collect_events(service, executor, request)

    canonical_session = session_manager.get_optional("canonical-chat-session")
    final_content = "\n".join(event.get("content", "") for event in events if event.get("type") == "content")
    provenance_events = [event for event in events if event.get("type") == "provenance"]
    final_provenance = provenance_events[-1]["provenance_trace"] if provenance_events else {}
    metadata = final_provenance.get("metadata") or {}
    tool_call_names = [
        event.get("tool_call", {}).get("name")
        for event in events
        if event.get("type") == "tool_call"
    ]

    final_lower = final_content.lower()
    expected_phrases = [phrase.lower() for phrase in case["expected_phrases"]]

    feature_status = {
        "search_then_extract_happened": tool_call_names == ["web_search", "web_extract"],
        "page_classification_recorded": (metadata.get("pageClassification") or {}).get("pageType") == case["page_type"],
        "source_mode_recorded": (metadata.get("sourceSelectionMode") or "") in {"system_chosen", "hybrid"},
        "final_answer_uses_extract_facts": all(phrase in final_lower for phrase in expected_phrases),
        "final_answer_not_weak_abstain": "could not verify a fully reliable final answer" not in final_lower,
        "session_idle_again": canonical_session is not None and canonical_session.run_status == "idle",
    }

    assert all(feature_status.values()), {
        **feature_status,
        "final_content": final_content,
        "metadata": metadata,
    }
