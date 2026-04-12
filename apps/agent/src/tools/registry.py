"""
ToolRegistry — Singleton that discovers, validates, and serves tools.

Supports:
  - Registration with name uniqueness enforcement
  - Tag-based lookup for planner queries
  - Health checks across all registered tools
  - Schema export for LLM function-calling
  - ToolInfo export for API responses
"""
import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolSchema, ToolHealthStatus, ToolInfo

logger = logging.getLogger("rawclaw.registry")


class ToolNotFoundError(Exception):
    """Raised when a tool is not found in the registry."""
    pass


class ToolRegistry:
    """Central registry for all available tools."""

    def __init__(self) -> None:
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """
        Register a tool. Raises ValueError if a tool with the same name
        is already registered.
        """
        if not tool.name:
            raise ValueError("Tool must have a non-empty name")
        if tool.name in self._tools:
            raise ValueError(
                f"Tool '{tool.name}' is already registered. "
                f"Existing: {self._tools[tool.name]!r}"
            )
        self._tools[tool.name] = tool
        logger.info(f"Registered tool: {tool.name} (tags: {tool.capability_tags})")

    def get(self, name: str) -> BaseTool:
        """Get a tool by exact name. Raises ToolNotFoundError if not found."""
        tool = self._tools.get(name)
        if tool is None:
            raise ToolNotFoundError(f"Tool '{name}' not found in registry")
        return tool

    def get_optional(self, name: str) -> Optional[BaseTool]:
        """Get a tool by exact name. Returns None if not found."""
        return self._tools.get(name)

    def list_tools(self) -> List[ToolSchema]:
        """List all registered tools as ToolSchema objects."""
        return [tool.to_tool_schema() for tool in self._tools.values()]

    async def list_tools_info(self) -> List[ToolInfo]:
        """List all tools with their current health status."""
        health_statuses = await self.health_check_all()
        infos: List[ToolInfo] = []
        for name, tool in self._tools.items():
            health = health_statuses.get(name, ToolHealthStatus(
                name=name,
                status="unavailable",
                reason="Health check failed",
            ))
            infos.append(ToolInfo(
                name=name,
                description=tool.description,
                parameters=tool.parameters,
                capability_tags=tool.capability_tags,
                requires_confirmation=tool.requires_confirmation,
                requires_sandbox=tool.requires_sandbox,
                health_status=health,
            ))
        return infos

    def list_by_tag(self, tag: str) -> List[BaseTool]:
        """
        Return all tools that have the given capability tag.
        Allows the planner to say 'find me the best search tool'
        without hardcoding tool names.
        """
        return [
            tool
            for tool in self._tools.values()
            if tag in tool.capability_tags
        ]

    def get_schemas(self) -> List[Dict[str, Any]]:
        """
        Export all tool schemas in OpenAI function-calling format.
        Used when sending available tools to the LLM.
        """
        return [tool.get_schema() for tool in self._tools.values()]

    async def health_check_all(self) -> Dict[str, ToolHealthStatus]:
        """
        Run health checks on all registered tools concurrently.
        Returns a dict mapping tool name to health status.
        """
        async def check_tool(name: str, tool: BaseTool) -> tuple[str, ToolHealthStatus]:
            try:
                status = await tool.health_check()
                return name, ToolHealthStatus(
                    name=name,
                    status=status,
                    last_checked=datetime.utcnow(),
                )
            except Exception as e:
                return name, ToolHealthStatus(
                    name=name,
                    status="unavailable",
                    reason=str(e),
                    last_checked=datetime.utcnow(),
                )

        tasks = [check_tool(name, tool) for name, tool in self._tools.items()]
        results = await asyncio.gather(*tasks)
        return dict(results)

    async def execute_tool(
        self,
        name: str,
        input: Dict[str, Any],
    ) -> "ToolResult":
        """
        Execute a tool by name. Returns ToolResult.
        Never raises - errors are captured in ToolResult.error.
        """
        from src.contracts.tool import ToolResult
        import time

        start = time.time()
        try:
            tool = self.get(name)
            result = await tool.execute(input)
            return result
        except ToolNotFoundError as e:
            return ToolResult(
                tool_name=name,
                input=input,
                error=str(e),
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        except Exception as e:
            logger.error(f"Tool execution error for {name}: {e}")
            return ToolResult(
                tool_name=name,
                input=input,
                error=f"Tool execution failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

    @property
    def count(self) -> int:
        return len(self._tools)

    @property
    def tool_names(self) -> List[str]:
        return list(self._tools.keys())

    def __repr__(self) -> str:
        return f"<ToolRegistry count={self.count} tools={self.tool_names}>"


# Global singleton instance
TOOL_REGISTRY = ToolRegistry()