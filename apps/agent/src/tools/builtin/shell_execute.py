from typing import Any, Dict
from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult
from src.sandbox.sandbox import SandboxRunner

class ShellExecuteTool(BaseTool):
    """
    Executes a shell command inside a secure Docker sandbox.
    """
    name = "shell_execute"
    description = (
        "Execute a bash/sh command inside a secure, isolated Docker container. "
        "Use this for running scripts, compiling code, or system automation. "
        "The environment is non-persistent and has no network access by default."
    )
    parameters = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The shell command to execute (e.g., 'ls -la', 'python3 -c ...')."
            },
            "timeout": {
                "type": "integer",
                "description": "Execution timeout in seconds (default: 30).",
                "default": 30
            }
        },
        "required": ["command"]
    }
    capability_tags = ["shell", "sandbox", "automation"]
    requires_sandbox = True
    requires_confirmation = True

    def __init__(self) -> None:
        self.runner = SandboxRunner()

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        command = input.get("command", "")
        timeout = input.get("timeout", 30)

        if not command:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Command cannot be empty",
            )

        result = await self.runner.run(command, timeout_seconds=timeout)

        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.exit_code,
            },
            error=result.error,
            duration_ms=result.duration_ms,
            sandboxed=True
        )
