"""
SkillLoader — Discovers and wraps OpenClaw SKILL.md files as RawClaw tools.

Loads skills from the SKILLS_DIR directory. Each SKILL.md file is parsed
for name, description, and capabilities from YAML frontmatter, then wrapped
as a BaseTool for registry.

Compatible with the OpenClaw skill format:
  ---
  name: skill-name
  description: What the skill does
  ---
  # Instructions...
"""
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.skills")

DEFAULT_SKILLS_DIR = os.getenv("SKILLS_DIR", "./skills")


class SkillTool(BaseTool):
    """
    A tool wrapping a SKILL.md file. The skill's instructions are injected
    into the system prompt for LLM-driven execution.
    """

    def __init__(
        self,
        skill_name: str,
        skill_description: str,
        instructions: str,
        capability_tags: List[str],
        skill_path: str,
    ) -> None:
        self.name = f"skill_{skill_name}"
        self.description = skill_description
        self.parameters = {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The specific task to accomplish using this skill.",
                }
            },
            "required": ["task"],
        }
        self.capability_tags = capability_tags
        self.requires_sandbox = False
        self.requires_confirmation = False
        self._instructions = instructions
        self._skill_path = skill_path

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        """
        Returns the skill instructions for the LLM to follow.
        The agent loop injects these into the system prompt for the next turn.
        """
        import time

        start = time.time()
        return ToolResult(
            tool_name=self.name,
            input=input,
            output={
                "instructions": self._instructions,
                "task": input.get("task", ""),
                "skill_path": self._skill_path,
            },
            duration_ms=round((time.time() - start) * 1000, 2),
        )


def _parse_skill_md(filepath: Path) -> Optional[Dict[str, Any]]:
    """
    Parse a SKILL.md file. Expects YAML frontmatter between --- markers,
    followed by markdown instructions.
    """
    try:
        content = filepath.read_text(encoding="utf-8")
        if not content.startswith("---"):
            logger.warning(f"Skill {filepath} missing YAML frontmatter, skipping")
            return None

        parts = content.split("---", 2)
        if len(parts) < 3:
            logger.warning(f"Skill {filepath} has malformed frontmatter, skipping")
            return None

        frontmatter = yaml.safe_load(parts[1])
        if not isinstance(frontmatter, dict):
            logger.warning(f"Skill {filepath} frontmatter is not a dict, skipping")
            return None

        instructions = parts[2].strip()

        return {
            "name": frontmatter.get("name", filepath.parent.name),
            "description": frontmatter.get("description", ""),
            "instructions": instructions,
            "tags": frontmatter.get("tags", []),
            "path": str(filepath),
        }
    except Exception as e:
        logger.error(f"Failed to parse skill {filepath}: {e}")
        return None


class SkillLoader:
    """Discovers and loads SKILL.md files from the skills directory."""

    def __init__(self, skills_dir: str = DEFAULT_SKILLS_DIR) -> None:
        self.skills_dir = Path(skills_dir)
        self._skills: List[SkillTool] = []

    def discover(self) -> List[SkillTool]:
        """
        Scan the skills directory for SKILL.md files and create SkillTool
        instances for each valid skill found.
        """
        self._skills.clear()

        if not self.skills_dir.exists():
            logger.info(f"Skills directory {self.skills_dir} does not exist, skipping skill loading")
            return []

        skill_files = list(self.skills_dir.rglob("SKILL.md"))
        logger.info(f"Found {len(skill_files)} SKILL.md files in {self.skills_dir}")

        for skill_path in skill_files:
            parsed = _parse_skill_md(skill_path)
            if parsed is None:
                continue

            tool = SkillTool(
                skill_name=parsed["name"],
                skill_description=parsed["description"],
                instructions=parsed["instructions"],
                capability_tags=parsed.get("tags", ["skill"]),
                skill_path=parsed["path"],
            )
            self._skills.append(tool)
            logger.info(f"Loaded skill: {tool.name}")

        return self._skills

    @property
    def count(self) -> int:
        return len(self._skills)
