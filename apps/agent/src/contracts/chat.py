"""
Chat contracts — Pydantic models for chat requests and responses.

These contracts are mirrored in packages/shared/src/contracts/chat.ts
"""
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

from src.contracts.tool import ToolCall


class ChatAttachment(BaseModel):
    filename: str
    content: str
    type: Optional[str] = None
    size: Optional[int] = None

class ChatMessage(BaseModel):
    """A single message in a chat conversation."""
    role: Literal['user', 'assistant', 'system', 'tool']
    content: str
    name: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    tool_result: Optional[Dict[str, Any]] = None
    attachments: Optional[List[ChatAttachment]] = None


class DocumentSelection(BaseModel):
    documentId: str
    text: str
    contextBefore: str
    contextAfter: str

class DocumentEditRequest(BaseModel):
    documentId: str
    selectedText: str
    contextBefore: str
    contextAfter: str
    action: str
    instruction: Optional[str] = None

class ChatRequest(BaseModel):
    """Request payload for initiating a chat completion."""
    session_id: str
    messages: List[ChatMessage]
    model: Optional[str] = None
    complexity: Optional[str] = None
    tools: Optional[List[str]] = None
    stream: Optional[bool] = False
    workspace_id: Optional[str] = "default"
    sender_identifier: Optional[str] = "local"
    agent_id: Optional[str] = None
    # P2 Parameters
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    selection: Optional[DocumentSelection] = None
    editRequest: Optional[DocumentEditRequest] = None


class ModelMetadata(BaseModel):
    """Metadata about the model used for execution."""
    modelId: str
    isLocal: bool
    fallbacks: Optional[List[str]] = None
    memoryRecall: Optional[bool] = None
    durationMs: Optional[int] = None

class ChatResponse(BaseModel):
    """Response payload mapping the result of a chat execution."""
    response: str
    tool_calls: List[ToolCall] = []
    sources: List[str] = []
    provenance_trace: Optional[Dict[str, Any]] = None
    metadata: Optional[ModelMetadata] = None
