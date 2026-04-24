import os
from pathlib import Path
from typing import Any, Dict
from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.sandbox.sandbox import SandboxRunner
from src.sandbox.sandbox_config import get_sandbox_config

class ListDirTool(BaseTool):
    """
    Lists files and directories inside the sandboxed environment.
    """
    name = "list_dir"
    description = (
        "List the contents of a directory inside the sandboxed environment. "
        "Useful for exploring the filesystem before reading or executing files. "
        "Paths are relative to the sandbox root or absolute within the sandbox."
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The directory path to list (default: '.').",
                "default": "."
            },
            "recursive": {
                "type": "boolean",
                "description": "Whether to list subdirectories recursively.",
                "default": False
            }
        },
        "required": []
    }
    capability_tags = ["filesystem", "sandbox", "navigation"]
    requires_sandbox = True
    requires_confirmation = False

    def __init__(self) -> None:
        self.runner = SandboxRunner()
        self._config = get_sandbox_config()

    def _resolve_container_path(self, raw_path: str) -> str:
        workspace_root = Path(self._config.allowed_paths[0]).resolve() if self._config.allowed_paths else Path(".").resolve()
        requested = Path(raw_path or ".")

        if raw_path in ("", "."):
            return "/workspace"

        host_path = requested.resolve() if requested.is_absolute() else (workspace_root / requested).resolve()
        try:
            relative = host_path.relative_to(workspace_root)
        except ValueError:
            return "/workspace"
        return str(Path("/workspace") / relative).replace("\\", "/")

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        path = input.get("path", ".")
        recursive = input.get("recursive", False)
        path = self._resolve_container_path(path)

        # Sanitize path to avoid command injection in the shell command
        # Although it's sandboxed, we still want to be safe
        safe_path = path.replace('"', '\\"').replace('$', '\\$')
        
        cmd = f"ls -F --color=never {safe_path}"
        if recursive:
            cmd = f"ls -R -F --color=never {safe_path}"

        result = await self.runner.run(cmd)

        if result.exit_code != 0:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=result.error or f"Failed to list directory: {path}",
                duration_ms=result.duration_ms,
                sandboxed=True
            )

        # Process the ls output into a structured list if possible
        items = [line.strip() for line in result.stdout.splitlines() if line.strip()]

        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "path": path,
                "items": items,
                "raw_output": result.stdout
            },
            duration_ms=result.duration_ms,
            sandboxed=True
        )
