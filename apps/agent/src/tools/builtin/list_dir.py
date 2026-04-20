import os
from typing import Any, Dict
from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.sandbox.sandbox import SandboxRunner

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

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        path = input.get("path", ".")
        recursive = input.get("recursive", False)

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
