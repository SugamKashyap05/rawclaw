"""
MCP Gateway — Client for connecting to MCP (Model Context Protocol) servers.

Supports two transport modes:
  - stdio: For local MCP servers (launches a subprocess)
  - sse: For remote MCP servers (connects via Server-Sent Events)

Configuration is loaded from MCP_SERVERS_CONFIG env var pointing to a JSON file.
"""
import asyncio
import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("rawclaw.mcp")

DEFAULT_MCP_CONFIG = os.getenv("MCP_SERVERS_CONFIG", "./mcp_servers.json")


class MCPError(Exception):
    """Raised when an MCP operation fails."""
    pass


class MCPServer:
    """Represents a configured MCP server connection."""

    def __init__(
        self,
        name: str,
        transport: str,
        command: Optional[str] = None,
        args: Optional[List[str]] = None,
        url: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> None:
        self.name = name
        self.transport = transport  # "stdio" | "sse"
        self.command = command
        self.args = args or []
        self.url = url
        self.env = env or {}
        self._process: Optional[asyncio.subprocess.Process] = None
        self._tools: List[Dict[str, Any]] = []
        self._connected = False

    async def connect(self) -> None:
        """Connect to the MCP server and discover available tools."""
        if self.transport == "stdio":
            await self._connect_stdio()
        elif self.transport == "sse":
            await self._connect_sse()
        else:
            raise MCPError(f"Unknown transport: {self.transport}")

    async def _connect_stdio(self) -> None:
        """Launch a stdio MCP server as a subprocess."""
        if not self.command:
            raise MCPError(f"MCP server {self.name}: stdio requires a 'command'")

        try:
            env = {**os.environ, **self.env}
            self._process = await asyncio.create_subprocess_exec(
                self.command,
                *self.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            # Send initialize request
            init_request = {
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "rawclaw",
                        "version": "0.1.0",
                    },
                },
            }
            response = await self._send_stdio(init_request)
            if response and "result" in response:
                self._connected = True
                logger.info(f"MCP stdio server {self.name} initialized")
                # Discover tools
                await self._discover_tools_stdio()
            else:
                raise MCPError(f"MCP server {self.name} failed to initialize: {response}")

        except FileNotFoundError:
            raise MCPError(f"MCP server {self.name}: command '{self.command}' not found")
        except Exception as e:
            raise MCPError(f"MCP server {self.name} connection failed: {e}")

    async def _connect_sse(self) -> None:
        """Connect to an SSE MCP server via HTTP."""
        if not self.url:
            raise MCPError(f"MCP server {self.name}: sse requires a 'url'")

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # POST initialize
                init_request = {
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {
                            "name": "rawclaw",
                            "version": "0.1.0",
                        },
                    },
                }
                resp = await client.post(
                    self.url,
                    json=init_request,
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

                if "result" in data:
                    self._connected = True
                    logger.info(f"MCP SSE server {self.name} initialized")
                    await self._discover_tools_sse()
                else:
                    raise MCPError(f"MCP server {self.name} failed to initialize: {data}")

        except Exception as e:
            raise MCPError(f"MCP server {self.name} SSE connection failed: {e}")

    async def _send_stdio(self, request: Dict) -> Optional[Dict]:
        """Send a JSON-RPC request via stdio and read the response."""
        if not self._process or not self._process.stdin or not self._process.stdout:
            return None

        msg = json.dumps(request) + "\n"
        self._process.stdin.write(msg.encode("utf-8"))
        await self._process.stdin.drain()

        try:
            line = await asyncio.wait_for(
                self._process.stdout.readline(), timeout=10
            )
            if line:
                return json.loads(line.decode("utf-8"))
        except (asyncio.TimeoutError, json.JSONDecodeError) as e:
            logger.error(f"MCP stdio read error: {e}")
        return None

    async def _discover_tools_stdio(self) -> None:
        """Discover tools from a stdio MCP server."""
        request = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/list",
            "params": {},
        }
        response = await self._send_stdio(request)
        if response and "result" in response:
            self._tools = response["result"].get("tools", [])
            logger.info(f"MCP {self.name}: discovered {len(self._tools)} tools")

    async def _discover_tools_sse(self) -> None:
        """Discover tools from an SSE MCP server."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                request = {
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "tools/list",
                    "params": {},
                }
                resp = await client.post(self.url, json=request)
                resp.raise_for_status()
                data = resp.json()
                if "result" in data:
                    self._tools = data["result"].get("tools", [])
                    logger.info(f"MCP {self.name}: discovered {len(self._tools)} tools")
        except Exception as e:
            logger.error(f"MCP {self.name} tool discovery failed: {e}")

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict:
        """Call a tool on this MCP server."""
        request = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }

        if self.transport == "stdio":
            response = await self._send_stdio(request)
        elif self.transport == "sse":
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(self.url, json=request)
                resp.raise_for_status()
                response = resp.json()
        else:
            raise MCPError(f"Unknown transport: {self.transport}")

        if response and "result" in response:
            return response["result"]
        elif response and "error" in response:
            raise MCPError(f"MCP tool error: {response['error']}")
        else:
            raise MCPError(f"MCP tool call returned no result: {response}")

    @property
    def tools(self) -> List[Dict[str, Any]]:
        return self._tools

    @property
    def connected(self) -> bool:
        return self._connected

    async def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        if self._process:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
            self._process = None
        self._connected = False


class MCPGateway:
    """
    Manages multiple MCP server connections.
    Loads configuration from a JSON file and provides
    unified tool discovery and invocation.
    """

    def __init__(self, config_path: str = DEFAULT_MCP_CONFIG) -> None:
        self.config_path = config_path
        self._servers: Dict[str, MCPServer] = {}

    def load_config(self) -> None:
        """Load MCP server configurations from the JSON config file."""
        if not os.path.exists(self.config_path):
            logger.info(f"MCP config not found at {self.config_path}, no MCP servers configured")
            return

        try:
            with open(self.config_path, "r") as f:
                config = json.load(f)

            for name, server_config in config.get("servers", {}).items():
                server = MCPServer(
                    name=name,
                    transport=server_config.get("transport", "stdio"),
                    command=server_config.get("command"),
                    args=server_config.get("args", []),
                    url=server_config.get("url"),
                    env=server_config.get("env", {}),
                )
                self._servers[name] = server
                logger.info(f"MCP server configured: {name} ({server.transport})")

        except Exception as e:
            logger.error(f"Failed to load MCP config: {e}")

    async def connect_all(self) -> Dict[str, str]:
        """
        Connect to all configured MCP servers.
        Returns a dict of server_name -> status.
        """
        results: Dict[str, str] = {}
        for name, server in self._servers.items():
            try:
                await server.connect()
                results[name] = "connected"
            except MCPError as e:
                logger.error(f"MCP {name} failed: {e}")
                results[name] = f"error: {e}"
        return results

    async def disconnect_all(self) -> None:
        """Disconnect from all MCP servers."""
        for server in self._servers.values():
            await server.disconnect()

    def get_all_tools(self) -> List[Dict]:
        """Get all tools from all connected MCP servers."""
        all_tools = []
        for name, server in self._servers.items():
            for tool in server.tools:
                tool_with_server = {**tool, "_mcp_server": name}
                all_tools.append(tool_with_server)
        return all_tools

    async def call_tool(
        self, server_name: str, tool_name: str, arguments: Dict[str, Any]
    ) -> Dict:
        """Call a tool on a specific MCP server."""
        server = self._servers.get(server_name)
        if not server:
            raise MCPError(f"MCP server '{server_name}' not found")
        if not server.connected:
            raise MCPError(f"MCP server '{server_name}' is not connected")
        return await server.call_tool(tool_name, arguments)

    @property
    def server_names(self) -> List[str]:
        return list(self._servers.keys())

    @property
    def connected_count(self) -> int:
        return sum(1 for s in self._servers.values() if s.connected)
