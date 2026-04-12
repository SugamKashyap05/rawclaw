"""
BaseTool — Abstract base class for all RawClaw tools.

Every tool (built-in, SKILL.md-wrapped, MCP-proxied) must inherit from
BaseTool and implement execute(). The contract guarantees:
  - Unique `name` across the registry
  - JSON Schema `parameters` for LLM function-calling
  - `capability_tags` for tag-based lookup by the planner
  - `requires_sandbox` / `requires_confirmation` flags for security
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from src.contracts.tool import ToolResult, ToolSchema


class BaseTool(ABC):
    """Abstract base for all RawClaw tools."""

    # --- Required overrides ---
    name: str = ""
    description: str = ""
    parameters: Dict[str, Any] = {}

    # --- Optional overrides ---
    capability_tags: List[str] = []
    requires_sandbox: bool = False
    requires_confirmation: bool = False

    @abstractmethod
    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        """Execute the tool with the given input. Must return a ToolResult."""
        ...

    def get_schema(self) -> Dict[str, Any]:
        """Returns an OpenAI-compatible function schema for LLM tool-calling."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def to_tool_schema(self) -> ToolSchema:
        """Returns a ToolSchema contract object describing this tool."""
        return ToolSchema(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
            capability_tags=self.capability_tags,
            requires_sandbox=self.requires_sandbox,
            requires_confirmation=self.requires_confirmation,
        )

    async def health_check(self) -> str:
        """
        Optional health check. Override for tools that depend on external
        services (e.g., search APIs, MCP servers).
        Returns: 'ok', 'degraded', or 'unavailable'
        """
        return "ok"

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} name={self.name!r} tags={self.capability_tags}>"
