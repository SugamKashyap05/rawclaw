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
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.memory.knowledge_brain import KnowledgeBrain

logger = logging.getLogger("rawclaw.registry")
MAX_TOOL_OUTPUT_CHARS = 50000 # 50k chars max for tool output

# Tools in this set can NEVER be overridden by MCP servers.
# An MCP server that attempts to register a tool with one of these names
# will be rejected regardless of configuration.
# To add a new protected tool, add it here explicitly.
PROTECTED_BUILTIN_TOOLS: frozenset[str] = frozenset({
    # Shell and code execution — highest risk, never allow MCP override
    "shell_execute",
    "shell_run",
    "code_execute",
    "code_run",
    "python_repl",
    # Filesystem — high risk
    "filesystem_write",
    "filesystem_read",
    "filesystem_delete",
    "file_write",
    "file_read",
    "file_delete",
    "read_file",
    "list_dir",
    # Memory — prevents poisoning via MCP
    "memory_write",
    "memory_delete",
    "memory_store",
})


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

    def register_mcp_tool(self, tool: BaseTool) -> None:
        """Register an MCP-backed tool with override protections."""
        source_server = (
            getattr(tool, "source_server", None)
            or getattr(tool, "_server_name", None)
            or getattr(tool, "mcp_server_id", None)
            or "unknown"
        )

        # Guard 1: Block override of protected built-in tools — hard stop
        if tool.name in PROTECTED_BUILTIN_TOOLS:
            logger.error(
                "mcp_tool_blocked_protected_name",
                extra={
                    "tool_name": tool.name,
                    "mcp_server": source_server,
                    "reason": "MCP tool attempted to override a protected built-in tool.",
                },
            )
            raise ValueError(
                f"MCP tool '{tool.name}' from server '{source_server}' "
                f"cannot override protected built-in '{tool.name}'. "
                "Rename the tool on the MCP server side."
            )

        # Guard 2: Warn and namespace non-protected collisions
        if tool.name in self._tools:
            logger.warning(
                "mcp_tool_name_collision",
                extra={
                    "tool_name": tool.name,
                    "mcp_server": source_server,
                    "action": "namespacing_to_prevent_silent_override",
                },
            )
            server_name = str(source_server).replace(".", "_")
            tool.name = f"mcp.{server_name}.{tool.name}"

        self.register(tool)

    def get(self, name: str) -> BaseTool:
        """Get a tool by exact name. Raises ToolNotFoundError if not found."""
        tool = self._tools.get(name)
        if tool is None:
            raise ToolNotFoundError(f"Tool '{name}' not found in registry")
        return tool

    def get_optional(self, name: str) -> Optional[BaseTool]:
        """Get a tool by exact name. Returns None if not found."""
        return self._tools.get(name)

    # INVARIANT: empty input = empty output. Never fail open to all tools.
    # An empty selection is a control-plane signal that something went wrong upstream.
    # Returning all tools in that case would be a critical security and quality failure.
    def resolve_tools_for_turn(self, selected_tool_ids: Optional[List[str]]) -> List[BaseTool]:
        """Resolve a turn-scoped tool selection to concrete tool instances."""
        if not selected_tool_ids:
            logger.warning(
                "tool_resolution_received_empty_selection — returning empty set. "
                "This is a control-plane bug if it occurs in production."
            )
            return []

        resolved: List[BaseTool] = []
        for tool_id in selected_tool_ids:
            tool = self._tools.get(tool_id)
            if tool is None:
                logger.error("tool_not_found", extra={"tool_id": tool_id})
                continue
            resolved.append(tool)
        return resolved

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
        knowledge_brain: Optional["KnowledgeBrain"] = None,
        turn_id: Optional[str] = None,
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
            if knowledge_brain:
                tool.set_knowledge_brain(knowledge_brain)
            if turn_id:
                logger.info("tool_execution_started turn_id=%s tool_name=%s", turn_id, name)
            result = await tool.execute(input)
            
            # Truncate large outputs
            if result.output and isinstance(result.output, str) and len(result.output) > MAX_TOOL_OUTPUT_CHARS:
                original_len = len(result.output)
                result.output = result.output[:MAX_TOOL_OUTPUT_CHARS] + f"\n\n[... Output Truncated: {original_len - MAX_TOOL_OUTPUT_CHARS} characters omitted ...]"
                result.is_truncated = True
                logger.info(f"Truncated tool output for '{name}' from {original_len} to {MAX_TOOL_OUTPUT_CHARS}")
            if turn_id:
                logger.info(
                    "tool_execution_completed turn_id=%s tool_name=%s duration_ms=%s error=%s",
                    turn_id,
                    name,
                    result.duration_ms,
                    result.error,
                )
            
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
            if turn_id:
                logger.error("tool_execution_failed turn_id=%s tool_name=%s error=%s", turn_id, name, e)
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
