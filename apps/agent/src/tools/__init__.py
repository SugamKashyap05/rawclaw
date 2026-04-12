"""
RawClaw Tools Package.

Provides the BaseTool interface, ToolRegistry singleton,
and all built-in tool implementations.
"""
from src.tools.base_tool import BaseTool
from src.tools.registry import ToolRegistry

# Global registry singleton
registry = ToolRegistry()

__all__ = ["BaseTool", "ToolRegistry", "registry"]
