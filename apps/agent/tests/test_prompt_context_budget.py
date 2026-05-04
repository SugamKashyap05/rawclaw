import json
from typing import Any

import pytest

from src.contracts.chat import ChatMessage, ChatRequest
from src.executor import Executor, MAX_MODEL_PAYLOAD_CHARS, MAX_TOOLS_PER_REQUEST
from src.tools.registry import TOOL_REGISTRY


def _tool(name: str, description: str = "tool", parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters or {"type": "object", "properties": {}},
        },
    }


def test_prepare_model_inputs_caps_messages_and_tool_schemas():
    executor = Executor()
    messages = [
        {"role": "system", "content": "system " + ("x" * 240_000)},
        {"role": "user", "content": "please analyze this"},
    ]
    tools = [
        _tool(
            f"tool_{index}",
            description="description " + ("y" * 5_000),
            parameters={
                "type": "object",
                "properties": {
                    "payload": {
                        "type": "string",
                        "description": "payload " + ("z" * 5_000),
                    }
                },
            },
        )
        for index in range(MAX_TOOLS_PER_REQUEST + 5)
    ]

    model_messages, model_tools = executor._prepare_model_inputs(messages, tools)

    assert executor._estimate_model_payload_chars(model_messages, model_tools) <= MAX_MODEL_PAYLOAD_CHARS
    assert len(model_tools) <= MAX_TOOLS_PER_REQUEST
    assert "y" * 1000 not in json.dumps(model_tools)


@pytest.mark.asyncio
async def test_execute_uses_request_filtered_tools_for_prompt_not_full_registry(monkeypatch):
    executor = Executor()
    captured_calls: list[dict[str, Any]] = []

    async def fake_complete(messages, **kwargs):
        captured_calls.append({"messages": messages, "tools": kwargs.get("tools") or []})
        yield "done"
        yield {
            "type": "metadata",
            "metadata": {
                "modelId": "ollama/qwen2.5:1.5b",
                "isLocal": True,
            },
        }

    async def fake_normalize(_model):
        return "ollama/qwen2.5:1.5b"

    executor.model_router.complete = fake_complete
    executor.model_router.normalize_model_id = fake_normalize
    executor.model_router.has_native_thinking = lambda _model: False
    monkeypatch.setattr(
        TOOL_REGISTRY,
        "get_schemas",
        lambda: [_tool("evil_registry_tool", "registry-only " + ("x" * 100_000))],
    )

    request = ChatRequest(
        session_id="context-budget-test",
        messages=[ChatMessage(role="user", content="analyze this request and suggest next steps")],
        tools=[_tool("allowed_request_tool", "small allowed tool")],
    )

    events = []
    async for chunk in executor.execute(request):
        events.append(json.loads(chunk))
        if captured_calls:
            break

    assert captured_calls
    first_system = next(message["content"] for message in captured_calls[0]["messages"] if message["role"] == "system")
    assert "allowed_request_tool" in first_system
    assert "evil_registry_tool" not in first_system
    assert [tool["function"]["name"] for tool in captured_calls[0]["tools"]] == ["allowed_request_tool"]
