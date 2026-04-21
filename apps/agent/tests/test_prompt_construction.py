import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from src.executor import Executor
from src.contracts.chat import ChatRequest, ChatMessage, DocumentEditRequest
from src.contracts.tool import ToolCall, ToolResult

@pytest.mark.asyncio
async def test_executor_edit_request_prompt_optimization():
    executor = Executor()
    
    # Mock model router behavior
    mock_async_it = AsyncMock()
    mock_async_it.__aiter__.return_value = ["Test response"]
    executor.model_router.complete = MagicMock(return_value=mock_async_it)
    
    request = ChatRequest(
        session_id="test-session",
        messages=[ChatMessage(role="user", content="Please research the current status of the project and fix the issues in the file.py")],
        model="ollama/qwen2.5:1.5b",
        editRequest=DocumentEditRequest(
            documentId="file.py",
            selectedText="old code",
            contextBefore="",
            contextAfter="",
            action="REWRITE",
            instruction="Make it better"
        )
    )
    
    with patch("src.executor.TOOL_REGISTRY") as mock_registry:
        mock_registry.get_schemas.return_value = [{"name": "fake_tool"}]
        
        # Run executor
        chunks = []
        try:
            async for chunk in executor.execute(request):
                chunks.append(chunk)
        except Exception as e:
            pytest.fail(f"Executor failed with {e}")
            
    # Verify the system prompt sent to the model
    call_args = executor.model_router.complete.call_args
    if call_args is None:
        pytest.fail(f"model_router.complete was never called. Chunks: {chunks}")
    passed_messages = call_args[0][0]
    
    system_msg = next((m for m in passed_messages if m["role"] == "system"), None)
    assert system_msg is not None
    assert "DOCUMENT EDIT MODE ACTIVE" in system_msg["content"]
    assert "Selected Text: \"old code\"" in system_msg["content"]

@pytest.mark.asyncio
async def test_executor_tool_prompt_injection():
    executor = Executor()
    
    mock_async_it = AsyncMock()
    mock_async_it.__aiter__.return_value = ["Test data"]
    executor.model_router.complete = MagicMock(return_value=mock_async_it)
    
    request = ChatRequest(
        session_id="test-session",
        messages=[ChatMessage(role="user", content="Can you please search for the latest cricket scores and IPL weather updates?")],
        model="ollama/qwen2.5:1.5b"
    )
    
    with patch("src.executor.TOOL_REGISTRY") as mock_registry:
        mock_registry.get_schemas.return_value = [{"name": "fake_tool"}]
        
        chunks = []
        try:
            async for chunk in executor.execute(request):
                chunks.append(chunk)
        except Exception as e:
            pytest.fail(f"Executor failed with {e}")
            
    call_args = executor.model_router.complete.call_args
    if call_args is None:
        pytest.fail(f"model_router.complete was never called. Chunks: {chunks}")
    passed_messages = call_args[0][0]
    
    system_msg = next((m for m in passed_messages if m["role"] == "system"), None)
    assert system_msg is not None
    assert "You must use tools" in system_msg["content"]
    assert "<tool_code>" in system_msg["content"]
