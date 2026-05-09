import asyncio
from typing import Any, Dict

from src.contracts.tool import ToolResult
from src.tools.base_tool import BaseTool
from src.tools.registry import ToolRegistry


class MockTool(BaseTool):
    description = "mock tool"
    parameters = {"type": "object", "properties": {}}
    capability_tags = ["test"]

    def __init__(self, name: str) -> None:
        self.name = name

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        return ToolResult(tool_name=self.name, input=input, output={})


class ValidatedMockTool(BaseTool):
    description = "validated mock tool"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
        },
        "required": ["query"],
        "additionalProperties": False,
    }
    capability_tags = ["test"]

    def __init__(self, name: str) -> None:
        self.name = name
        self.executed = False

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        self.executed = True
        return ToolResult(tool_name=self.name, input=input, output={"ok": True}, duration_ms=1.0)


def test_empty_tool_ids_returns_empty_list():
    """CRITICAL: empty selection must never return all tools."""
    registry = ToolRegistry()
    registry.register(MockTool("tool_a"))
    registry.register(MockTool("tool_b"))
    registry.register(MockTool("tool_c"))

    result = registry.resolve_tools_for_turn([])

    assert result == [], (
        "FAIL-OPEN BUG: empty selection returned tools instead of empty list"
    )


def test_none_tool_ids_returns_empty_list():
    registry = ToolRegistry()
    registry.register(MockTool("tool_a"))

    result = registry.resolve_tools_for_turn(None)

    assert result == []


def test_unknown_tool_ids_are_skipped():
    registry = ToolRegistry()
    registry.register(MockTool("real_tool"))

    result = registry.resolve_tools_for_turn(["real_tool", "ghost_tool"])

    assert len(result) == 1
    assert result[0].name == "real_tool"


def test_invalid_tool_arguments_are_rejected_before_execution():
    registry = ToolRegistry()
    tool = ValidatedMockTool("validated_tool")
    registry.register(tool)

    result = asyncio.run(
        registry.execute_tool("validated_tool", {"unexpected": "value"}, turn_id="t-001")
    )

    assert result.error is not None
    assert result.error == "tool_argument_invalid"
    assert tool.executed is False


def test_valid_tool_arguments_execute_successfully():
    registry = ToolRegistry()
    tool = ValidatedMockTool("validated_tool")
    registry.register(tool)

    result = asyncio.run(
        registry.execute_tool("validated_tool", {"query": "hello"}, turn_id="t-002")
    )

    assert result.error is None
    assert result.output == {"ok": True}
    assert tool.executed is True
