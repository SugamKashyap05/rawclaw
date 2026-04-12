"""
DateTimeTool — Returns the current UTC time and optional timezone conversion.

Safe tool: no sandbox, no confirmation required.
Tags: utility, time
"""
import time as _time
from datetime import datetime, timezone
from typing import Any, Dict

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult


class DateTimeTool(BaseTool):
    name = "get_datetime"
    description = "Returns the current date and time in ISO 8601 format, Unix timestamp, and human-readable format. Optionally accepts a timezone."
    parameters = {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "IANA timezone name (e.g., 'America/New_York', 'Asia/Kolkata', 'UTC'). Defaults to UTC.",
                "default": "UTC",
            }
        },
        "required": [],
    }
    capability_tags = ["utility", "time"]
    requires_sandbox = False
    requires_confirmation = False

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start = _time.time()
        tz_name = input.get("timezone", "UTC")

        try:
            if tz_name == "UTC":
                tz = timezone.utc
            else:
                tz = ZoneInfo(tz_name)

            now = datetime.now(tz)
            result = {
                "iso8601": now.isoformat(),
                "unix_timestamp": int(now.timestamp()),
                "timezone": tz_name,
                "human_readable": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
            }
            return ToolResult(
                tool_name=self.name,
                input=input,
                output=result,
                duration_ms=round((_time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        except ZoneInfoNotFoundError:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Unknown timezone: {tz_name}. Use IANA timezone names like 'America/New_York'.",
                duration_ms=round((_time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        except Exception as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=str(e),
                duration_ms=round((_time.time() - start) * 1000, 2),
                sandboxed=False,
            )