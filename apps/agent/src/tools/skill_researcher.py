import logging
import os
import shutil
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Optional

import yaml

logger = logging.getLogger("rawclaw.skills.research")

AGENT_ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = Path(os.getenv("SKILLS_RESEARCH_DIR", str(AGENT_ROOT / "skills_research"))).resolve()
ACTIVE_SKILLS_DIR = Path(os.getenv("SKILLS_DIR", str(AGENT_ROOT / "skills"))).resolve()

class SkillResearcher:
    """
    Manages the lifecycle of discovering, cloning, and building AI agent skills.
    Skills are first staged in the RESEARCH_DIR before being installed into ACTIVE_SKILLS_DIR.
    """

    def __init__(self):
        # Ensure directories exist
        self.research_dir = RESEARCH_DIR
        self.active_skills_dir = ACTIVE_SKILLS_DIR
        RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
        ACTIVE_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    async def clone_repository(self, repo_url: str) -> Dict[str, Any]:
        """
        Clones a GitHub repository into the research directory.
        """
        try:
            # Extract repo name from URL
            repo_name = repo_url.rstrip("/").split("/")[-1]
            if repo_name.endswith(".git"):
                repo_name = repo_name[:-4]

            target_dir = RESEARCH_DIR / repo_name

            if target_dir.exists():
                return {"success": False, "error": f"Repository {repo_name} already exists in research directory."}

            logger.info(f"Cloning {repo_url} into {target_dir}")
            
            process = await asyncio.create_subprocess_exec(
                "git", "clone", repo_url, str(target_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                logger.info(f"Successfully cloned {repo_url}")
                return {"success": True, "path": str(target_dir), "repo_name": repo_name}
            else:
                error_msg = stderr.decode().strip()
                logger.error(f"Failed to clone {repo_url}: {error_msg}")
                return {"success": False, "error": error_msg}
                
        except Exception as e:
            logger.error(f"Exception while cloning repository: {e}")
            return {"success": False, "error": str(e)}

    def list_researched_skills(self) -> List[Dict[str, Any]]:
        """
        Scans the research directory for SKILL.md files and returns their metadata.
        """
        skills = []
        if not RESEARCH_DIR.exists():
            return skills

        skill_files = list(RESEARCH_DIR.rglob("SKILL.md"))
        
        for skill_path in skill_files:
            parsed = self._parse_skill_md(skill_path)
            if parsed:
                # Also check if it's already installed
                installed_path = ACTIVE_SKILLS_DIR / skill_path.parent.name
                parsed["is_installed"] = installed_path.exists()
                skills.append(parsed)
                
        return skills

    def _install_skill_dir(self, source_path: Path) -> Dict[str, Any]:
        if not source_path.exists():
            return {"success": False, "error": "Source skill directory does not exist."}

        skill_name = source_path.name
        target_path = ACTIVE_SKILLS_DIR / skill_name

        try:
            if target_path.exists():
                logger.warning(f"Overwriting existing skill at {target_path}")
                shutil.rmtree(target_path)

            shutil.copytree(source_path, target_path)
            logger.info(f"Successfully installed skill {skill_name} to {target_path}")
            return {"success": True, "installed_path": str(target_path), "skill_name": skill_name}
        except Exception as e:
            logger.error(f"Failed to install skill {skill_name}: {e}")
            return {"success": False, "error": str(e)}

    def install_skill(self, source_path_str: str) -> Dict[str, Any]:
        """
        Installs a single skill directory or, if given a repo root, installs all nested skills.
        """
        source_path = Path(source_path_str)
        if not source_path.exists():
            return {"success": False, "error": "Source skill directory does not exist."}

        if (source_path / "SKILL.md").exists():
            return self._install_skill_dir(source_path)

        skill_dirs = sorted({path.parent for path in source_path.rglob("SKILL.md")})
        if not skill_dirs:
            return {"success": False, "error": "No SKILL.md files found under the provided source path."}

        installed = []
        failures = []
        for skill_dir in skill_dirs:
            result = self._install_skill_dir(skill_dir)
            if result.get("success"):
                installed.append({
                    "skill_name": result.get("skill_name"),
                    "installed_path": result.get("installed_path"),
                })
            else:
                failures.append({
                    "source_path": str(skill_dir),
                    "error": result.get("error", "Unknown error"),
                })

        return {
            "success": len(installed) > 0 and len(failures) == 0,
            "partial": bool(installed) and bool(failures),
            "installed": installed,
            "failures": failures,
            "installed_count": len(installed),
        }

    def build_skill(self, name: str, description: str, tags: List[str], instructions: str) -> Dict[str, Any]:
        """
        Creates a new skill directly in the active skills directory using the Skill Builder.
        """
        try:
            # Create a safe folder name
            safe_name = "".join(c if c.isalnum() else "-" for c in name).lower()
            target_dir = ACTIVE_SKILLS_DIR / safe_name
            
            target_dir.mkdir(parents=True, exist_ok=True)
            
            skill_md_path = target_dir / "SKILL.md"
            
            frontmatter = {
                "name": safe_name,
                "description": description,
                "tags": tags
            }
            
            content = f"---\n{yaml.dump(frontmatter, sort_keys=False)}---\n\n{instructions}"
            
            skill_md_path.write_text(content, encoding="utf-8")
            
            logger.info(f"Successfully built new skill '{safe_name}' at {skill_md_path}")
            return {"success": True, "installed_path": str(target_dir), "skill_name": safe_name}
            
        except Exception as e:
            logger.error(f"Failed to build skill {name}: {e}")
            return {"success": False, "error": str(e)}

    def _parse_skill_md(self, filepath: Path) -> Optional[Dict[str, Any]]:
        """
        Parse a SKILL.md file to extract its frontmatter metadata.
        """
        try:
            content = filepath.read_text(encoding="utf-8")
            if not content.startswith("---"):
                return None

            parts = content.split("---", 2)
            if len(parts) < 3:
                return None

            frontmatter = yaml.safe_load(parts[1])
            if not isinstance(frontmatter, dict):
                return None

            # Determine repo origin if possible (immediate parent directory of the skill might be inside a repo)
            # Find the root repository directory inside skills_research
            repo_name = "unknown"
            current = filepath.parent
            while current != RESEARCH_DIR and current.parent != RESEARCH_DIR and current.name:
                current = current.parent
            if current.parent == RESEARCH_DIR:
                repo_name = current.name

            return {
                "name": frontmatter.get("name", filepath.parent.name),
                "description": frontmatter.get("description", ""),
                "tags": frontmatter.get("tags", []),
                "source_path": str(filepath.parent),
                "repo": repo_name,
                "repo_root": str(current),
            }
        except Exception as e:
            logger.warning(f"Failed to parse research skill {filepath}: {e}")
            return None
