import json
from typing import Any

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.agents import AgentProfile, AgentProfileStore
from src.contracts.chat import ChatMessage, ChatRequest, GatewayAgentProfileSnapshot, GatewayContextPayload
from src.executor import Executor
from src.gateway import GatewayExecutionError, GatewayService
from src.sessions import SessionManager


class FakeExecutor:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def execute(self, request, chroma_memory=None, knowledge_brain=None, mcp_discovery=None, gateway_context=None):
        self.calls.append(
            {
                "request": request,
                "gateway_context": gateway_context,
            }
        )
        yield json.dumps({"type": "content", "content": "ok"}) + "\n"
        yield json.dumps({"type": "done"}) + "\n"


def _service() -> GatewayService:
    return GatewayService(AgentProfileStore(workspace_root="E:/workspace/rawclaw"), SessionManager())


def test_gateway_service_uses_main_agent_by_default():
    service = _service()
    request = ChatRequest(session_id="s-1", messages=[ChatMessage(role="user", content="hello")])

    context = service.build_request_context(request)

    assert context.agent_profile.profile.id == "main"
    assert context.session_record.agent_id == "main"


def test_gateway_service_accepts_runtime_agent_snapshot():
    service = _service()
    request = ChatRequest(
        session_id="s-1",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="latest updates")],
        gateway_context=GatewayContextPayload(
            resolved_agent_profile=GatewayAgentProfileSnapshot(
                id="researcher",
                name="Researcher",
                workspace_id="proj-a",
                workspace_path="E:/workspace/rawclaw",
                default_model="ollama/llama3:8b",
                allowed_tools=["web_search", "web_extract"],
                memory_scope="workspace",
                prompt_files=[],
                research_defaults={"style": "grounded"},
                active=True,
            ),
            workspace_path="E:/workspace/rawclaw",
            memory_scope="workspace",
        ),
    )

    context = service.build_request_context(request)

    assert context.agent_profile.profile.id == "researcher"
    assert context.session_record.agent_id == "researcher"
    assert context.routing_binding == {}


def test_gateway_service_prefers_api_resolved_routing_binding_session():
    service = _service()
    request = ChatRequest(
        session_id="client-session",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="latest updates")],
        gateway_context=GatewayContextPayload(
            resolved_agent_profile=GatewayAgentProfileSnapshot(
                id="researcher",
                name="Researcher",
                workspace_id="proj-a",
                workspace_path="E:/workspace/rawclaw",
                default_model="ollama/llama3:8b",
                allowed_tools=["web_search"],
                memory_scope="workspace",
                prompt_files=[],
                research_defaults={},
                active=True,
            ),
            workspace_path="E:/workspace/rawclaw",
            memory_scope="workspace",
            routing_binding={
                "bindingId": "bind-1",
                "routingKey": "proj-a::desktop::chat::::researcher::0",
                "sessionId": "canonical-session",
                "workspaceId": "proj-a",
                "senderIdentifier": "desktop",
                "surfaceType": "chat",
                "threadKey": None,
                "channelKey": None,
                "agentId": "researcher",
                "parentSessionId": None,
                "parentRunId": None,
                "delegationDepth": 0,
                "allowedTools": ["web_search"],
            },
        ),
    )

    context = service.build_request_context(request)

    assert context.session_record.session_id == "canonical-session"
    assert context.session_record.sender_identifier == "desktop"
    assert context.routing_binding["bindingId"] == "bind-1"


def test_gateway_service_rejects_unknown_agent():
    service = _service()
    request = ChatRequest(
        session_id="s-1",
        agent_id="ghost",
        messages=[ChatMessage(role="user", content="hello")],
    )

    with pytest.raises(GatewayExecutionError):
        service.build_request_context(request)


@pytest.mark.asyncio
async def test_gateway_service_stream_chat_threads_context_and_resets_run_state():
    service = _service()
    request = ChatRequest(session_id="s-1", messages=[ChatMessage(role="user", content="hello")])
    executor = FakeExecutor()

    chunks = [chunk async for chunk in service.stream_chat(request, executor)]

    assert any("ok" in chunk for chunk in chunks)
    assert executor.calls
    gateway_context = executor.calls[0]["gateway_context"]
    assert gateway_context.agent_profile.profile.id == "main"
    assert gateway_context.session_record.session_id == "s-1"
    assert service.session_manager.get_optional("s-1").run_status == "idle"


def test_gateway_service_rejects_conflicting_session_agent_pairing():
    service = _service()
    first = ChatRequest(session_id="shared", messages=[ChatMessage(role="user", content="hello")])
    service.build_request_context(first)

    second = ChatRequest(
        session_id="shared",
        agent_id="researcher",
        messages=[ChatMessage(role="user", content="latest updates")],
        gateway_context=GatewayContextPayload(
            resolved_agent_profile=GatewayAgentProfileSnapshot(
                id="researcher",
                name="Researcher",
                workspace_id="default",
                workspace_path="E:/workspace/rawclaw",
                default_model="ollama/llama3:8b",
                allowed_tools=[],
                memory_scope="workspace",
                prompt_files=[],
                research_defaults={},
                active=True,
            )
        ),
    )

    with pytest.raises(GatewayExecutionError):
        service.build_request_context(second)


@pytest.mark.asyncio
async def test_executor_emits_gateway_metadata_in_provenance():
    executor = Executor()
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5:1.5b")
    executor.model_router.has_native_thinking = MagicMock(return_value=False)

    async def mock_complete(*args, **kwargs):
        yield {"type": "content", "content": "hello from model"}

    executor.model_router.complete = mock_complete

    store = AgentProfileStore(workspace_root="E:/workspace/rawclaw")
    store.register(
        AgentProfile(
            id="researcher",
            name="Researcher",
            workspace_id="default",
            workspace_path="E:/workspace/rawclaw",
            default_model="ollama/qwen2.5:1.5b",
            allowed_tools=[],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={},
            active=True,
        )
    )
    service = GatewayService(store, SessionManager())
    request = ChatRequest(session_id="s-1", agent_id="researcher", messages=[ChatMessage(role="user", content="hello")])

    first_chunk = None
    async for chunk in service.stream_chat(request, executor):
        parsed = json.loads(chunk)
        if parsed.get("type") == "provenance":
            first_chunk = parsed
            break

    assert first_chunk is not None
    metadata = first_chunk["provenance_trace"]["metadata"]
    assert metadata["agentId"] == "researcher"
    assert metadata["workspacePath"] == "E:/workspace/rawclaw"
    assert metadata["gatewaySession"]["session_id"] == "s-1"
    assert metadata["routingBinding"] == {}
