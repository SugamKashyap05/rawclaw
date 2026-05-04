import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.page_read_types import (
    BROWSER_CAPABILITY_FUTURE_WAIT_TIMEOUT_S,
    BROWSER_CAPABILITY_TRANSIENT_RETRIES,
    CapabilityOutcome,
)

logger = logging.getLogger("rawclaw.tools.browser_capability")


@dataclass
class _CapabilityCacheState:
    result: Optional[bool] = None
    future: Optional[asyncio.Future] = None


_state = _CapabilityCacheState()
_state_lock = asyncio.Lock()
_capability_finalizer_tasks: set[asyncio.Task] = set()


def _tool_server_id(tool: object) -> str:
    return str(getattr(tool, "mcp_server_id", "") or getattr(tool, "_server_name", "") or "")


def _compute_browser_capability(tool_registry=TOOL_REGISTRY) -> bool:
    navigate = tool_registry.get_optional("browser_navigate")
    snapshot = tool_registry.get_optional("browser_snapshot")
    if not navigate or not snapshot:
        return False

    navigate_server = _tool_server_id(navigate)
    snapshot_server = _tool_server_id(snapshot)
    if navigate_server and snapshot_server and navigate_server != snapshot_server:
        logger.warning(
            "browser page-read unavailable: browser_navigate server %s differs from browser_snapshot server %s",
            navigate_server,
            snapshot_server,
        )
        return False
    return True


async def _finalize_capability_future(
    future: asyncio.Future,
    outcome: CapabilityOutcome,
) -> None:
    async with _state_lock:
        if not future.done():
            future.set_result(outcome)
        if _state.future is future:
            _state.future = None
        if outcome.status == "success":
            _state.result = bool(outcome.value)


def _track_finalizer(task: asyncio.Task) -> None:
    _capability_finalizer_tasks.add(task)

    def _done(done_task: asyncio.Task) -> None:
        _capability_finalizer_tasks.discard(done_task)
        try:
            done_task.result()
        except Exception as exc:  # pragma: no cover - defensive logging path
            logger.error("browser capability finalizer failed: %s", exc)

    task.add_done_callback(_done)


def _schedule_finalizer(future: asyncio.Future, outcome: CapabilityOutcome) -> None:
    task = asyncio.ensure_future(_finalize_capability_future(future, outcome))
    _track_finalizer(task)


async def reset_browser_capability_cache() -> None:
    async with _state_lock:
        _state.result = None
        _state.future = None


async def check_browser_page_read_capability(tool_registry=TOOL_REGISTRY) -> bool:
    transient_retries_remaining = BROWSER_CAPABILITY_TRANSIENT_RETRIES

    while True:
        owner = False
        async with _state_lock:
            if _state.result is not None:
                return bool(_state.result)
            if _state.future is None:
                loop = asyncio.get_running_loop()
                _state.future = loop.create_future()
                future = _state.future
                owner = True
            else:
                future = _state.future

        if owner:
            try:
                value = bool(_compute_browser_capability(tool_registry))
                _schedule_finalizer(future, CapabilityOutcome(status="success", value=value))
                return value
            except BaseException as exc:
                logger.warning("browser capability check transient failure: %s", exc)
                _schedule_finalizer(future, CapabilityOutcome(status="transient_error", value=False))
                if transient_retries_remaining > 0:
                    transient_retries_remaining -= 1
                    continue
                return False

        try:
            outcome = await asyncio.wait_for(
                asyncio.shield(future),
                timeout=BROWSER_CAPABILITY_FUTURE_WAIT_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            if transient_retries_remaining > 0:
                transient_retries_remaining -= 1
                continue
            return False
        except RuntimeError as exc:
            logger.warning("browser capability wait aborted: %s", exc)
            return False

        if not isinstance(outcome, CapabilityOutcome):
            return False
        if outcome.status == "success":
            return bool(outcome.value)
        if transient_retries_remaining > 0:
            transient_retries_remaining -= 1
            continue
        return False
