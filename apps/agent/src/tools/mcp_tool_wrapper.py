"""
MCPToolWrapper — Wraps an MCP server tool as a RawClaw BaseTool.

This allows MCP-discovered tools to be registered in the ToolRegistry
and used by the agent loop just like built-in tools.
"""
import logging
import time
from typing import Any, Dict, List

from src.tools.base_tool import BaseTool
from src.tools.mcp_gateway import MCPGateway, MCPError
from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.mcp.wrapper")


class MCPToolWrapper(BaseTool):
    """
    Wraps a single MCP tool as a BaseTool.
    Delegates execution to the MCPGateway.
    """

    def __init__(
        self,
        mcp_tool: Dict[str, Any],
        server_name: str,
        gateway: MCPGateway,
    ) -> None:
        # Use the original MCP tool name directly (no prefix)
        # This allows MCP tools to replace built-in tools with the same name
        self.name = mcp_tool['name']
        self.description = mcp_tool.get("description", f"MCP tool from {server_name}")
        self.parameters = mcp_tool.get("inputSchema", {})
        self.capability_tags = ["mcp", server_name]
        self.requires_sandbox = False
        # MCP tools require confirmation by default, but web-search tools can run without
        self.requires_confirmation = not self._is_web_search_tool(mcp_tool['name'])
        self._mcp_tool_name = mcp_tool["name"]
        self._server_name = server_name
        self._gateway = gateway

    def _is_web_search_tool(self, name: str) -> bool:
        """Check if this is a web search tool that can run without confirmation."""
        search_keywords = ['search', 'fetch', 'browse', 'web']
        return any(kw in name.lower() for kw in search_keywords)

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        """Execute the MCP tool via the gateway."""
        start = time.time()
        try:
            result = await self._gateway.call_tool(
                self._server_name,
                self._mcp_tool_name,
                input,
            )
            # Log the raw MCP tool result for debugging
            logger.info(f"MCP tool '{self.name}' raw result: {result}")
            return ToolResult(
                tool_name=self.name,
                input=input,
                output=result,
                duration_ms=round((time.time() - start) * 1000, 2),
            )
        except MCPError as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=str(e),
                duration_ms=round((time.time() - start) * 1000, 2),
            )
        except Exception as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"MCP execution failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000, 2),
            )

    async def health_check(self) -> str:
        """Check if the backing MCP server is connected."""
        servers = self._gateway._servers
        server = servers.get(self._server_name)
        if server and server.connected:
            return "ok"
        return "unavailable"


def wrap_mcp_tools(gateway: MCPGateway) -> List[MCPToolWrapper]:
    """
    Take all tools discovered across MCP servers
    and wrap them as MCPToolWrapper instances.
    """
    tools = []
    for tool_info in gateway.get_all_tools():
        server_name = tool_info.pop("_mcp_server", "unknown")
        wrapper = MCPToolWrapper(
            mcp_tool=tool_info,
            server_name=server_name,
            gateway=gateway,
        )
        tools.append(wrapper)
    return tools
