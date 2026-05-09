from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import shutil
import socket
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from redis.asyncio import Redis
from redis.exceptions import ResponseError

from .config import WorkerConfig

logging.basicConfig(
    level=getattr(logging, str(os.getenv("LOG_LEVEL", "INFO") or "INFO").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("rawclaw.swarm_worker")

SUBAGENT_QUEUE_STREAM = "gateway:queue:subagent"
SUBAGENT_QUEUE_GROUP = "gateway-subagent-workers"
AUTOMATION_QUEUE_STREAM = "gateway:queue:automation"
AUTOMATION_QUEUE_GROUP = "gateway-automation-workers"
SANDBOX_QUEUE_STREAM = "gateway:queue:sandbox"
SANDBOX_QUEUE_GROUP = "gateway-sandbox-workers"
BUILDER_QUEUE_STREAM = "gateway:queue:builder"
BUILDER_QUEUE_GROUP = "gateway-builder-workers"


def _decode_stream_values(raw_values: Dict[Any, Any]) -> Dict[str, str]:
    decoded: Dict[str, str] = {}
    for key, value in raw_values.items():
        normalized_key = key.decode("utf-8") if isinstance(key, bytes) else str(key)
        normalized_value = value.decode("utf-8") if isinstance(value, bytes) else str(value)
        decoded[normalized_key] = normalized_value
    return decoded


class WorkerApi:
    def __init__(self, config: WorkerConfig) -> None:
        self.config = config
        self._bearer_token: Optional[str] = None
        self._token_expires_at: Optional[str] = None
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    def _auth_headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self._bearer_token:
            headers["Authorization"] = f"Bearer {self._bearer_token}"
        return headers

    def _capture_auth(self, payload: Dict[str, Any]) -> None:
        auth = payload.get("auth") if isinstance(payload, dict) else None
        if not isinstance(auth, dict):
            return
        token = auth.get("token")
        expires_at = auth.get("expiresAt")
        if isinstance(token, str) and token:
            self._bearer_token = token
        if isinstance(expires_at, str) and expires_at:
            self._token_expires_at = expires_at

    async def close(self) -> None:
        await self._client.aclose()

    async def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = await self._client.post(
            f"{self.config.api_url}/api{path}",
            json=payload,
            headers=self._auth_headers(),
        )
        response.raise_for_status()
        data = response.json()
        self._capture_auth(data)
        return data

    async def get(self, path: str) -> Dict[str, Any]:
        response = await self._client.get(
            f"{self.config.api_url}/api{path}",
            headers=self._auth_headers(),
        )
        response.raise_for_status()
        data = response.json()
        self._capture_auth(data)
        return data

    async def register(self, worker_id: str, roles: list[str], queues: list[str]) -> None:
        response = await self._client.post(
            f"{self.config.api_url}/api/gateway/internal/swarm/workers/register",
            json={
                "workerId": worker_id,
                "workerType": self.config.worker_type,
                "hostname": socket.gethostname(),
                "pid": os.getpid(),
                "roles": roles,
                "queues": queues,
                "capabilities": [
                    "redis_stream_consumer",
                    "agent_execute_bridge",
                    "sandbox_pool",
                    "app_builder_executor",
                ],
                "metadata": {
                    "python": sys.version,
                    "phase3Enabled": self.config.phase3_enabled,
                    "chromaUrl": self.config.chroma_url,
                },
            },
            headers={"x-rawclaw-worker-secret": self.config.bootstrap_secret},
        )
        response.raise_for_status()
        self._capture_auth(response.json())

    async def heartbeat(
        self,
        worker_id: str,
        current_job_id: Optional[str],
        current_run_id: Optional[str],
        status: str,
        lease_expires_at: Optional[str],
    ) -> None:
        await self.post(
            f"/gateway/internal/swarm/workers/{worker_id}/heartbeat",
            {
                "currentJobId": current_job_id,
                "currentRunId": current_run_id,
                "status": status,
                "leaseExpiresAt": lease_expires_at,
            },
        )

    async def offline(self, worker_id: str, reason: str) -> None:
        await self.post(
            f"/gateway/internal/swarm/workers/{worker_id}/offline",
            {"reason": reason},
        )


class SwarmWorker:
    def __init__(self, config: WorkerConfig) -> None:
        self.config = config
        self.redis = Redis.from_url(config.redis_url, decode_responses=False)
        self.api = WorkerApi(config)
        self._stop_event = asyncio.Event()
        self._current_job_id: Optional[str] = None
        self._current_run_id: Optional[str] = None
        self._lease_expires_at: Optional[str] = None

    async def close(self) -> None:
        await self.api.close()
        await self.redis.aclose()

    async def run(self) -> None:
        await self._wait_for_dependencies()
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        logger.info("Phase 3 swarm worker %s online for queues=%s", self.config.worker_id, self.config.queues)
        try:
            while not self._stop_event.is_set():
                handled = False
                if self.config.enable_subagent_queue:
                    handled = await self._drain_subagent_queue() or handled
                if self.config.enable_automation_queue:
                    handled = await self._drain_automation_queue() or handled
                if self.config.enable_sandbox_queue:
                    handled = await self._drain_sandbox_queue() or handled
                if self.config.enable_builder_queue:
                    handled = await self._drain_builder_queue() or handled
                if not handled:
                    await asyncio.sleep(0.35)
        except Exception:
            logger.exception("worker_loop_exception")
            # Re-raise intentionally — let the process supervisor restart us cleanly
            # rather than running in a degraded state.
            raise
        finally:
            self._stop_event.set()
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task
            try:
                await self.api.offline(self.config.worker_id, "Worker shutting down.")
            except Exception as error:
                logger.warning("Worker offline notification failed: %s", error)
            await self.close()

    async def _wait_for_dependencies(self) -> None:
        attempt = 0
        while not self._stop_event.is_set():
            attempt += 1
            try:
                await self.redis.ping()
                await self._ensure_queue_groups()
                await self.api.register(
                    self.config.worker_id,
                    roles=["scout", "analyst", "generic"],
                    queues=self.config.queues,
                )
                logger.info(
                    "Phase 3 swarm worker %s registered with API %s and Redis %s",
                    self.config.worker_id,
                    self.config.api_url,
                    self.config.redis_url,
                )
                return
            except Exception as error:
                logger.warning(
                    "Swarm worker bootstrap waiting for API/Redis (attempt=%s): %s",
                    attempt,
                    error,
                )
                await asyncio.sleep(2.5)

    async def _ensure_queue_groups(self) -> None:
        queue_specs = []
        if self.config.enable_subagent_queue:
            queue_specs.append((SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP))
        if self.config.enable_automation_queue:
            queue_specs.append((AUTOMATION_QUEUE_STREAM, AUTOMATION_QUEUE_GROUP))
        if self.config.enable_sandbox_queue:
            queue_specs.append((SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP))
        if self.config.enable_builder_queue:
            queue_specs.append((BUILDER_QUEUE_STREAM, BUILDER_QUEUE_GROUP))

        for stream, group in queue_specs:
            try:
                await self.redis.xgroup_create(
                    name=stream,
                    groupname=group,
                    id="$",
                    mkstream=True,
                )
            except ResponseError as error:
                if "BUSYGROUP" not in str(error):
                    raise

    async def _heartbeat_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.api.heartbeat(
                    self.config.worker_id,
                    self._current_job_id,
                    self._current_run_id,
                    "busy" if self._current_job_id else "online",
                    self._lease_expires_at,
                )
            except Exception as error:
                logger.warning("Worker heartbeat failed: %s", error)
            await asyncio.sleep(self.config.heartbeat_interval_seconds)

    async def _xread_single(self, stream: str, group: str) -> Optional[tuple[str, Dict[str, str]]]:
        entries = await self.redis.xreadgroup(
            groupname=group,
            consumername=self.config.worker_id,
            streams={stream: ">"},
            count=1,
            block=self.config.consumer_block_ms,
        )
        if not entries:
            return None
        _, records = entries[0]
        if not records:
            return None
        record_id, values = records[0]
        return record_id.decode("utf-8") if isinstance(record_id, bytes) else str(record_id), _decode_stream_values(values)

    async def _load_json_key(self, key: str) -> Optional[Dict[str, Any]]:
        payload = await self.redis.get(key)
        if not payload:
            return None
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        return json.loads(payload)

    async def _drain_subagent_queue(self) -> bool:
        claimed = await self._xread_single(SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP)
        if not claimed:
            return False
        stream_id, values = claimed
        job_id = values.get("jobId")
        if not job_id:
            await self.redis.xack(SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP, stream_id)
            return True

        job = await self._load_json_key(f"gateway:subagent-job:{job_id}")
        if not job:
            await self.redis.xack(SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP, stream_id)
            return True

        await self._run_tracked_job(
            job_id=job_id,
            run_id=str(job.get("runId") or ""),
            turn_id=str(job.get("turn_id") or "no-turn-id"),
            job_type=str(job.get("role") or "subagent"),
            start_path=f"/gateway/internal/swarm/subagent-jobs/{job_id}/start",
            heartbeat_path=f"/gateway/internal/swarm/subagent-jobs/{job_id}/heartbeat",
            complete_path=f"/gateway/internal/swarm/subagent-jobs/{job_id}/complete",
            fail_path=f"/gateway/internal/swarm/subagent-jobs/{job_id}/fail",
            request_payload=job.get("requestPayload") or {},
            stream=SUBAGENT_QUEUE_STREAM,
            group=SUBAGENT_QUEUE_GROUP,
            stream_id=stream_id,
        )
        return True

    async def _drain_automation_queue(self) -> bool:
        claimed = await self._xread_single(AUTOMATION_QUEUE_STREAM, AUTOMATION_QUEUE_GROUP)
        if not claimed:
            return False
        stream_id, values = claimed
        run_id = values.get("runId")
        if not run_id:
            await self.redis.xack(AUTOMATION_QUEUE_STREAM, AUTOMATION_QUEUE_GROUP, stream_id)
            return True

        job = await self._load_json_key(f"gateway:automation-job:{run_id}")
        if not job:
            await self.redis.xack(AUTOMATION_QUEUE_STREAM, AUTOMATION_QUEUE_GROUP, stream_id)
            return True

        await self._run_tracked_job(
            job_id=run_id,
            run_id=run_id,
            turn_id=str(job.get("turn_id") or "no-turn-id"),
            job_type="automation",
            start_path=f"/gateway/internal/swarm/automation-runs/{run_id}/start",
            heartbeat_path=f"/gateway/internal/swarm/automation-runs/{run_id}/heartbeat",
            complete_path=f"/gateway/internal/swarm/automation-runs/{run_id}/complete",
            fail_path=f"/gateway/internal/swarm/automation-runs/{run_id}/fail",
            request_payload=job.get("requestPayload") or {},
            stream=AUTOMATION_QUEUE_STREAM,
            group=AUTOMATION_QUEUE_GROUP,
            stream_id=stream_id,
        )
        return True

    async def _drain_sandbox_queue(self) -> bool:
        claimed = await self._xread_single(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP)
        if not claimed:
            return False
        stream_id, values = claimed
        job_id = values.get("jobId")
        if not job_id:
            await self.redis.xack(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP, stream_id)
            return True

        job = await self._load_json_key(f"gateway:sandbox-job:{job_id}")
        if not job:
            await self.redis.xack(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP, stream_id)
            return True

        turn_id = str(job.get("turn_id") or "no-turn-id")
        log_ctx = {"turn_id": turn_id, "job_type": str(job.get("toolName") or "sandbox")}
        logger.info("worker_job_started turn_id=%s job_type=%s job_id=%s", turn_id, log_ctx["job_type"], job_id)

        await self.api.post(
            f"/gateway/internal/swarm/sandbox-jobs/{job_id}/start",
            {"workerId": self.config.worker_id},
        )
        self._current_job_id = job_id
        self._current_run_id = str(job.get("runId") or "")
        self._lease_expires_at = self._lease_expiry()
        heartbeat_task = asyncio.create_task(
            self._job_heartbeat_loop(
                f"/gateway/internal/swarm/sandbox-jobs/{job_id}/heartbeat",
            ),
        )
        try:
            job_started_at = time.time()
            result = await self._execute_sandbox_job(job)
            if result.get("error"):
                logger.error(
                    "worker_job_failed turn_id=%s job_type=%s job_id=%s error=%s",
                    turn_id,
                    log_ctx["job_type"],
                    job_id,
                    result.get("error") or "Sandbox job failed",
                )
                await self.api.post(
                    f"/gateway/internal/swarm/sandbox-jobs/{job_id}/fail",
                    {
                        "workerId": self.config.worker_id,
                        "error": result.get("error") or "Sandbox job failed",
                        "result": result,
                    },
                )
            else:
                logger.info(
                    "worker_job_completed turn_id=%s job_type=%s job_id=%s duration_ms=%s",
                    turn_id,
                    log_ctx["job_type"],
                    job_id,
                    round((time.time() - job_started_at) * 1000, 2),
                )
                await self.api.post(
                    f"/gateway/internal/swarm/sandbox-jobs/{job_id}/complete",
                    {
                        "workerId": self.config.worker_id,
                        "result": result,
                    },
                )
        except Exception as error:
            logger.error(
                "worker_job_failed turn_id=%s job_type=%s job_id=%s error=%s",
                turn_id,
                log_ctx["job_type"],
                job_id,
                error,
            )
            await self.api.post(
                f"/gateway/internal/swarm/sandbox-jobs/{job_id}/fail",
                {
                    "workerId": self.config.worker_id,
                    "error": str(error),
                },
            )
        finally:
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task
            self._current_job_id = None
            self._current_run_id = None
            self._lease_expires_at = None
            await self.redis.xack(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP, stream_id)
        return True

    async def _drain_builder_queue(self) -> bool:
        claimed = await self._xread_single(BUILDER_QUEUE_STREAM, BUILDER_QUEUE_GROUP)
        if not claimed:
            return False
        stream_id, values = claimed
        job_id = values.get("jobId")
        if not job_id:
            await self.redis.xack(BUILDER_QUEUE_STREAM, BUILDER_QUEUE_GROUP, stream_id)
            return True

        job = await self._load_json_key(f"gateway:builder-job:{job_id}")
        if not job:
            await self.redis.xack(BUILDER_QUEUE_STREAM, BUILDER_QUEUE_GROUP, stream_id)
            return True

        turn_id = str(job.get("turn_id") or "no-turn-id")
        log_ctx = {"turn_id": turn_id, "job_type": str(job.get("phase") or "builder")}
        logger.info("worker_job_started turn_id=%s job_type=%s job_id=%s", turn_id, log_ctx["job_type"], job_id)

        await self.api.post(
            f"/gateway/internal/swarm/builder-jobs/{job_id}/start",
            {"workerId": self.config.worker_id},
        )
        self._current_job_id = job_id
        self._current_run_id = str(job.get("gatewayRunId") or job.get("runId") or "")
        self._lease_expires_at = self._lease_expiry()
        heartbeat_task = asyncio.create_task(
            self._job_heartbeat_loop(
                f"/gateway/internal/swarm/builder-jobs/{job_id}/heartbeat",
            ),
        )
        try:
            job_started_at = time.time()
            response = await self.api.post(
                f"/app-builder/internal/jobs/{job_id}/execute",
                {"workerId": self.config.worker_id},
            )
            result = response.get("result") if isinstance(response, dict) else None
            summary = "Builder job completed."
            output = None
            if isinstance(result, dict):
                summary = str(result.get("summary") or summary)
                output = result.get("output")
            await self.api.post(
                f"/gateway/internal/swarm/builder-jobs/{job_id}/complete",
                {
                    "workerId": self.config.worker_id,
                    "summary": summary,
                    "output": output,
                },
            )
            logger.info(
                "worker_job_completed turn_id=%s job_type=%s job_id=%s duration_ms=%s",
                turn_id,
                log_ctx["job_type"],
                job_id,
                round((time.time() - job_started_at) * 1000, 2),
            )
        except Exception as error:
            logger.error(
                "worker_job_failed turn_id=%s job_type=%s job_id=%s error=%s",
                turn_id,
                log_ctx["job_type"],
                job_id,
                error,
            )
            await self.api.post(
                f"/gateway/internal/swarm/builder-jobs/{job_id}/fail",
                {
                    "workerId": self.config.worker_id,
                    "error": str(error),
                },
            )
        finally:
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task
            self._current_job_id = None
            self._current_run_id = None
            self._lease_expires_at = None
            await self.redis.xack(BUILDER_QUEUE_STREAM, BUILDER_QUEUE_GROUP, stream_id)
        return True

    def _lease_expiry(self) -> str:
        return time.strftime(
            "%Y-%m-%dT%H:%M:%S.000Z",
            time.gmtime(time.time() + self.config.lease_seconds),
        )

    async def _job_heartbeat_loop(self, heartbeat_path: str) -> None:
        while not self._stop_event.is_set():
            try:
                self._lease_expires_at = self._lease_expiry()
                await self.api.post(
                    heartbeat_path,
                    {"workerId": self.config.worker_id},
                )
            except Exception as error:
                logger.warning("Job heartbeat failed: %s", error)
            await asyncio.sleep(max(5, self.config.lease_seconds // 3))

    async def _run_tracked_job(
        self,
        *,
        job_id: str,
        run_id: str,
        turn_id: str,
        job_type: str,
        start_path: str,
        heartbeat_path: str,
        complete_path: str,
        fail_path: str,
        request_payload: Dict[str, Any],
        stream: str,
        group: str,
        stream_id: str,
    ) -> None:
        logger.info("worker_job_started turn_id=%s job_type=%s job_id=%s", turn_id, job_type, job_id)
        request_payload = {
            **request_payload,
            "turn_id": turn_id,
            "session_id": str(request_payload.get("session_id") or ""),
        }
        await self.api.post(start_path, {"workerId": self.config.worker_id})
        self._current_job_id = job_id
        self._current_run_id = run_id or None
        self._lease_expires_at = self._lease_expiry()
        heartbeat_task = asyncio.create_task(self._job_heartbeat_loop(heartbeat_path))
        try:
            job_started_at = time.time()
            result = await self._execute_chat_request(request_payload)
            await self.api.post(
                complete_path,
                {
                    "workerId": self.config.worker_id,
                    "output": result["content"],
                    "sources": result["sources"],
                    "toolCalls": result["toolCalls"],
                    "provenanceTrace": result["provenanceTrace"],
                },
            )
            logger.info(
                "worker_job_completed turn_id=%s job_type=%s job_id=%s duration_ms=%s",
                turn_id,
                job_type,
                job_id,
                round((time.time() - job_started_at) * 1000, 2),
            )
        except Exception as error:
            logger.error(
                "worker_job_failed turn_id=%s job_type=%s job_id=%s error=%s",
                turn_id,
                job_type,
                job_id,
                error,
            )
            await self.api.post(
                fail_path,
                {
                    "workerId": self.config.worker_id,
                    "error": str(error),
                    "cancelled": "Cancelled by operator" in str(error),
                },
            )
        finally:
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task
            self._current_job_id = None
            self._current_run_id = None
            self._lease_expires_at = None
            await self.redis.xack(stream, group, stream_id)

    async def _execute_chat_request(self, request_payload: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.config.agent_url}/execute"
        turn_id = str(request_payload.get("turn_id") or "no-turn-id")
        session_id = str(request_payload.get("session_id") or "unknown")
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                url,
                json=request_payload,
                headers={
                    "X-Turn-ID": turn_id,
                    "X-Session-ID": session_id,
                },
            ) as response:
                response.raise_for_status()
                content = ""
                sources: list[str] = []
                tool_calls: list[Dict[str, Any]] = []
                provenance_trace: Optional[Dict[str, Any]] = None
                async for line in response.aiter_lines():
                    stripped = line.strip()
                    if not stripped:
                        continue
                    try:
                        event = json.loads(stripped)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "content":
                        content += str(event.get("content") or "")
                    elif event.get("type") == "sources" and isinstance(event.get("sources"), list):
                        sources.extend([str(item) for item in event.get("sources", [])])
                    elif event.get("type") == "tool_call" and event.get("tool_call"):
                        tool_call = event.get("tool_call")
                        if isinstance(tool_call, dict):
                            tool_calls.append(tool_call)
                    elif event.get("type") == "provenance":
                        payload = event.get("provenance_trace") or event.get("provenanceTrace")
                        provenance_trace = payload if isinstance(payload, dict) else None
                    elif event.get("type") == "error":
                        raise RuntimeError(str(event.get("message") or event.get("error") or "Execution failed"))
                return {
                    "content": content,
                    "sources": sources,
                    "toolCalls": tool_calls,
                    "provenanceTrace": provenance_trace,
                }

    def _mount_specs(self) -> list[dict[str, str]]:
        specs: list[dict[str, str]] = []
        for index, mount_path in enumerate(self.config.allowed_paths):
            if not os.path.exists(mount_path):
                continue
            source = str(Path(mount_path).resolve())
            target = "/workspace" if index == 0 else f"/workspace_mount_{index}"
            specs.append({"source": source, "target": target})
        return specs

    async def _execute_sandbox_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        payload = job.get("payload") or {}
        mode = str(job.get("mode") or "shell")
        timeout_seconds = int(payload.get("timeoutSeconds") or 30)
        image = str(payload.get("image") or self.config.sandbox_image)
        memory_limit = str(payload.get("memoryLimit") or self.config.sandbox_memory_limit)
        network_disabled = bool(payload.get("networkDisabled", self.config.sandbox_network_disabled))
        start = time.time()

        if not shutil.which("docker"):
            return {
                "stdout": "",
                "stderr": "",
                "exitCode": -1,
                "timedOut": False,
                "outputFiles": {},
                "error": "Docker is required for sandbox worker execution.",
                "durationMs": round((time.time() - start) * 1000),
            }

        mount_specs = self._mount_specs()
        base_cmd = [
            "docker",
            "run",
            "--rm",
            "--network=none" if network_disabled else "--network=host",
            f"--memory={memory_limit}",
            "--cpus=0.5",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",
            "--user",
            "nobody",
        ]
        for spec in mount_specs:
            base_cmd.extend([
                "--mount",
                f"type=bind,source={spec['source']},target={spec['target']},readonly",
            ])
        if mount_specs:
            base_cmd.extend(["-w", mount_specs[0]["target"]])

        if mode == "python":
            code = str(payload.get("code") or "")
            cmd = [*base_cmd, "-i", image, "python3", "-c", code]
            stdin = json.dumps(payload.get("inputData") or {}).encode("utf-8")
        else:
            command = str(payload.get("command") or "")
            cmd = [*base_cmd, "-i", image, "sh", "-c", command]
            stdin = None

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(input=stdin), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {
                "stdout": "",
                "stderr": "",
                "exitCode": -1,
                "timedOut": True,
                "outputFiles": {},
                "error": f"Sandbox execution timed out after {timeout_seconds}s",
                "durationMs": round((time.time() - start) * 1000),
            }

        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")
        return {
            "stdout": stdout_text,
            "stderr": stderr_text,
            "exitCode": proc.returncode or 0,
            "timedOut": False,
            "outputFiles": {},
            "error": None if proc.returncode == 0 else stderr_text[:500] or "Sandbox execution failed",
            "durationMs": round((time.time() - start) * 1000),
        }


def main() -> None:
    logger.info("swarm_worker_started", extra={"pid": os.getpid()})
    try:
        config = WorkerConfig()
        worker = SwarmWorker(config)
        asyncio.run(worker.run())
    finally:
        logger.info("swarm_worker_stopped", extra={"pid": os.getpid()})


if __name__ == "__main__":
    main()
