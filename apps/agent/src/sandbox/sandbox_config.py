"""
SandboxConfig — Environment-driven configuration for Docker sandbox.

Read from environment on module load. Log status at startup.
"""
import logging
import os
from typing import List

logger = logging.getLogger("rawclaw.sandbox")

# Environment variable names
ENV_SANDBOX_ENABLED = "SANDBOX_ENABLED"
ENV_SANDBOX_IMAGE = "SANDBOX_IMAGE"
ENV_SANDBOX_TIMEOUT = "SANDBOX_TIMEOUT"
ENV_SANDBOX_MEMORY_LIMIT = "SANDBOX_MEMORY_LIMIT"
ENV_SANDBOX_NETWORK_DISABLED = "SANDBOX_NETWORK_DISABLED"
ENV_ALLOWED_PATHS = "ALLOWED_PATHS"


class SandboxConfig:
    """
    Configuration for the Docker sandbox executor.
    All values are read from environment at module load time.
    """

    def __init__(self) -> None:
        self.enabled: bool = self._parse_bool(ENV_SANDBOX_ENABLED, True)
        self.image: str = os.getenv(ENV_SANDBOX_IMAGE, "python:3.11-slim")
        self.timeout: int = self._parse_int(ENV_SANDBOX_TIMEOUT, 30)
        self.memory_limit: str = os.getenv(ENV_SANDBOX_MEMORY_LIMIT, "256m")
        self.network_disabled: bool = self._parse_bool(ENV_SANDBOX_NETWORK_DISABLED, True)
        self.allowed_paths: List[str] = self._parse_list(ENV_ALLOWED_PATHS, [])

    def _parse_bool(self, name: str, default: bool) -> bool:
        val = os.getenv(name)
        if val is None:
            return default
        return val.lower() in ("true", "1", "yes", "on")

    def _parse_int(self, name: str, default: int) -> int:
        val = os.getenv(name)
        if val is None:
            return default
        try:
            return int(val)
        except ValueError:
            return default

    def _parse_list(self, name: str, default: List[str]) -> List[str]:
        val = os.getenv(name)
        if val is None or not val.strip():
            return default
        return [p.strip() for p in val.split(",") if p.strip()]

    def log_status(self) -> None:
        """Log the current sandbox configuration status."""
        if self.enabled:
            logger.info(
                f"Sandbox ENABLED: image={self.image}, timeout={self.timeout}s, "
                f"memory={self.memory_limit}, network_disabled={self.network_disabled}"
            )
        else:
            logger.warning(
                "SANDBOX_ENABLED=False — Sandboxed tools will refuse execution if Docker is required. "
                "This is NOT recommended for production."
            )


# Global singleton instance
_config: SandboxConfig | None = None


def get_sandbox_config() -> SandboxConfig:
    """Get the global SandboxConfig singleton."""
    global _config
    if _config is None:
        _config = SandboxConfig()
    return _config