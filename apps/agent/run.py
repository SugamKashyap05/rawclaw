"""
RawClaw agent entry point.
Always use this file to start the agent. Never call src.main directly.
This file ensures the correct asyncio event loop policy is set before
uvicorn loads on Windows.
"""
import os
import sys
import asyncio
from pathlib import Path


def _bootstrap_env() -> None:
    root = Path(__file__).resolve().parents[2]
    env_path = root / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def _env(name: str, *fallbacks: str, default: str = "") -> str:
    for candidate in (name, *fallbacks):
        value = os.getenv(candidate)
        if value is not None and value != "":
            return value
    return default


def _env_bool(name: str, *fallbacks: str, default: bool = False) -> bool:
    return _env(name, *fallbacks, default="true" if default else "false").strip().lower() in {"1", "true", "yes", "on"}


def _normalize_runtime_env() -> None:
    phase3_enabled = _env_bool("RAWCLAW_PHASE3_ENABLED", default=True)
    if "RAWCLAW_API_URL" not in os.environ and "API_URL" in os.environ:
        os.environ["RAWCLAW_API_URL"] = os.environ["API_URL"]
    if "API_URL" not in os.environ:
        os.environ["API_URL"] = _env("RAWCLAW_API_URL", default="http://localhost:3000")
    if "RAWCLAW_AGENT_URL" not in os.environ and "AGENT_URL" in os.environ:
        os.environ["RAWCLAW_AGENT_URL"] = os.environ["AGENT_URL"]
    if "AGENT_URL" not in os.environ:
        os.environ["AGENT_URL"] = _env("RAWCLAW_AGENT_URL", default="http://localhost:8001")
    if "RAWCLAW_REDIS_URL" not in os.environ and "REDIS_URL" in os.environ:
        os.environ["RAWCLAW_REDIS_URL"] = os.environ["REDIS_URL"]
    if "REDIS_URL" not in os.environ:
        os.environ["REDIS_URL"] = _env("RAWCLAW_REDIS_URL", default="redis://localhost:6379")
    if "SANDBOX_WORKER_POOL_ENABLED" not in os.environ:
        os.environ["SANDBOX_WORKER_POOL_ENABLED"] = "true" if phase3_enabled else "false"
    if "INTERNAL_WORKER_BOOTSTRAP_SECRET" not in os.environ and "AUTH_SECRET" in os.environ:
        os.environ["INTERNAL_WORKER_BOOTSTRAP_SECRET"] = os.environ["AUTH_SECRET"]


_bootstrap_env()
_normalize_runtime_env()

if sys.platform == "win32":
    policy = asyncio.WindowsSelectorEventLoopPolicy()
    asyncio.set_event_loop_policy(policy)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

from src.main import main

print(
    "[RawClaw agent] phase3=%s sandbox_worker_pool=%s api=%s redis=%s"
    % (
        _env("RAWCLAW_PHASE3_ENABLED", default="true"),
        _env("SANDBOX_WORKER_POOL_ENABLED", default="true"),
        _env("RAWCLAW_API_URL", "API_URL", default="http://localhost:3000"),
        _env("RAWCLAW_REDIS_URL", "REDIS_URL", default="redis://localhost:6379"),
    )
)

main()
