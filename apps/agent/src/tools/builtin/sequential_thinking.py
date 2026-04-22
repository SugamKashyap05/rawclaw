"""
SequentialThinkingTool — A detailed tool for dynamic and reflective problem-solving through thoughts.

This tool helps the model break down complex problems into steps, maintain state across 
multiple reasoning turns, and verify hypotheses.
"""
import time as _time
from typing import Any, Dict, Optional
from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult

class SequentialThinkingTool(BaseTool):
    name = "sequential_thinking"
    description = (
        "A detailed tool for dynamic and reflective problem-solving through thoughts. "
        "Allows you to adjust total_thoughts up or down as you progress, explore alternative "
        "approaches, and maintain a clear reasoning chain."
    )
    parameters = {
        "type": "object",
        "properties": {
            "thought": {
                "type": "string",
                "description": "Your current analytical step or revision."
            },
            "thoughtNumber": {
                "type": "integer",
                "description": "Current number in sequence (1-indexed)."
            },
            "totalThoughts": {
                "type": "integer",
                "description": "Estimated total thoughts needed (can be adjusted)."
            },
            "nextThoughtNeeded": {
                "type": "boolean",
                "description": "True if you need more thinking steps after this one."
            },
            "isRevision": {
                "type": "boolean",
                "description": "Whether this thought revises or builds on a specific previous thought.",
                "default": False
            },
            "revisesThought": {
                "type": "integer",
                "description": "If is_revision is true, which thought number is being reconsidered."
            },
            "branchFromThought": {
                "type": "integer",
                "description": "If branching, which thought number is the branching point."
            },
            "branchId": {
                "type": "string",
                "description": "Branch identifier (if any)."
            }
        },
        "required": ["thought", "thoughtNumber", "totalThoughts", "nextThoughtNeeded"]
    }
    capability_tags = ["utility", "logic", "reasoning"]
    requires_sandbox = False
    requires_confirmation = False

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start = _time.time()
        # The main purpose of this tool is to allow the model to structure its own reasoning.
        # From the execution perspective, it simply acknowledges the thought.
        try:
            thought_num = input.get("thoughtNumber")
            total = input.get("totalThoughts")
            next_needed = input.get("nextThoughtNeeded")
            
            output = {
                "status": "thought_acknowledged",
                "sequential_id": thought_num,
                "progress": f"{thought_num}/{total}",
                "continues": next_needed
            }
            
            return ToolResult(
                tool_name=self.name,
                input=input,
                output=output,
                duration_ms=round((_time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        except Exception as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Sequential thinking error: {str(e)}",
                duration_ms=round((_time.time() - start) * 1000, 2),
                sandboxed=False,
            )
