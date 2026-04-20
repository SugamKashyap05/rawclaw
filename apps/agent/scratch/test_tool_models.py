import sys
import os
from typing import Any, Dict, Optional

# Add src to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.contracts.tool import ToolResult

def test_tool_result():
    print("Testing ToolResult with dictionary input...")
    tr1 = ToolResult(
        tool_name="test_tool",
        input={"key": "value"},
        output="success",
        duration_ms=10.5,
        sandboxed=False
    )
    print(f"TR1: {tr1.model_dump()}")

    print("\nTesting ToolResult with string input...")
    tr2 = ToolResult(
        tool_name="test_tool",
        input="just a string",
        output=123,
        duration_ms=5.0,
        sandboxed=True
    )
    print(f"TR2: {tr2.model_dump()}")

    print("\nTesting ToolResult with list input...")
    tr3 = ToolResult(
        tool_name="test_tool",
        input=["item1", "item2"],
        output={"result": "ok"},
        duration_ms=0.1,
        sandboxed=False
    )
    print(f"TR3: {tr3.model_dump()}")

    print("\nAll tests passed!")

if __name__ == "__main__":
    try:
        test_tool_result()
    except Exception as e:
        print(f"Test failed: {e}")
        sys.exit(1)
