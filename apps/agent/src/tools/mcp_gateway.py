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
        self._endpoint: Optional[str] = None

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
            
            # Windows command resolution fix (for npx, npm, etc)
            import platform
            cmd = self.command
            if platform.system() == "Windows" and not cmd.endswith((".exe", ".cmd", ".bat")):
                # Check if it's a known non-executable and wrap it
                shell = True
                full_command = f"{cmd} {' '.join(self.args)}"
                self._process = await asyncio.create_subprocess_shell(
                    full_command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                )
            else:
                self._process = await asyncio.create_subprocess_exec(
                    cmd,
                    *self.args,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                )

            # Send initialize request with timeout
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
            try:
                # We use wait_for because if the server crashes or hangs, 
                # we don't want the agent startup to hang indefinitely.
                response = await asyncio.wait_for(self._send_stdio(init_request), timeout=10.0)
                
                if response and "result" in response:
                    self._connected = True
                    logger.info(f"MCP stdio server {self.name} initialized")
                    await self._discover_tools_stdio()
                else:
                    # Capture what we can
                    stdout_data, stderr_data = await self._process.communicate()
                    err_msg = stderr_data.decode().strip() or stdout_data.decode().strip()
                    exit_code = self._process.returncode
                    raise MCPError(f"MCP server {self.name} handshake failed (exit {exit_code}). Stderr: {err_msg}")
                    
            except asyncio.TimeoutError:
                # If it timed out, term the process
                self._process.terminate()
                stdout_data, stderr_data = await self._process.communicate()
                err_msg = stderr_data.decode().strip()
                raise MCPError(f"MCP server {self.name} handshake timed out. Stderr: {err_msg}")

        except FileNotFoundError:
            raise MCPError(f"MCP server {self.name}: command '{self.command}' not found")
        except Exception as e:
            raise MCPError(f"MCP server {self.name} connection failed: {e}")

    async def _connect_sse(self) -> None:
        """Connect to an SSE MCP server via HTTP following the standard handshake."""
        if not self.url:
            raise MCPError(f"MCP server {self.name}: sse requires a 'url'")

        logger.info(f"MCP {self.name}: Starting SSE handshake at {self.url}")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                # 1. Establish SSE session (GET)
                self._endpoint = None
                
                logger.debug(f"MCP {self.name}: Opening SSE stream...")
                async with client.stream("GET", self.url) as response:
                    if response.status_code != 200:
                        logger.error(f"MCP {self.name}: SSE stream failed with status {response.status_code}")
                        raise MCPError(f"Failed to connect to SSE stream: {response.status_code}")
                    
                    logger.debug(f"MCP {self.name}: SSE stream opened, waiting for 'endpoint' event")
                    last_event = None
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if line.startswith("event:"):
                            last_event = line[6:].strip()
                            logger.debug(f"MCP {self.name}: Received event: {last_event}")
                        elif line.startswith("data:") and last_event == "endpoint":
                            endpoint_path = line[5:].strip()
                            from urllib.parse import urljoin
                            self._endpoint = urljoin(self.url, endpoint_path)
                            logger.info(f"MCP {self.name}: Discovered message endpoint: {self._endpoint}")
                            break
                        elif not line:
                            continue
                
                if not self._endpoint:
                    logger.warning(f"MCP {self.name}: No 'endpoint' event found in first few lines, falling back to {self.url}")
                    self._endpoint = self.url

                # 2. POST initialize
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
                logger.debug(f"MCP {self.name}: Sending 'initialize' request to {self._endpoint}")
                resp = await client.post(
                    self._endpoint,
                    json=init_request,
                    headers={"Content-Type": "application/json"},
                )
                
                if resp.status_code != 200:
                    logger.error(f"MCP {self.name}: 'initialize' failed with status {resp.status_code}: {resp.text}")
                    resp.raise_for_status()
                
                data = resp.json()
                if "result" in data:
                    self._connected = True
                    logger.info(f"MCP {self.name}: Initialized successfully at {self._endpoint}")
                    await self._discover_tools_sse()
                else:
                    logger.error(f"MCP {self.name}: Server returned error result: {data}")
                    raise MCPError(f"MCP server {self.name} failed to initialize: {data}")

        except httpx.ConnectError:
            logger.error(f"MCP {self.name}: Connection refused at {self.url}")
            raise MCPError(f"Connection refused at {self.url}. Is the MCP server running?")
        except httpx.TimeoutException:
            logger.error(f"MCP {self.name}: Handshake timed out at {self.url}")
            raise MCPError(f"Handshake timed out at {self.url}")
        except Exception as e:
            logger.error(f"MCP {self.name}: SSE connection failed unexpectedly: {str(e)}")
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
                resp = await client.post(self._endpoint or self.url, json=request)
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
                resp = await client.post(self._endpoint or self.url, json=request)
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

    def add_server(self, server: MCPServer) -> None:
        """Register an MCP server programmatically."""
        self._servers[server.name] = server
        logger.info(f"MCP server registered: {server.name} ({server.transport})")

    def load_config(self) -> None:
        """Load MCP server configurations from the JSON config file."""
        if not os.path.exists(self.config_path):
            logger.info(f"MCP config not found at {self.config_path}, skipping file-based config")
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
                self.add_server(server)

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
