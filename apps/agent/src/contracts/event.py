from pydantic import BaseModel, Field
from typing import Union, Literal, Any
from src.contracts.tool import ToolCall, ToolResult

class MessageDeltaEvent(BaseModel):
    type: Literal['message_delta'] = 'message_delta'
    content: str

class ToolStartEvent(BaseModel):
    type: Literal['tool_start'] = 'tool_start'
    tool: ToolCall

class ToolConfirmationNeededEvent(BaseModel):
    type: Literal['tool_confirmation_needed'] = 'tool_confirmation_needed'
    confirmation_id: str
    tool_name: str
    tool_input: dict

class ToolEndEvent(BaseModel):
    type: Literal['tool_end'] = 'tool_end'
    result: ToolResult

class TaskCompleteEvent(BaseModel):
    type: Literal['task_complete'] = 'task_complete'
    output: str

class ErrorEvent(BaseModel):
    type: Literal['error'] = 'error'
    message: str

# Union type leveraging discriminator for ease of parsing if needed
AgentEvent = Union[
    MessageDeltaEvent,
    ToolStartEvent,
    ToolConfirmationNeededEvent,
    ToolEndEvent,
    TaskCompleteEvent,
    ErrorEvent
]
