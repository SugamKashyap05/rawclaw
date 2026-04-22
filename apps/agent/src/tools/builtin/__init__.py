"""
Built-in tools package.

All built-in tools are registered into the global TOOL_REGISTRY on import.
"""
from src.tools.registry import TOOL_REGISTRY
from src.tools.builtin.datetime_tool import DateTimeTool
from src.tools.builtin.search_web import DuckDuckGoSearchTool
from src.tools.builtin.smart_web_search import SmartWebSearchTool
from src.tools.builtin.web_fetch import WebFetchTool
from src.tools.builtin.read_file import ReadFileTool
from src.tools.builtin.smart_search import SmartSearchTool
from src.tools.builtin.shell_execute import ShellExecuteTool
from src.tools.builtin.list_dir import ListDirTool
from src.tools.builtin.sequential_thinking import SequentialThinkingTool


def register_builtin_tools() -> None:
    """Register all built-in tools into the global registry."""
    TOOL_REGISTRY.register(DateTimeTool())
    TOOL_REGISTRY.register(DuckDuckGoSearchTool())
    TOOL_REGISTRY.register(SmartWebSearchTool())
    TOOL_REGISTRY.register(WebFetchTool())
    TOOL_REGISTRY.register(ReadFileTool())
    TOOL_REGISTRY.register(SmartSearchTool())
    TOOL_REGISTRY.register(ShellExecuteTool())
    TOOL_REGISTRY.register(ListDirTool())
    TOOL_REGISTRY.register(SequentialThinkingTool())


# Auto-register on import
register_builtin_tools()

__all__ = [
    "DateTimeTool",
    "DuckDuckGoSearchTool",
    "SmartWebSearchTool",
    "WebFetchTool",
    "ReadFileTool",
    "SmartSearchTool",
    "ShellExecuteTool",
    "ListDirTool",
    "SequentialThinkingTool",
    "register_builtin_tools",
]