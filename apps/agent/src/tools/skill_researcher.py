import logging
import os
import shutil
import asyncio
import json
from pathlib import Path
from typing import List, Dict, Any, Optional

import yaml

logger = logging.getLogger("rawclaw.skills.research")

AGENT_ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = Path(os.getenv("SKILLS_RESEARCH_DIR", str(AGENT_ROOT / "skills_research"))).resolve()
ACTIVE_SKILLS_DIR = Path(os.getenv("SKILLS_DIR", str(AGENT_ROOT / "skills"))).resolve()
ACTIVE_PLUGIN_IMPORTS_DIR = Path(os.getenv("PLUGINS_DIR", str(AGENT_ROOT / "plugins"))).resolve()

PLUGIN_MANIFESTS = {
    "codex": ".codex-plugin/plugin.json",
    "claude": ".claude-plugin/plugin.json",
    "cursor": ".cursor-plugin/plugin.json",
}

MARKETPLACE_MANIFESTS = {
    "claude": ".claude-plugin/marketplace.json",
}

PLUGIN_SUPPORT_NAMES = {
    ".codex-plugin",
    ".claude-plugin",
    ".cursor-plugin",
    ".opencode",
    "skills",
    "agents",
    "commands",
    "hooks",
    "assets",
    "scripts",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "gemini-extension.json",
    "package.json",
}

