import asyncio
import os
import sys
from pathlib import Path


def _bootstrap_env() -> None:
    root = Path(__file__).resolve().parents[2]
    env_path = root / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


_bootstrap_env()

if sys.platform == "win32":
    policy = asyncio.WindowsSelectorEventLoopPolicy()
    asyncio.set_event_loop_policy(policy)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

from src.main import main

if __name__ == "__main__":
    print(
        "[RawClaw swarm-worker] phase3=%s api=%s redis=%s chroma=%s"
        % (
            os.getenv("RAWCLAW_PHASE3_ENABLED", "true"),
            os.getenv("RAWCLAW_API_URL", os.getenv("API_URL", "http://localhost:3000")),
            os.getenv("RAWCLAW_REDIS_URL", os.getenv("REDIS_URL", "redis://localhost:6379")),
            os.getenv("RAWCLAW_CHROMA_URL", f"http://{os.getenv('CHROMA_HOST', 'localhost')}:{os.getenv('CHROMA_PORT', '8010')}"),
        )
    )
    main()
