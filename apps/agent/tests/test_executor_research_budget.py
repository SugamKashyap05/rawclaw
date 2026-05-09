import json
from unittest.mock import AsyncMock

import pytest

from src.contracts.chat import ChatMessage, ChatRequest
from src.contracts.tool import ToolResult
from src.executor import Executor, MAX_RESEARCH_TOOL_TURNS, RESEARCH_BUDGET_EXHAUSTED_MESSAGE


def _tool_schema(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": f"{name} tool",
            "parameters": {"type": "object", "properties": {}},
        },
    }


@pytest.mark.asyncio
async def test_execute_forces_final_synthesis_after_research_tool_budget():
    executor = Executor()
    router_calls: list[list[dict] | None] = []
    tool_names = ["web_search", "web_extract", "web_fetch", "browser_navigate"]

    async def fake_complete(_messages, **kwargs):
        router_calls.append(kwargs.get("tools"))
        call_index = len(router_calls)
        if call_index <= MAX_RESEARCH_TOOL_TURNS:
            yield {
                "type": "tool_call",
                "tool_call": {
                    "name": tool_names[call_index - 1],
                    "arguments": {"url": f"https://example.com/{call_index}"},
                },
            }
            return
        yield {"type": "content", "content": "Grounded final answer."}
        yield {"type": "metadata", "metadata": {"modelId": "ollama/qwen2.5", "isLocal": True}}

    async def fake_execute_tool(*_args, **_kwargs):
        return ToolResult(
            tool_name="web_search",
            input={"q": "status"},
            output={"results": [{"title": "Example", "snippet": "Verified result"}]},
            duration_ms=12,
            sandboxed=False,
        )

    executor.model_router.complete = fake_complete
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5")
    executor.model_router.has_native_thinking = lambda _model: False
    executor._execute_tool_with_confirmation = AsyncMock(side_effect=fake_execute_tool)
    executor._guardian_gate_answer = AsyncMock(return_value=("Grounded final answer.", [], {}))

    request = ChatRequest(
        session_id="research-budget",
        messages=[ChatMessage(role="user", content="Search the web and tell me what you find")],
        model="ollama/qwen2.5",
        tools=[_tool_schema(name) for name in tool_names],
    )

    events = []
    async for chunk in executor.execute(request):
        events.append(json.loads(chunk))

    assert len(router_calls) == MAX_RESEARCH_TOOL_TURNS + 1
    assert router_calls[-1] in (None, [])
    assert any(event.get("type") == "content" and event.get("content") == "Grounded final answer." for event in events)
    assert not any(event.get("type") == "error" and event.get("error") == "turn_limit_reached" for event in events)


@pytest.mark.asyncio
async def test_execute_emits_reasoning_limit_when_forced_synthesis_has_no_answer():
    executor = Executor()
    router_calls: list[list[dict] | None] = []

    async def fake_complete(_messages, **kwargs):
        router_calls.append(kwargs.get("tools"))
        call_index = len(router_calls)
        if call_index <= MAX_RESEARCH_TOOL_TURNS:
            yield {
                "type": "tool_call",
                "tool_call": {
                    "name": "web_search",
                    "arguments": {"q": f"query-{call_index}"},
                },
            }
            return
        if False:
            yield {}

    async def fake_execute_tool(*_args, **_kwargs):
        return ToolResult(
            tool_name="web_search",
            input={"q": "status"},
            output={"results": [{"title": "Example", "snippet": "Verified result"}]},
            duration_ms=12,
            sandboxed=False,
        )

    executor.model_router.complete = fake_complete
    executor.model_router.normalize_model_id = AsyncMock(return_value="ollama/qwen2.5")
    executor.model_router.has_native_thinking = lambda _model: False
    executor._execute_tool_with_confirmation = AsyncMock(side_effect=fake_execute_tool)
    executor._guardian_gate_answer = AsyncMock(return_value=("", [], {}))

    request = ChatRequest(
        session_id="research-budget-empty",
        messages=[ChatMessage(role="user", content="Search the web and summarize the results")],
        model="ollama/qwen2.5",
        tools=[_tool_schema("web_search"), _tool_schema("web_extract")],
    )

    events = []
    async for chunk in executor.execute(request):
        events.append(json.loads(chunk))

    error_events = [event for event in events if event.get("type") == "error"]
    assert error_events
    assert error_events[-1]["error"] == "turn_limit_reached"
    assert error_events[-1]["message"] == RESEARCH_BUDGET_EXHAUSTED_MESSAGE
    assert router_calls[-1] in (None, [])
