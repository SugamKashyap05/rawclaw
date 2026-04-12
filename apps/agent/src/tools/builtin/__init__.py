"""
Built-in tools package.

All built-in tools are registered into the global TOOL_REGISTRY on import.
"""
from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.datetime_tool import DateTimeTool
from src.tools.builtin.search_web import SearchWebTool
from src.tools.builtin.fetch_url import FetchUrlTool
from src.tools.builtin.read_file import ReadFileTool


def register_builtin_tools() -> None:
    """Register all built-in tools into the global registry."""
    TOOL_REGISTRY.register(DateTimeTool())
    TOOL_REGISTRY.register(SearchWebTool())
    TOOL_REGISTRY.register(FetchUrlTool())
    TOOL_REGISTRY.register(ReadFileTool())


# Auto-register on import
register_builtin_tools()

__all__ = [
    "DateTimeTool",
    "SearchWebTool",
    "FetchUrlTool",
    "ReadFileTool",
    "register_builtin_tools",
]