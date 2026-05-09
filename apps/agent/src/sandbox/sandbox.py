"""
SandboxRunner — Docker-based isolation for filesystem/shell tools.

Security contract:
  - If a tool has `requires_sandbox=True`, it MUST execute inside a Docker container.
  - If Docker is unavailable, the tool REFUSES to execute. No fallback. No exceptions.
  - This is the direct mitigation for OpenClaw CVE-2026-25253.
"""
import asyncio
import json
import logging
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel

logger = logging.getLogger("rawclaw.sandbox")

def _env(name: str, *fallbacks: str, default: str = "") -> str:
    candidates = (name, *fallbacks)
    for candidate in candidates:
        value = os.getenv(candidate)
        if value is not None and value != "":
            return value
    return default


def _env_bool(name: str, *fallbacks: str, default: bool = False) -> bool:
    value = _env(name, *fallbacks, default="true" if default else "false")
    return value.strip().lower() in {"1", "true", "yes", "on"}


# Strictly require Docker for all sandboxed tools if True
PHASE3_ENABLED = _env_bool("RAWCLAW_PHASE3_ENABLED", default=True)
SANDBOX_STRICT_MODE = _env_bool('SANDBOX_STRICT_MODE', default=False)
SANDBOX_WORKER_POOL_ENABLED = _env_bool(
    'SANDBOX_WORKER_POOL_ENABLED',
    default=PHASE3_ENABLED,
)
API_URL = _env("RAWCLAW_API_URL", "API_URL", default="http://localhost:3000").rstrip("/")
INTERNAL_WORKER_BOOTSTRAP_SECRET = _env("INTERNAL_WORKER_BOOTSTRAP_SECRET", "AUTH_SECRET", default="")
_INTERNAL_SERVICE_TOKEN: Optional[str] = None
_INTERNAL_SERVICE_TOKEN_EXPIRES_AT: float = 0.0

class SandboxError(Exception):
    """Raised when sandbox execution is not possible."""
    pass


class SandboxResult(BaseModel):
    """Result of a sandbox execution."""
    stdout: str = ""
    stderr: str = ""
    exit_code: int = -1
    timed_out: bool = False
    output_files: Dict[str, str] = {}
    error: Optional[str] = None
    duration_ms: int = 0


async def _is_docker_available() -> bool:
    """Check if Docker is installed and the daemon is running."""
    docker_path = shutil.which("docker")
    if not docker_path:
        return False
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "info",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(proc.communicate(), timeout=5)
            return proc.returncode == 0
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return False
    except Exception:
        return False


def _capture_internal_auth(payload: Dict[str, Any]) -> None:
    global _INTERNAL_SERVICE_TOKEN, _INTERNAL_SERVICE_TOKEN_EXPIRES_AT

    auth = payload.get("auth") if isinstance(payload, dict) else None
    if not isinstance(auth, dict):
        return
    token = auth.get("token")
    expires_at = auth.get("expiresAt")
    if not isinstance(token, str) or not token:
        return

    _INTERNAL_SERVICE_TOKEN = token
    if isinstance(expires_at, str) and expires_at:
        try:
            normalized = expires_at.replace("Z", "+00:00")
            _INTERNAL_SERVICE_TOKEN_EXPIRES_AT = max(
                0.0,
                datetime.fromisoformat(normalized).astimezone(timezone.utc).timestamp(),
            )
        except ValueError:
            _INTERNAL_SERVICE_TOKEN_EXPIRES_AT = time.time() + 240
    else:
        _INTERNAL_SERVICE_TOKEN_EXPIRES_AT = time.time() + 240


async def _get_internal_service_headers(client: httpx.AsyncClient) -> Dict[str, str]:
    global _INTERNAL_SERVICE_TOKEN

    if _INTERNAL_SERVICE_TOKEN and (time.time() + 30) < _INTERNAL_SERVICE_TOKEN_EXPIRES_AT:
        return {"Authorization": f"Bearer {_INTERNAL_SERVICE_TOKEN}"}

    if not INTERNAL_WORKER_BOOTSTRAP_SECRET:
        return {}

    response = await client.post(
        f"{API_URL}/api/gateway/internal/swarm/service-token",
        json={"serviceId": "agent-sandbox"},
        headers={"x-rawclaw-worker-secret": INTERNAL_WORKER_BOOTSTRAP_SECRET},
    )
    response.raise_for_status()
    payload = response.json()
    _capture_internal_auth(payload)
    if not _INTERNAL_SERVICE_TOKEN:
        return {}
    return {"Authorization": f"Bearer {_INTERNAL_SERVICE_TOKEN}"}


