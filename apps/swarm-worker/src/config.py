from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import List


def _bootstrap_env() -> None:
    root = Path(__file__).resolve().parents[3]
    candidates = [
        root / ".env",
        root / "apps" / "swarm-worker" / ".env",
    ]
    for path in candidates:
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            normalized = value.strip().strip('"').strip("'")
            os.environ[key] = normalized


_bootstrap_env()


def _parse_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_list(name: str, default: List[str]) -> List[str]:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(slots=True)
class WorkerConfig:
    phase3_enabled: bool = _parse_bool("RAWCLAW_PHASE3_ENABLED", True)
    api_url: str = os.getenv("RAWCLAW_API_URL", os.getenv("API_URL", "http://localhost:3000")).rstrip("/")
    agent_url: str = os.getenv("RAWCLAW_AGENT_URL", os.getenv("AGENT_URL", "http://localhost:8001")).rstrip("/")
    redis_url: str = os.getenv("RAWCLAW_REDIS_URL", os.getenv("REDIS_URL", "redis://localhost:6379"))
    chroma_url: str = os.getenv(
        "RAWCLAW_CHROMA_URL",
        os.getenv("CHROMA_URL", f"http://{os.getenv('CHROMA_HOST', 'localhost')}:{os.getenv('CHROMA_PORT', '8010')}"),
    )
    bootstrap_secret: str = os.getenv("INTERNAL_WORKER_BOOTSTRAP_SECRET", os.getenv("AUTH_SECRET", ""))
    signing_key: str = os.getenv("INTERNAL_WORKER_SIGNING_KEY", os.getenv("JWT_SECRET", ""))
    token_ttl_seconds: int = int(os.getenv("INTERNAL_WORKER_TOKEN_TTL_SECONDS", "300"))
    worker_id: str = os.getenv("SWARM_WORKER_ID", f"swarm-{socket.gethostname()}-{os.getpid()}")
    worker_type: str = os.getenv("SWARM_WORKER_TYPE", "python_swarm_worker")
    enable_subagent_queue: bool = _parse_bool("SWARM_ENABLE_SUBAGENT_QUEUE", True)
    enable_automation_queue: bool = _parse_bool("SWARM_ENABLE_AUTOMATION_QUEUE", True)
    enable_sandbox_queue: bool = _parse_bool("SWARM_ENABLE_SANDBOX_QUEUE", True)
    enable_builder_queue: bool = _parse_bool("SWARM_ENABLE_BUILDER_QUEUE", True)
    consumer_block_ms: int = int(os.getenv("SWARM_CONSUMER_BLOCK_MS", "750"))
    heartbeat_interval_seconds: int = int(os.getenv("SWARM_HEARTBEAT_INTERVAL_SECONDS", "20"))
    lease_seconds: int = int(os.getenv("SWARM_LEASE_SECONDS", "60"))
    sandbox_image: str = os.getenv("SANDBOX_IMAGE", "python:3.11-slim")
    sandbox_memory_limit: str = os.getenv("SANDBOX_MEMORY_LIMIT", "256m")
    sandbox_network_disabled: bool = _parse_bool("SANDBOX_NETWORK_DISABLED", True)
    allowed_paths: List[str] = field(
        default_factory=lambda: _parse_list(
            "ALLOWED_PATHS",
            [str(Path(__file__).resolve().parents[3])],
        ),
    )

    @property
    def queues(self) -> List[str]:
        queues: List[str] = []
        if self.enable_subagent_queue:
            queues.append("subagent")
        if self.enable_automation_queue:
            queues.append("automation")
        if self.enable_sandbox_queue:
            queues.append("sandbox")
        if self.enable_builder_queue:
            queues.append("builder")
        return queues
