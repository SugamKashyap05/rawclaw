import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
import src.executor as executor_module
from src.executor import Executor
from src.contracts.chat import ChatRequest
from src.contracts.tool import ToolResult

@pytest.mark.asyncio
async def test_sequential_thinking_interception():
    # Setup mocks
    mock_router = MagicMock()
    # Mock normalize_model_id to return a string
    mock_router.normalize_model_id = AsyncMock(return_value="ollama/llama3")
    mock_router.has_native_thinking.return_value = False
    
    # Mock complete to yield a sequential_thinking tool call
    async def mock_complete(*args, **kwargs):
        yield {
            "type": "tool_call",
            "tool_call": {
                "name": "sequential_thinking",
                "arguments": {
                    "thought": "I am thinking about the problem...",
                    "thoughtNumber": 1,
                    "totalThoughts": 2,
                    "nextThoughtNeeded": True
                }
            }
        }
        yield {"type": "content", "content": "I have finished thinking."}

    mock_router.complete.side_effect = mock_complete
    
    executor = Executor()
    executor.model_router = mock_router
    
    # Mock tool execution
    executor._execute_tool_with_confirmation = AsyncMock(
        return_value=ToolResult(
            tool_name="sequential_thinking",
            input={},
            output={"status": "ok"},
            duration_ms=1,
        )
    )
    
    request = ChatRequest(
        session_id="test_session",
        messages=[{"role": "user", "content": "What is the capital of France?"}],
        model="llama3"
    )
    
    events = []
    async for event in executor.execute(request):
        events.append(json.loads(event))
    
    # Verify that we got a 'thinking' event
    thinking_events = [e for e in events if e.get("type") == "thinking"]
    assert len(thinking_events) == 1
    assert thinking_events[0]["thinking"] == "I am thinking about the problem..."
    
    # Verify that we did NOT get a 'tool_call' event for sequential_thinking
    tool_call_events = [e for e in events if e.get("type") == "tool_call"]
    assert len(tool_call_events) == 0
    
    # Verify that harness was skipped for thinking tool
    harness_events = [e for e in events if e.get("type") == "harness"]
    assert len(harness_events) == 0

@pytest.mark.asyncio
async def test_native_thinking_passthrough():
    # Setup mocks
    mock_router = MagicMock()
    mock_router.normalize_model_id = AsyncMock(return_value="anthropic/claude-3-5-sonnet")
    mock_router.has_native_thinking.return_value = True
    
    # Mock complete to yield a thinking_delta
    async def mock_complete(*args, **kwargs):
        yield {
            "type": "thinking_delta",
            "thinking": "Native thinking steps..."
        }
        yield {"type": "content", "content": "Hello!"}

    mock_router.complete.side_effect = mock_complete
    
    executor = Executor()
    executor.model_router = mock_router
    
    request = ChatRequest(
        session_id="test_session",
        messages=[{"role": "user", "content": "Explain quantum physics"}],
        model="claude-3-5-sonnet"
    )
    
    events = []
    async for event in executor.execute(request):
        events.append(json.loads(event))
    
    # Verify that we got a 'thinking' event (mapped from thinking_delta)
    thinking_events = [e for e in events if e.get("type") == "thinking"]
    assert len(thinking_events) == 1
    assert thinking_events[0]["thinking"] == "Native thinking steps..."

@pytest.mark.asyncio
async def test_sequential_thinking_cap_exits_without_timeout(monkeypatch):
    monkeypatch.setattr(executor_module, "MAX_SEQUENTIAL_THINKING_TURNS", 3)

    mock_router = MagicMock()
    mock_router.normalize_model_id = AsyncMock(return_value="ollama/llama3")
    mock_router.has_native_thinking.return_value = False

    async def mock_complete(*args, **kwargs):
        for thought_number in range(1, 6):
            yield {
                "type": "tool_call",
                "tool_call": {
                    "name": "sequential_thinking",
                    "arguments": {
                        "thought": f"Looping thought {thought_number}",
                        "thoughtNumber": thought_number,
                        "totalThoughts": 99,
                        "nextThoughtNeeded": True,
                    },
                },
            }

    mock_router.complete.side_effect = mock_complete

    executor = Executor()
    executor.model_router = mock_router
    executor._execute_tool_with_confirmation = AsyncMock(
        return_value=ToolResult(
            tool_name="sequential_thinking",
            input={},
            output={"status": "ok"},
            duration_ms=1,
        )
    )

    request = ChatRequest(
        session_id="test_session",
        messages=[{"role": "user", "content": "think step by step forever"}],
        model="llama3",
    )

    events = []
    async for event in executor.execute(request):
        events.append(json.loads(event))

    thinking_events = [event for event in events if event.get("type") == "thinking"]
    error_events = [event for event in events if event.get("type") == "error"]

    assert len(thinking_events) <= executor_module.MAX_SEQUENTIAL_THINKING_TURNS
    assert any(event.get("error") == "sequential_thinking_limit_reached" for event in error_events)
    assert not any(event.get("error") == "execution_timeout" for event in error_events)
