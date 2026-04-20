"""
Built-in tools package.

All built-in tools are registered into the global TOOL_REGISTRY on import.
"""
from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.datetime_tool import DateTimeTool
from src.tools.builtin.search_web import SearchWebTool
from src.tools.builtin.web_fetch import WebFetchTool
from src.tools.builtin.read_file import ReadFileTool
from src.tools.builtin.smart_search import SmartSearchTool


def register_builtin_tools() -> None:
    """Register all built-in tools into the global registry."""
    TOOL_REGISTRY.register(DateTimeTool())
    TOOL_REGISTRY.register(SearchWebTool())
    TOOL_REGISTRY.register(WebFetchTool())
    TOOL_REGISTRY.register(ReadFileTool())
    TOOL_REGISTRY.register(SmartSearchTool())


# Auto-register on import
register_builtin_tools()

__all__ = [
    "DateTimeTool",
    "SearchWebTool",
    "WebFetchTool",
    "ReadFileTool",
    "SmartSearchTool",
    "register_builtin_tools",
]