class SandboxRunner:
    """
    Executes tool code inside a Docker container.

    If Docker is unavailable and the tool requires sandbox, execution is
    REFUSED with a clear error. This is not negotiable.
    """

    def __init__(
        self,
        image: str = "python:3.11-slim",
        timeout: int = 30,
        memory_limit: str = "256m",
        network_disabled: bool = True,
    ) -> None:
        self.image = image
        self.timeout = timeout
        self.memory_limit = memory_limit
        self.network_disabled = network_disabled
        self._docker_checked = False
        self._docker_ok = False

    def _get_mount_specs(self) -> List[Dict[str, str]]:
        from src.sandbox.sandbox_config import get_sandbox_config

        config = get_sandbox_config()
        specs: List[Dict[str, str]] = []
        for idx, mount_path in enumerate(config.allowed_paths):
            if not os.path.exists(mount_path):
                continue
            source = str(Path(mount_path).resolve())
            target = "/workspace" if idx == 0 else f"/workspace_mount_{idx}"
            specs.append({"source": source, "target": target})
        return specs

    async def _ensure_docker(self) -> bool:
        """Lazy-check Docker availability once per session."""
        if SANDBOX_WORKER_POOL_ENABLED:
            return True
        if not self._docker_checked:
            self._docker_ok = await _is_docker_available()
            self._docker_checked = True
            if self._docker_ok:
                logger.info("Docker daemon is available. Sandbox enabled.")
            else:
                logger.warning(
                    "Docker daemon is NOT available. Sandboxed tools will refuse execution."
                )

        if not self._docker_ok and SANDBOX_STRICT_MODE:
            raise SandboxError("Docker required for sandboxed execution (strict mode enabled)")

        return self._docker_ok

    async def _run_via_worker_pool(
        self,
        *,
        mode: str,
        command: Optional[str] = None,
        code: Optional[str] = None,
        input_data: Optional[Dict[str, Any]] = None,
        timeout_seconds: Optional[int] = None,
    ) -> SandboxResult:
        start = time.time()
        if not INTERNAL_WORKER_BOOTSTRAP_SECRET:
            return SandboxResult(
                error="Sandbox worker pool is enabled but INTERNAL_WORKER_BOOTSTRAP_SECRET is missing.",
                duration_ms=round((time.time() - start) * 1000),
            )

        timeout = timeout_seconds or self.timeout
        payload = {
            "sessionId": None,
            "runId": None,
            "toolName": "sandbox_python" if mode == "python" else "sandbox_shell",
            "mode": mode,
            "payload": {
                "command": command,
                "code": code,
                "inputData": input_data or {},
                "timeoutSeconds": timeout,
                "image": self.image,
                "memoryLimit": self.memory_limit,
                "networkDisabled": self.network_disabled,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                headers = await _get_internal_service_headers(client)
                if not headers:
                    return SandboxResult(
                        error="Sandbox worker pool could not mint an internal service token.",
                        duration_ms=round((time.time() - start) * 1000),
                    )
                create = await client.post(
                    f"{API_URL}/api/gateway/internal/swarm/sandbox-jobs",
                    json=payload,
                    headers=headers,
                )
                create.raise_for_status()
                create_payload = create.json()
                _capture_internal_auth(create_payload)
                headers = {"Authorization": f"Bearer {_INTERNAL_SERVICE_TOKEN}"} if _INTERNAL_SERVICE_TOKEN else headers
                job = create_payload.get("job") or {}
                job_id = job.get("id")
                if not job_id:
                    return SandboxResult(
                        error="Sandbox worker pool returned no job id.",
                        duration_ms=round((time.time() - start) * 1000),
                    )

                deadline = time.time() + timeout + 10
                while time.time() < deadline:
                    await asyncio.sleep(1)
                    response = await client.get(
                        f"{API_URL}/api/gateway/internal/swarm/sandbox-jobs/{job_id}",
                        headers=headers,
                    )
                    response.raise_for_status()
                    current_payload = response.json()
                    _capture_internal_auth(current_payload)
                    headers = {"Authorization": f"Bearer {_INTERNAL_SERVICE_TOKEN}"} if _INTERNAL_SERVICE_TOKEN else headers
                    current = current_payload.get("job") or {}
                    status = current.get("status")
                    if status in {"completed", "failed", "cancelled"}:
                        result = current.get("result") or {}
                        return SandboxResult(
                            stdout=result.get("stdout", ""),
                            stderr=result.get("stderr", ""),
                            exit_code=int(result.get("exitCode", -1) or -1),
                            timed_out=bool(result.get("timedOut", False)),
                            output_files=result.get("outputFiles", {}) or {},
                            error=result.get("error"),
                            duration_ms=int(result.get("durationMs", round((time.time() - start) * 1000)) or 0),
                        )

                return SandboxResult(
                    error=f"Sandbox worker job timed out after {timeout}s",
                    duration_ms=round((time.time() - start) * 1000),
                )
        except Exception as e:
            return SandboxResult(
                error=f"Sandbox worker execution failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000),
            )

    async def run(
        self,
        command: str,
        input_files: Optional[Dict[str, str]] = None,
        timeout_seconds: Optional[int] = None,
    ) -> SandboxResult:
        """
        Execute the given command inside a Docker sandbox.

        Args:
            command: The shell command to execute.
            input_files: Optional dict of filename -> content to mount.
            timeout_seconds: Override timeout for this execution.

        Returns:
            SandboxResult with stdout, stderr, exit_code, etc.
        """
        start = time.time()
        timeout = timeout_seconds or self.timeout

        if SANDBOX_WORKER_POOL_ENABLED:
            return await self._run_via_worker_pool(
                mode="shell",
                command=command,
                timeout_seconds=timeout,
            )

        # --- SECURITY GATE: Docker must be running ---
        docker_ok = await self._ensure_docker()
        if not docker_ok:
            return SandboxResult(
                error="Docker is required for sandboxed tools. Start Docker Desktop and retry.",
                duration_ms=round((time.time() - start) * 1000),
            )

        mount_specs = self._get_mount_specs()

        # Build docker run command
        cmd: List[str] = [
            "docker", "run",
            "--rm",                         # Cleanup container after exit
            "--network=none" if self.network_disabled else "--network=host",
            f"--memory={self.memory_limit}",
            "--cpus=0.5",                   # CPU limit
            "--read-only",                  # Read-only root filesystem
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",  # nosec B108
            "--user", "nobody",             # Non-root user
        ]

        for spec in mount_specs:
            cmd.extend([
                "--mount",
                f"type=bind,source={spec['source']},target={spec['target']},readonly",
            ])

        if mount_specs:
            cmd.extend(["-w", mount_specs[0]["target"]])

        cmd.extend([
            "-i",                           # Accept stdin
            self.image,
            "sh", "-c", command,
        ])

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return SandboxResult(
                    timed_out=True,
                    error=f"Sandbox execution timed out after {timeout}s",
                    duration_ms=round((time.time() - start) * 1000),
                )

            duration_ms = round((time.time() - start) * 1000)
            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            return SandboxResult(
                stdout=stdout_str,
                stderr=stderr_str,
                exit_code=proc.returncode or 0,
                duration_ms=duration_ms,
                error=None if proc.returncode == 0 else stderr_str[:500] or "Unknown error",
            )

        except Exception as e:
            return SandboxResult(
                error=f"Sandbox execution failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000),
            )

    async def run_python(
        self,
        code: str,
        input_data: Optional[Dict[str, Any]] = None,
    ) -> SandboxResult:
        """
        Execute Python code inside the sandbox.
        Input data is passed via stdin as JSON.
        """
        start = time.time()

        if SANDBOX_WORKER_POOL_ENABLED:
            return await self._run_via_worker_pool(
                mode="python",
                code=code,
                input_data=input_data,
                timeout_seconds=self.timeout,
            )

        # --- SECURITY GATE: Docker must be running ---
        docker_ok = await self._ensure_docker()
        if not docker_ok:
            return SandboxResult(
                error="Docker is required for sandboxed tools. Start Docker Desktop and retry.",
                duration_ms=round((time.time() - start) * 1000),
            )

        mount_specs = self._get_mount_specs()

        cmd = [
            "docker", "run",
            "--rm",
            "--network=none",
            f"--memory={self.memory_limit}",
            "--cpus=0.5",
            "--read-only",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",  # nosec B108
            "--user", "nobody",
        ]

        for spec in mount_specs:
            cmd.extend([
                "--mount",
                f"type=bind,source={spec['source']},target={spec['target']},readonly",
            ])

        if mount_specs:
            cmd.extend(["-w", mount_specs[0]["target"]])

        cmd.extend([
            "-i",
            self.image,
            "python3", "-c", code,
        ])

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            input_bytes = json.dumps(input_data or {}).encode("utf-8")

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(input=input_bytes),
                    timeout=self.timeout,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return SandboxResult(
                    timed_out=True,
                    error=f"Sandbox execution timed out after {self.timeout}s",
                    duration_ms=round((time.time() - start) * 1000),
                )

            duration_ms = round((time.time() - start) * 1000)
            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            return SandboxResult(
                stdout=stdout_str,
                stderr=stderr_str,
                exit_code=proc.returncode or 0,
                duration_ms=duration_ms,
                error=None if proc.returncode == 0 else stderr_str[:500] or "Unknown error",
            )

        except Exception as e:
            return SandboxResult(
                error=f"Sandbox execution failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000),
            )

    def invalidate_cache(self) -> None:
        """Force re-check of Docker availability on next execution."""
        self._docker_checked = False
        self._docker_ok = False