class SkillResearcher:
    """
    Manages the lifecycle of discovering, cloning, and building AI agent skills.
    Skills are first staged in the RESEARCH_DIR before being installed into ACTIVE_SKILLS_DIR.
    """

    def __init__(self):
        # Ensure directories exist
        self.research_dir = RESEARCH_DIR
        self.active_skills_dir = ACTIVE_SKILLS_DIR
        self.active_plugins_dir = ACTIVE_PLUGIN_IMPORTS_DIR
        RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
        ACTIVE_SKILLS_DIR.mkdir(parents=True, exist_ok=True)
        ACTIVE_PLUGIN_IMPORTS_DIR.mkdir(parents=True, exist_ok=True)

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
        Scans the research directory for SKILL.md files and recognized plugin bundles.
        """
        skills = []
        if not RESEARCH_DIR.exists():
            return skills

        repo_cache: Dict[Path, Dict[str, Any]] = {}
        skill_files = list(RESEARCH_DIR.rglob("SKILL.md"))
        skill_repo_roots = set()
        
        for skill_path in skill_files:
            parsed = self._parse_skill_md(skill_path)
            if parsed:
                repo_root = Path(parsed["repo_root"])
                skill_repo_roots.add(repo_root)
                repo_context = repo_cache.setdefault(repo_root, self._build_repo_context(repo_root))
                # Also check if it's already installed
                installed_path = ACTIVE_SKILLS_DIR / skill_path.parent.name
                parsed["is_installed"] = installed_path.exists()
                parsed["plugin_bundle_installed"] = repo_context["plugin_bundle_installed"]
                parsed["plugin_systems"] = repo_context["plugin_systems"]
                parsed["marketplaces"] = repo_context["marketplaces"]
                parsed["agent_templates"] = repo_context["agent_templates"]
                parsed["compatibility"] = self._assess_skill_compatibility(skill_path, parsed)
                skills.append(parsed)

        for repo_root in (sorted(RESEARCH_DIR.iterdir(), key=lambda path: path.name) if RESEARCH_DIR.exists() else []):
            if not repo_root.is_dir() or repo_root in skill_repo_roots:
                continue
            repo_context = repo_cache.setdefault(repo_root, self._build_repo_context(repo_root))
            if repo_context["plugin_systems"] or repo_context["marketplaces"] or repo_context["agent_templates"]:
                skills.append({
                    "kind": "plugin_bundle",
                    "name": repo_root.name,
                    "description": repo_context["description"],
                    "tags": [],
                    "source_path": str(repo_root),
                    "repo": repo_root.name,
                    "repo_root": str(repo_root),
                    "is_installed": False,
                    "plugin_bundle_installed": repo_context["plugin_bundle_installed"],
                    "plugin_systems": repo_context["plugin_systems"],
                    "marketplaces": repo_context["marketplaces"],
                    "agent_templates": repo_context["agent_templates"],
                    "compatibility": repo_context["compatibility"],
                })

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

    def _install_plugin_bundle(self, repo_root: Path) -> Dict[str, Any]:
        plugin_systems = self._collect_plugin_metadata(repo_root)
        if not plugin_systems:
            return {"success": False, "error": "No supported plugin manifests were found under the provided source path."}

        target_root = self.active_plugins_dir / repo_root.name
        try:
            if target_root.exists():
                shutil.rmtree(target_root)
            target_root.mkdir(parents=True, exist_ok=True)

            for child in repo_root.iterdir():
                if child.name not in PLUGIN_SUPPORT_NAMES:
                    continue
                destination = target_root / child.name
                if child.is_dir():
                    shutil.copytree(child, destination, dirs_exist_ok=True)
                else:
                    shutil.copy2(child, destination)

            logger.info(f"Installed plugin bundle {repo_root.name} to {target_root}")
            return {
                "success": True,
                "bundle_name": repo_root.name,
                "installed_path": str(target_root),
                "platforms": [plugin["platform"] for plugin in plugin_systems],
            }
        except Exception as e:
            logger.error(f"Failed to install plugin bundle {repo_root.name}: {e}")
            return {"success": False, "error": str(e)}

    def install_skill(self, source_path_str: str) -> Dict[str, Any]:
        """
        Installs a single skill directory or, if given a repo root, installs all nested skills
        and any supported plugin bundles discovered alongside them.
        """
        source_path = Path(source_path_str)
        if not source_path.exists():
            return {"success": False, "error": "Source skill directory does not exist."}

        repo_root = self._find_repo_root(source_path) or source_path
        repo_context = self._build_repo_context(repo_root)

        if (source_path / "SKILL.md").exists():
            result = self._install_skill_dir(source_path)
            result["compatibility"] = self._assess_skill_compatibility(source_path / "SKILL.md", self._parse_skill_md(source_path / "SKILL.md") or {})
            result["plugin_systems"] = repo_context["plugin_systems"]
            result["marketplaces"] = repo_context["marketplaces"]
            result["agent_templates"] = repo_context["agent_templates"]
            result["repo_root"] = str(repo_root)
            return result

        skill_dirs = sorted({path.parent for path in source_path.rglob("SKILL.md")})
        plugin_result = self._install_plugin_bundle(repo_root) if repo_context["plugin_systems"] else None

        if not skill_dirs and not plugin_result:
            return {"success": False, "error": "No installable SKILL.md files or supported plugin manifests were found under the provided source path."}

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

        compatibility = []
        for skill_dir in skill_dirs:
            parsed = self._parse_skill_md(skill_dir / "SKILL.md")
            if parsed:
                compatibility.append({
                    "name": parsed["name"],
                    **self._assess_skill_compatibility(skill_dir / "SKILL.md", parsed),
                })

        success = (len(installed) > 0 and len(failures) == 0) or bool(plugin_result and plugin_result.get("success") and not failures)
        return {
            "success": success,
            "partial": bool(installed) and bool(failures),
            "installed": installed,
            "failures": failures,
            "installed_count": len(installed),
            "plugin_bundle": plugin_result,
            "plugin_systems": repo_context["plugin_systems"],
            "marketplaces": repo_context["marketplaces"],
            "agent_templates": repo_context["agent_templates"],
            "compatibility": compatibility or [repo_context["compatibility"]],
            "repo_root": str(repo_root),
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
                "kind": "skill",
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

    def _find_repo_root(self, path: Path) -> Optional[Path]:
        current = path if path.is_dir() else path.parent
        while current != RESEARCH_DIR and current.parent != RESEARCH_DIR and current.name:
            current = current.parent
        if current.parent == RESEARCH_DIR:
            return current
        return None

    def _build_repo_context(self, repo_root: Path) -> Dict[str, Any]:
        plugin_systems = self._collect_plugin_metadata(repo_root)
        marketplaces = self._collect_marketplace_metadata(repo_root)
        agent_templates = self._collect_agent_templates(repo_root)
        bundle_installed = (self.active_plugins_dir / repo_root.name).exists()
        description = ""
        if plugin_systems:
            description = plugin_systems[0].get("description") or plugin_systems[0].get("short_description") or ""
        compatibility = self._assess_repo_compatibility(plugin_systems, marketplaces, agent_templates)
        return {
            "plugin_systems": plugin_systems,
            "marketplaces": marketplaces,
            "agent_templates": agent_templates,
            "plugin_bundle_installed": bundle_installed,
            "description": description,
            "compatibility": compatibility,
        }

    def _collect_plugin_metadata(self, repo_root: Path) -> List[Dict[str, Any]]:
        plugin_systems: List[Dict[str, Any]] = []
        for platform, relative_manifest in PLUGIN_MANIFESTS.items():
            manifest_path = repo_root / relative_manifest
            if not manifest_path.exists():
                continue
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to parse plugin manifest {manifest_path}: {e}")
                continue
            plugin_systems.append({
                "platform": platform,
                "manifest_path": str(manifest_path),
                "name": manifest.get("name", repo_root.name),
                "version": manifest.get("version"),
                "description": manifest.get("description", ""),
                "repository": manifest.get("repository"),
                "homepage": manifest.get("homepage"),
                "skills_path": manifest.get("skills"),
                "agents_path": manifest.get("agents"),
                "commands_path": manifest.get("commands"),
                "hooks_path": manifest.get("hooks"),
                "keywords": manifest.get("keywords", []),
                "interface": manifest.get("interface", {}),
                "is_installed": (self.active_plugins_dir / repo_root.name).exists(),
            })
        return plugin_systems

    def _collect_marketplace_metadata(self, repo_root: Path) -> List[Dict[str, Any]]:
        marketplaces: List[Dict[str, Any]] = []
        for platform, relative_manifest in MARKETPLACE_MANIFESTS.items():
            manifest_path = repo_root / relative_manifest
            if not manifest_path.exists():
                continue
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to parse marketplace manifest {manifest_path}: {e}")
                continue
            plugins = manifest.get("plugins") if isinstance(manifest.get("plugins"), list) else []
            marketplaces.append({
                "platform": platform,
                "manifest_path": str(manifest_path),
                "name": manifest.get("name", repo_root.name),
                "description": manifest.get("description", ""),
                "owner": manifest.get("owner") or manifest.get("author"),
                "plugin_count": len(plugins),
                "plugins": plugins,
            })
        return marketplaces

    def _collect_agent_templates(self, repo_root: Path) -> List[Dict[str, Any]]:
        templates: List[Dict[str, Any]] = []
        agents_dir = repo_root / "agents"
        if not agents_dir.exists():
            return templates

        for path in agents_dir.glob("*.md"):
            parsed = self._parse_agent_template(path)
            if parsed:
                templates.append(parsed)
        return templates

    def _parse_agent_template(self, filepath: Path) -> Optional[Dict[str, Any]]:
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
            model = frontmatter.get("model")
            return {
                "name": frontmatter.get("name", filepath.stem),
                "description": frontmatter.get("description", ""),
                "systemPrompt": parts[2].strip(),
                "modelId": None if model in (None, "", "inherit") else model,
                "source_path": str(filepath),
            }
        except Exception as e:
            logger.warning(f"Failed to parse agent template {filepath}: {e}")
            return None

    def _assess_skill_compatibility(self, skill_path: Path, parsed: Dict[str, Any]) -> Dict[str, Any]:
        try:
            content = skill_path.read_text(encoding="utf-8").lower()
        except Exception:
            content = ""

        score = 100
        reasons: List[str] = []

        if not parsed.get("name"):
            score -= 35
            reasons.append("Missing explicit skill name in frontmatter.")
        if not parsed.get("description"):
            score -= 25
            reasons.append("Missing skill description in frontmatter.")

        host_specific_signals = [
            ("claude_plugin_root", "References Claude-specific plugin paths."),
            ("cursor_plugin_root", "References Cursor-specific plugin paths."),
            ("/plugin install", "Uses external plugin marketplace commands."),
            (".claude-plugin", "Contains Claude plugin specific references."),
            (".cursor-plugin", "Contains Cursor plugin specific references."),
            (".opencode", "Contains OpenCode-specific plugin references."),
            ("copilot plugin", "Contains GitHub Copilot plugin references."),
        ]
        for needle, reason in host_specific_signals:
            if needle in content:
                score -= 12
                reasons.append(reason)

        if len(content.strip()) < 120:
            score -= 15
            reasons.append("Skill instructions are very short and may be underspecified for RawClaw.")

        status = "compatible"
        if score < 50:
            status = "incompatible"
        elif reasons:
            status = "partial"

        return {
            "status": status,
            "score": max(0, min(score, 100)),
            "reasons": reasons,
        }

    def _assess_repo_compatibility(
        self,
        plugin_systems: List[Dict[str, Any]],
        marketplaces: List[Dict[str, Any]],
        agent_templates: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if plugin_systems or marketplaces or agent_templates:
            reasons = []
            if plugin_systems:
                reasons.append("Plugin manifests can be imported and preserved by RawClaw.")
            if marketplaces:
                reasons.append("Marketplace metadata can be read and surfaced in the Skills UI.")
            if agent_templates:
                reasons.append("Agent templates can be converted into RawClaw agent profiles.")
            return {
                "status": "partial",
                "score": 78,
                "reasons": reasons,
            }
        return {
            "status": "compatible",
            "score": 100,
            "reasons": [],
        }
