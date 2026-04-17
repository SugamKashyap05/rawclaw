"""
LangGraph executor - wraps LangGraph StateGraph for RawClaw.
"""
import json
import logging
from typing import Any, Dict, List, AsyncGenerator

from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage

from src.graph.state import AgentState
from src.graph.builder import build_graph
from src.tools.registry import TOOL_REGISTRY
from src.tools.confirmation_gate import ConfirmationGate

logger = logging.getLogger("rawclaw.graph.executor")


class LangGraphExecutor:
    """Executor using LangGraph StateGraph."""

    def __init__(self) -> None:
        self.checkpointer = MemorySaver()
        self.confirmation_gate = ConfirmationGate()

    async def execute(
        self,
        messages: List[Dict[str, Any]],
        session_id: str = "default",
        model_id: str = "anthropic/claude-3-sonnet-20240229",
        chroma_memory=None,
        knowledge_brain=None,
    ) -> AsyncGenerator[str, None]:
        """
        Execute using LangGraph, yielding NDJSON chunks.
        """
        lc_messages = self._convert_messages(messages)

        latest_user_query = next(
            (message.get("content", "") for message in reversed(messages) if message.get("role") == "user" and message.get("content", "").strip()),
            "",
        )
        if knowledge_brain and latest_user_query:
            retrieved_context = knowledge_brain.build_context(latest_user_query, session_id=session_id)
            if retrieved_context:
                lc_messages.insert(
                    0,
                    HumanMessage(
                        content=(
                            "Reference knowledge for this response:\n"
                            f"{retrieved_context}"
                        )
                    ),
                )

        if session_id and chroma_memory:
            history = chroma_memory.get_session_history(session_id, limit=10)
            if history:
                for msg in history:
                    role = msg.get("role", "user")
                    content = msg.get("content", "")
                    if role == "user":
                        lc_messages.insert(0, HumanMessage(content=content))
                    elif role == "assistant":
                        lc_messages.insert(0, AIMessage(content=content))

        config = {"configurable": {"thread_id": session_id}}

        try:
            graph = build_graph(model_id, self.checkpointer, self.confirmation_gate)

            async for chunk in graph.astream(
                {
                    "messages": lc_messages,
                    "session_id": session_id,
                    "model_id": model_id,
                    "tool_confirmations_pending": [],
                    "metadata": {},
                },
                config,
            ):
                async for item in self._process_chunk(chunk, session_id):
                    yield item

        except Exception as e:
            logger.error(f"LangGraph execution error: {e}")
            yield json.dumps({
                "type": "error",
                "message": str(e),
            }) + "\n"

        yield json.dumps({"type": "done"}) + "\n"

    def _convert_messages(
        self,
        messages: List[Dict[str, Any]],
    ) -> List[BaseMessage]:
        """Convert dict messages to LangChain messages."""
        lc_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            elif role == "system":
                lc_messages.append(HumanMessage(content=f"System: {content}"))
            elif role == "tool":
                tool_name = msg.get("name", "")
                lc_messages.append(ToolMessage(
                    content=content,
                    tool_call_id=tool_name,
                ))
        return lc_messages

    async def _process_chunk(
        self,
        chunk: Dict[str, Any],
        session_id: str,
    ) -> AsyncGenerator[str, None]:
        """Process a graph chunk and yield NDJSON."""
        for node_name, node_data in chunk.items():
            if node_name == "agent":
                msgs = node_data.get("messages", [])
                for msg in msgs:
                    if hasattr(msg, "content") and msg.content:
                        yield json.dumps({
                            "type": "content",
                            "content": msg.content,
                        }) + "\n"

                    if hasattr(msg, "tool_calls") and msg.tool_calls:
                        for tc in msg.tool_calls:
                            yield json.dumps({
                                "type": "tool_call",
                                "tool_call": {
                                    "name": tc.get("name", ""),
                                    "arguments": tc.get("args", {}),
                                },
                            }) + "\n"

            elif node_name == "tools":
                msgs = node_data.get("messages", [])
                for msg in msgs:
                    if hasattr(msg, "tool_call_id") and msg.tool_call_id:
                        result_content = msg.content
                        yield json.dumps({
                            "type": "tool_result",
                            "tool_call": {"name": msg.tool_call_id},
                            "tool_result": {
                                "tool_name": msg.tool_call_id,
                                "output": result_content,
                            },
                        }) + "\n"


LANGGRAPH_EXECUTOR = LangGraphExecutor()
