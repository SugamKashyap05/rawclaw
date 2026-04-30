from __future__ import annotations

from typing import Any, AsyncGenerator, Optional

from src.agents import AgentProfile, AgentProfileResolutionError, AgentProfileStore
from src.contracts.chat import ChatRequest
from src.gateway.types import GatewayRequestContext
from src.sessions import SessionManager, SessionOwnershipError


class GatewayExecutionError(ValueError):
    pass


class GatewayService:
    def __init__(self, profile_store: AgentProfileStore, session_manager: SessionManager) -> None:
        self.profile_store = profile_store
        self.session_manager = session_manager

    def _runtime_profile_from_request(self, request: ChatRequest) -> Optional[AgentProfile]:
        runtime = getattr(request, "gateway_context", None)
        if not runtime or not runtime.resolved_agent_profile:
            return None
        return AgentProfile(**runtime.resolved_agent_profile.model_dump())

    def build_request_context(self, request: ChatRequest) -> GatewayRequestContext:
        try:
            runtime_profile = self._runtime_profile_from_request(request)
            resolved_agent = self.profile_store.resolve(request.agent_id, runtime_profile=runtime_profile)
            runtime = getattr(request, "gateway_context", None)
            routing_binding = dict(getattr(runtime, "routing_binding", None) or {})
            resolved_session_id = str(routing_binding.get("sessionId") or request.session_id)
            resolved_workspace_id = str(routing_binding.get("workspaceId") or request.workspace_id or resolved_agent.profile.workspace_id)
            resolved_sender = str(routing_binding.get("senderIdentifier") or request.sender_identifier or "local")
            session_record = self.session_manager.resolve_or_create(
                resolved_session_id,
                resolved_agent,
                workspace_id=resolved_workspace_id,
                sender_identifier=resolved_sender,
            )
        except (AgentProfileResolutionError, SessionOwnershipError) as exc:
            raise GatewayExecutionError(str(exc)) from exc

        workspace_path = (runtime.workspace_path if runtime and runtime.workspace_path else resolved_agent.workspace_path)
        memory_scope = (runtime.memory_scope if runtime and runtime.memory_scope else resolved_agent.memory_scope)

        metadata = {
            "agentId": resolved_agent.profile.id,
            "agentProfile": resolved_agent.profile.name,
            "workspacePath": workspace_path,
            "gatewaySession": session_record.session_id,
            "runStatus": session_record.run_status,
            "routingBinding": routing_binding,
        }
        return GatewayRequestContext(
            agent_profile=resolved_agent,
            session_record=session_record,
            workspace_path=workspace_path,
            memory_scope=memory_scope,
            routing_binding=routing_binding,
            metadata=metadata,
        )

    async def stream_chat(
        self,
        request: ChatRequest,
        executor: Any,
        *,
        use_langgraph: bool = False,
        chroma_memory=None,
        knowledge_brain=None,
        mcp_discovery=None,
    ) -> AsyncGenerator[str, None]:
        context = self.build_request_context(request)
        request.session_id = context.session_record.session_id
        request.workspace_id = context.session_record.workspace_id
        request.sender_identifier = context.session_record.sender_identifier
        request.agent_id = context.agent_profile.profile.id

        async with self.session_manager.run_context(context.session_record.session_id):
            context.metadata["runStatus"] = "running"
            if use_langgraph:
                model_id = request.model or context.agent_profile.model_id or context.agent_profile.profile.default_model or "default"
                async for chunk in executor.execute(
                    [m.model_dump() if hasattr(m, "model_dump") else m for m in request.messages],
                    session_id=context.session_record.session_id,
                    model_id=model_id,
                    chroma_memory=chroma_memory,
                    knowledge_brain=knowledge_brain,
                ):
                    yield chunk
                return

            async for chunk in executor.execute(
                request,
                chroma_memory,
                knowledge_brain,
                mcp_discovery,
                gateway_context=context,
            ):
                yield chunk
