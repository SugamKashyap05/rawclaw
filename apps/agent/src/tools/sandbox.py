"""
SandboxExecutor — Docker-based isolation for filesystem/shell tools.

Security contract:
  - If a tool has `requires_sandbox=True`, it MUST execute inside a Docker container.
  - If Docker is unavailable, the tool REFUSES to execute. No fallback. No exceptions.
  - This is the direct mitigation for OpenClaw CVE-2026-25253.
"""
import asyncio
import json
import logging
import shutil
import time
from typing import Any, Dict, Optional

from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.sandbox")

# Docker image used for sandboxed tool execution
SANDBOX_IMAGE = "python:3.11-slim"
# Maximum execution time for sandboxed tools (seconds)
SANDBOX_TIMEOUT = 30
# Maximum output size from sandbox (bytes)
MAX_OUTPUT_SIZE = 1_048_576  # 1MB


def is_docker_available() -> bool:
    """Check if Docker is installed and the daemon is running."""
    docker_path = shutil.which("docker")
    if not docker_path:
        return False
    try:
        result = asyncio.get_event_loop().run_until_complete(
            _run_process(["docker", "info"], timeout=5)
        )
        return result.returncode == 0
    except Exception:
        return False


async def _is_docker_available_async() -> bool:
    """Async check if Docker is installed and the daemon is running."""
    docker_path = shutil.which("docker")
    if not docker_path:
        return False
    try:
        result = await _run_process(["docker", "info"], timeout=5)
        return result.returncode == 0
    except Exception:
        return False


async def _run_process(
    cmd: list[str], timeout: int = SANDBOX_TIMEOUT
) -> asyncio.subprocess.Process:
    """Run a subprocess with a timeout."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise TimeoutError(f"Process timed out after {timeout}s")
    return proc


class SandboxExecutor:
    """
    Executes tool code inside a Docker container.

    If Docker is unavailable and the tool requires sandbox, execution is
    REFUSED with a clear error. This is not negotiable.
    """

    def __init__(self, image: str = SANDBOX_IMAGE, timeout: int = SANDBOX_TIMEOUT):
        self.image = image
        self.timeout = timeout
        self._docker_checked = False
        self._docker_ok = False

    async def _ensure_docker(self) -> bool:
        """Lazy-check Docker availability once per session."""
        if not self._docker_checked:
            self._docker_ok = await _is_docker_available_async()
            self._docker_checked = True
            if self._docker_ok:
                logger.info("Docker daemon is available. Sandbox enabled.")
            else:
                logger.warning("Docker daemon is NOT available. Sandboxed tools will refuse execution.")
        return self._docker_ok

    async def execute(
        self,
        tool_name: str,
        code: str,
        input_data: Dict[str, Any],
        working_dir: Optional[str] = None,
    ) -> ToolResult:
        """
        Execute the given Python code inside a Docker sandbox.

        The code receives input_data as a JSON string via stdin,
        and should print its result as JSON to stdout.

        If Docker is unavailable, returns a hard error — no fallback.
        """
        start = time.time()

        # --- SECURITY GATE: Docker must be running ---
        docker_ok = await self._ensure_docker()
        if not docker_ok:
            return ToolResult(
                tool_name=tool_name,
                input=input_data,
                output=None,
                error=(
                    "Docker is required for sandboxed tools and is not running. "
                    "Start Docker Desktop and retry."
                ),
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # Build docker run command
        cmd = [
            "docker", "run",
            "--rm",                         # Cleanup container after exit
            "--network=none",               # No network access
            "--memory=256m",                # Memory limit
            "--cpus=0.5",                   # CPU limit
            "--read-only",                  # Read-only root filesystem
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",  # Writable tmp
            "--user", "nobody",             # Non-root user
            "-i",                           # Accept stdin
            self.image,
            "python3", "-c", code,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            input_bytes = json.dumps(input_data).encode("utf-8")

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(input=input_bytes),
                    timeout=self.timeout,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return ToolResult(
                    tool_name=tool_name,
                    input=input_data,
                    error=f"Sandbox execution timed out after {self.timeout}s",
                    duration_ms=round((time.time() - start) * 1000, 2),
                    sandboxed=True,
                )

            duration_ms = round((time.time() - start) * 1000, 2)
            stdout_str = stdout.decode("utf-8", errors="replace")[:MAX_OUTPUT_SIZE]
            stderr_str = stderr.decode("utf-8", errors="replace")[:MAX_OUTPUT_SIZE]

            if proc.returncode != 0:
                return ToolResult(
                    tool_name=tool_name,
                    input=input_data,
                    error=f"Sandbox exited with code {proc.returncode}: {stderr_str}",
                    duration_ms=duration_ms,
                    sandboxed=True,
                )

            # Try to parse stdout as JSON, fall back to raw string
            try:
                output = json.loads(stdout_str)
            except json.JSONDecodeError:
                output = stdout_str.strip()

            return ToolResult(
                tool_name=tool_name,
                input=input_data,
                output=output,
                duration_ms=duration_ms,
                sandboxed=True,
            )

        except Exception as e:
            return ToolResult(
                tool_name=tool_name,
                input=input_data,
                error=f"Sandbox execution failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=True,
            )

    def invalidate_cache(self) -> None:
        """Force re-check of Docker availability on next execution."""
        self._docker_checked = False
        self._docker_ok = False
