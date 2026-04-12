"""
Executor — Main agent execution loop with tool calling.

Handles:
  - Streaming responses from model router
  - Tool calling with confirmation gates
  - Provenance tracing
  - Error handling (never propagates exceptions)
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional, AsyncGenerator

from src.contracts.tool import ToolCall, ToolResult
from src.contracts.chat import ChatRequest, ChatMessage
from src.models.router import ModelRouter
from src.tools.registry import TOOL_REGISTRY, ToolNotFoundError
from src.tools.confirmation_gate import ConfirmationGate
from src.provenance.trace import ProvenanceTrace
from src.config import settings

logger = logging.getLogger("rawclaw.executor")


class Executor:
    """
    Executes chat requests with tool calling support.
    """

    def __init__(self) -> None:
        self.model_router = ModelRouter()
        self.confirmation_gate = ConfirmationGate()

    async def execute(
        self,
        request: ChatRequest,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Execute a chat request with planning, tool calling, and synthesis.

        Yields SSE-formatted JSON chunks.
        """
        trace = ProvenanceTrace()
        start_time = time.time()

        messages = [m.model_dump() for m in request.messages]
        tools_schema = TOOL_REGISTRY.get_schemas()

        accumulated_content = ""
        tool_calls_made: List[ToolCall] = []
        sources: List[str] = []

        try:
            # Initial planning step
            trace.add_plan_step(f"Processing request with {len(messages)} messages")

            # Stream from model
            async for delta in self.model_router.complete(
                messages,
                model=request.model,
                complexity=request.complexity,
                tools=tools_schema if tools_schema else None,
            ):
                # Check if model wants to call a tool
                if isinstance(delta, dict) and delta.get("type") == "tool_call":
                    tool_call_data = delta.get("tool_call", {})
                    tool_call = ToolCall(
                        tool_name=tool_call_data.get("name", ""),
                        input=tool_call_data.get("arguments", {}),
                    )

                    # Record tool call
                    trace.add_tool_call(tool_call.tool_name, tool_call.input)

                    # Execute the tool
                    tool_result = await self._execute_tool_with_confirmation(
                        request.session_id,
                        tool_call,
                        trace,
                    )

                    # Record tool result
                    trace.add_tool_result(tool_result, int(tool_result.duration_ms))

                    # Track for response
                    tool_calls_made.append(tool_call)
                    if tool_result.source_url:
                        sources.append(tool_result.source_url)

                    # Yield tool result to stream
                    yield json.dumps({
                        "type": "tool_result",
                        "tool_call": tool_call.model_dump(),
                        "tool_result": tool_result.model_dump(),
                    }) + "\n"

                    # Add tool result to messages for next turn
                    messages.append({
                        "role": "tool",
                        "content": json.dumps(tool_result.model_dump()),
                        "name": tool_call.tool_name,
                    })

                elif isinstance(delta, str):
                    accumulated_content += delta
                    yield json.dumps({
                        "type": "content",
                        "content": delta,
                    }) + "\n"

                elif isinstance(delta, dict) and delta.get("type") == "content":
                    content = delta.get("content", "")
                    accumulated_content += content
                    yield json.dumps({
                        "type": "content",
                        "content": content,
                    }) + "\n"

            # Final synthesis step
            duration_ms = round((time.time() - start_time) * 1000, 2)
            trace.add_synthesis_step(accumulated_content[:200] + "...", int(duration_ms))

            # Yield provenance trace
            yield json.dumps({
                "type": "provenance",
                "provenance_trace": trace.to_dict(),
            }) + "\n"

            # Yield sources
            if sources:
                yield json.dumps({
                    "type": "sources",
                    "sources": list(set(sources)),
                }) + "\n"

            # Done
            yield json.dumps({"type": "done"}) + "\n"

        except Exception as e:
            logger.error(f"Executor error: {e}")
            trace.add_error_step(str(e))
            yield json.dumps({
                "type": "error",
                "message": str(e),
                "provenance_trace": trace.to_dict(),
            }) + "\n"

    async def _execute_tool_with_confirmation(
        self,
        session_id: str,
        tool_call: ToolCall,
        trace: ProvenanceTrace,
    ) -> ToolResult:
        """
        Execute a tool, handling confirmation gate if needed.
        Never raises - errors are captured in ToolResult.
        """
        start = time.time()
        tool_name = tool_call.tool_name
        tool_input = tool_call.input

        try:
            tool = TOOL_REGISTRY.get(tool_name)

            # Check if confirmation is required
            if tool.requires_confirmation:
                result = await self.confirmation_gate.check_and_execute(
                    session_id,
                    tool_name,
                    tool_input,
                    lambda: tool.execute(tool_input),
                )
                return result

            # Execute directly
            return await tool.execute(tool_input)

        except ToolNotFoundError:
            return ToolResult(
                tool_name=tool_name,
                input=tool_input,
                error=f"Tool '{tool_name}' not found",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        except Exception as e:
            logger.error(f"Tool execution error for {tool_name}: {e}")
            return ToolResult(
                tool_name=tool_name,
                input=tool_input,
                error=f"Tool execution failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )


# Global executor instance
EXECUTOR = Executor()