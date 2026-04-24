"""
ReadFileTool — Reads a file from the sandbox filesystem.

Security:
  - requires_sandbox=True: ALL reads happen inside Docker, never local.
  - requires_confirmation=True: User must approve before execution.
  - If Docker is unavailable, execution is REFUSED.
  - Only allows paths within ALLOWED_PATHS env list.
Tags: filesystem, read
"""
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.tools.base_tool import BaseTool
from src.sandbox.sandbox import SandboxRunner
from src.sandbox.sandbox_config import get_sandbox_config
from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.tools.read_file")

# Sandbox code template: receives input via stdin, reads the file, outputs JSON
_SANDBOX_CODE = '''
import json
import sys
import os

input_data = json.loads(sys.stdin.read())
path = input_data.get("path", "")
encoding = input_data.get("encoding", "utf-8")
max_bytes = input_data.get("max_bytes", 50000)

try:
    with open(path, "r", encoding=encoding) as f:
        content = f.read(max_bytes)
    size = len(content.encode(encoding))
    print(json.dumps({"content": content, "path": path, "size_bytes": size, "encoding": encoding}))
except FileNotFoundError:
    print(json.dumps({"error": f"File not found: {path}"}))
except PermissionError:
    print(json.dumps({"error": f"Permission denied: {path}"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
'''


class ReadFileTool(BaseTool):
    name = "read_file"
    description = "Reads the content of a file from the filesystem. Executes inside a Docker sandbox for safety. Requires user confirmation."
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The file path to read. Must be within configured allowed paths.",
            },
            "max_bytes": {
                "type": "integer",
                "description": "Maximum bytes to read. Default: 50000.",
                "default": 50000,
            },
            "encoding": {
                "type": "string",
                "description": "File encoding. Default: utf-8.",
                "default": "utf-8",
            },
        },
        "required": ["path"],
    }
    capability_tags = ["filesystem", "read"]
    requires_sandbox = True
    requires_confirmation = True

    def __init__(self) -> None:
        self._config = get_sandbox_config()
        self._sandbox = SandboxRunner(
            image=self._config.image,
            timeout=self._config.timeout,
            memory_limit=self._config.memory_limit,
            network_disabled=self._config.network_disabled,
        )
        self._allowed_paths: List[str] = self._config.allowed_paths

    def _resolve_host_and_container_path(self, raw_path: str) -> tuple[str, str]:
        if not self._allowed_paths:
            return raw_path, raw_path

        workspace_root = Path(self._allowed_paths[0]).resolve()
        requested = Path(raw_path)
        host_path = requested.resolve() if requested.is_absolute() else (workspace_root / requested).resolve()

        try:
            relative = host_path.relative_to(workspace_root)
        except ValueError:
            return str(host_path), ""

        container_path = str(Path("/workspace") / relative).replace("\\", "/")
        return str(host_path), container_path

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        """Execute file read inside Docker sandbox."""
        start = time.time()

        # --- SECURITY GATE: Sandbox must be available ---
        if not await self._sandbox._ensure_docker():
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Docker-based sandbox is required but unavailable. Start Docker Desktop and retry.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # Check if any paths are configured as allowed
        if not self._allowed_paths:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="No filesystem paths configured as allowed. Set ALLOWED_PATHS environment variable with comma-separated directories.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        path = input.get("path", "")
        host_path, container_path = self._resolve_host_and_container_path(path)
        if not container_path:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Path not in allowed directories: {path}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # Pass allowed paths to sandbox for validation
        sandbox_input = {
            **input,
            "path": container_path,
        }

        # Execute in sandbox
        result = await self._sandbox.run_python(_SANDBOX_CODE, sandbox_input)

        if result.error:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=result.error,
                duration_ms=result.duration_ms,
                sandboxed=True,
            )

        # Parse sandbox output
        try:
            output = json.loads(result.stdout)
            if "error" in output and output.get("content") is None:
                return ToolResult(
                    tool_name=self.name,
                    input=input,
                    error=output["error"],
                    duration_ms=round((time.time() - start) * 1000, 2),
                    sandboxed=True,
                )
            return ToolResult(
                tool_name=self.name,
                input=input,
                output=output,
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=True,
                provenance_hint={"path": host_path, "size_bytes": output.get("size_bytes")},
            )
        except json.JSONDecodeError as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Failed to parse sandbox output: {e}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=True,
            )

    async def health_check(self) -> str:
        """Check if Docker is available for sandbox execution."""
        from src.sandbox.sandbox import _is_docker_available
        if await _is_docker_available():
            return "ok"
        return "unavailable"
