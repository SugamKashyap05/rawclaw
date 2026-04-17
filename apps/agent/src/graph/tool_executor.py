"""
Custom tool executor with confirmation gate integration.
"""
import logging
from typing import Any, Dict, List, Sequence

from langchain_core.messages import BaseMessage, ToolMessage
from langchain_core.tools import BaseTool

from src.tools.registry import TOOL_REGISTRY
from src.tools.confirmation_gate import ConfirmationGate
from src.contracts.tool import ToolResult
import json

logger = logging.getLogger("rawclaw.graph.tool_executor")


class ToolExecutorWithConfirmation:
    """Tool executor that checks for confirmation before running."""

    def __init__(self, confirmation_gate: ConfirmationGate = None):
        self.confirmation_gate = confirmation_gate or ConfirmationGate()
        self._tool_funcs: Dict[str, Any] = {}

    def register_tools(self, tools: List[BaseTool]):
        """Register tools for execution."""
        for tool in tools:
            self._tool_funcs[tool.name] = get_async_execute_func(tool)

    async def execute(
        self,
        tool_calls: Sequence[Any],
        session_id: str,
    ) -> List[ToolMessage]:
        """Execute tools with confirmation check."""
        results = []
        
        for tool_call in tool_calls:
            tool_name = tool_call.get("name")
            tool_args = tool_call.get("args", {})
            
            if not tool_name:
                continue
            
            try:
                tool = TOOL_REGISTRY.get(tool_name)
            except Exception:
                results.append(ToolMessage(
                    content=json.dumps({"error": f"Tool {tool_name} not found"}),
                    tool_call_id=tool_name,
                ))
                continue
            
            # Check if confirmation is required
            if tool.requires_confirmation:
                decision = await self.confirmation_gate.request_confirmation(
                    session_id,
                    tool_name,
                    tool_args,
                )
                
                if decision != "approved":
                    results.append(ToolMessage(
                        content=json.dumps({
                            "error": f"Tool {tool_name} rejected or timed out",
                            "decision": decision,
                        }),
                        tool_call_id=tool_name,
                    ))
                    continue
            
            # Execute the tool
            try:
                result = await tool.execute(tool_args)
                results.append(ToolMessage(
                    content=result.model_dump_json(),
                    tool_call_id=tool_name,
                ))
            except Exception as e:
                logger.error(f"Tool execution error for {tool_name}: {e}")
                results.append(ToolMessage(
                    content=json.dumps({"error": str(e)}),
                    tool_call_id=tool_name,
                ))
        
        return results


def get_async_execute_func(tool: BaseTool):
    """Get async execute function for a BaseTool."""
    async def execute_func(input: Dict[str, Any]) -> str:
        result = await tool.execute(input)
        return result.model_dump_json()
    return execute_func