"""
Tool adapter - converts RawClaw BaseTool to LangChain StructuredTool.
"""
import logging
from typing import Any, Dict, List

from langchain_core.tools import StructuredTool

from src.tools.base_tool import BaseTool
from src.tools.registry import TOOL_REGISTRY

logger = logging.getLogger("rawclaw.graph.tool_adapter")


def rawclaw_tool_to_langchain(tool: BaseTool) -> StructuredTool:
    """
    Wrap a RawClaw BaseTool as a LangChain StructuredTool.
    """
    async def _execute(input: Dict[str, Any]) -> str:
        result = await tool.execute(input)
        return result.model_dump_json()

    return StructuredTool(
        name=tool.name,
        description=tool.description,
        args_schema=None,
        func=None,
        coroutine=_execute,
    )


def get_all_langchain_tools() -> List[StructuredTool]:
    """Convert all registered tools to LangChain format."""
    tools = []
    for tool in TOOL_REGISTRY._tools.values():
        try:
            lc_tool = rawclaw_tool_to_langchain(tool)
            tools.append(lc_tool)
        except Exception as e:
            logger.warning(f"Failed to convert tool {tool.name} to LangChain: {e}")
    return tools


def get_tool_func(tool_name: str):
    """Get the async execute function for a tool by name."""
    tool = TOOL_REGISTRY.get(tool_name)
    
    async def execute_func(input: Dict[str, Any]) -> str:
        result = await tool.execute(input)
        return result.model_dump_json()
    
    return execute_func