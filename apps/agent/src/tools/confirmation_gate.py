"""
ConfirmationGate — Handles user confirmation flow for tools.

When a tool requires confirmation:
1. POST to API to create a pending confirmation record
2. Poll the API for user decision
3. Return approved/rejected/timeout status

CRITICAL: Never bypass this gate for tools with requires_confirmation=True.
"""
import asyncio
import json
import logging
import os
import time
from typing import Dict, Literal

import httpx

from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.confirmation")

# Default API URL (NestJS)
DEFAULT_API_URL = os.getenv("API_URL", "http://localhost:3000")
# Polling interval (seconds)
POLL_INTERVAL = 2
# Maximum wait time (seconds)
MAX_WAIT_TIME = 120


class ConfirmationGate:
    """
    Manages the user confirmation flow for tools that require consent.
    """

    def __init__(self, api_url: str = DEFAULT_API_URL) -> None:
        self.api_url = api_url.rstrip("/")

    async def request_confirmation(
        self,
        session_id: str,
        tool_name: str,
        tool_input: Dict,
    ) -> str:
        """
        Request user confirmation for a tool execution.

        Returns one of: "approved", "rejected", "timeout"
        """
        start = time.time()

        # 1. Create confirmation request
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{self.api_url}/api/tools/confirm",
                    json={
                        "sessionId": session_id,
                        "toolName": tool_name,
                        "toolInput": json.dumps(tool_input),
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                confirmation_id = data.get("id")

                if not confirmation_id:
                    logger.error(f"No confirmation ID returned: {data}")
                    return "rejected"

                logger.info(f"Confirmation request created: {confirmation_id} for {tool_name}")

        except Exception as e:
            logger.error(f"Failed to create confirmation request: {e}")
            return "rejected"

        # 2. Poll for decision
        elapsed = 0
        while elapsed < MAX_WAIT_TIME:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        f"{self.api_url}/api/tools/confirm/{confirmation_id}"
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    status = data.get("status", "pending")

                    if status == "approved":
                        logger.info(f"Confirmation {confirmation_id} approved after {elapsed}s")
                        return "approved"
                    elif status in ("denied", "rejected"):
                        logger.info(f"Confirmation {confirmation_id} rejected after {elapsed}s")
                        return "rejected"
                    # Still pending, continue polling

            except Exception as e:
                logger.warning(f"Error polling confirmation {confirmation_id}: {e}")

        # 3. Timeout
        logger.warning(f"Confirmation {confirmation_id} timed out after {MAX_WAIT_TIME}s")
        return "timeout"

    async def check_and_execute(
        self,
        session_id: str,
        tool_name: str,
        tool_input: Dict,
        execute_fn,
    ) -> ToolResult:
        """
        Check if confirmation is needed, request it, and execute if approved.

        Args:
            session_id: The current chat session ID
            tool_name: Name of the tool
            tool_input: Input for the tool
            execute_fn: Async function to call if approved

        Returns:
            ToolResult with success/error status
        """
        start = time.time()

        # Request confirmation
        decision = await self.request_confirmation(session_id, tool_name, tool_input)

        if decision == "approved":
            # Execute the tool
            return await execute_fn()
        elif decision == "rejected":
            return ToolResult(
                tool_name=tool_name,
                input=tool_input,
                error="Tool execution rejected by user",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        else:  # timeout
            return ToolResult(
                tool_name=tool_name,
                input=tool_input,
                error=f"Confirmation timed out after {MAX_WAIT_TIME} seconds",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )