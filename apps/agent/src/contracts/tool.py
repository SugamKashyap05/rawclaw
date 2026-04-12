"""
Tool contracts — Pydantic models for tool execution.

These contracts are mirrored in packages/shared/src/contracts/tool.ts
"""
from datetime import datetime
from pydantic import BaseModel
from typing import Any, Dict, List, Literal, Optional


class ToolCall(BaseModel):
    """Represents a tool call requested by the model."""
    tool_name: str
    input: Dict[str, Any]


class ToolResult(BaseModel):
    """Represents the result of a tool execution."""
    tool_name: str
    input: Dict[str, Any]
    output: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: float
    sandboxed: bool = False
    source_url: Optional[str] = None
    provenance_hint: Optional[Dict[str, Any]] = None


class ToolSchema(BaseModel):
    """Describes a tool's capabilities for the planner."""
    name: str
    description: str
    parameters: Dict[str, Any]
    capability_tags: List[str]
    requires_sandbox: bool
    requires_confirmation: bool


class ToolHealthStatus(BaseModel):
    """Per-tool health status for the /tools/health endpoint."""
    name: str
    status: Literal["ok", "degraded", "unavailable"]
    reason: Optional[str] = None
    last_checked: Optional[datetime] = None


class ToolInfo(BaseModel):
    """
    Complete tool information including health status.
    Used for API responses listing tools.
    """
    name: str
    description: str
    parameters: Dict[str, Any]
    capability_tags: List[str]
    requires_confirmation: bool
    requires_sandbox: bool
    health_status: ToolHealthStatus


class MCPConnectionResult(BaseModel):
    """Result of an MCP gateway connection attempt."""
    connected: bool
    profiles: List[str] = []
    servers: List[str] = []
    error: Optional[str] = None


class MCPToolInfo(BaseModel):
    """Information about a tool discovered from an MCP server."""
    server_id: str
    server_name: str
    tool_name: str
    description: str
    input_schema: Dict[str, Any]