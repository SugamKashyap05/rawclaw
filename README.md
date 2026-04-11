# RawClaw Rebuild Workspace

This repository is the documentation-first rebuild foundation for RawClaw.

RawClaw is being rebuilt as a secure, local-first AI agent platform with:
- a desktop shell
- a web UI
- a platform API
- an agent engine
- MCP tool support
- task runs with provenance
- memory and RAG
- sandboxed execution

## Current state

The original codebase was lost, so this repository is now the rebuild starting point. The first priority is to restore structure, safety, and documentation before implementation begins again.

## What to read first

- [Rebuild Overview](E:\2026 final projects\rawclaw\docs\00-rebuild-overview.md)
- [Product Vision](E:\2026 final projects\rawclaw\docs\01-product-vision.md)
- [Architecture](E:\2026 final projects\rawclaw\docs\02-architecture.md)
- [Roadmap](E:\2026 final projects\rawclaw\docs\11-roadmap.md)
- [OpenClaw Gap Analysis](E:\2026 final projects\rawclaw\docs\12-openclaw-gap-analysis.md)

## Documentation map

The `docs/` folder contains the source of truth for rebuilding RawClaw:

- `00-rebuild-overview.md`
- `01-product-vision.md`
- `02-architecture.md`
- `03-monorepo-structure.md`
- `04-core-systems.md`
- `05-data-and-memory.md`
- `06-mcp-and-tools.md`
- `07-tasks-and-agents.md`
- `08-development-workflow.md`
- `09-testing-and-quality.md`
- `10-ops-backup-recovery.md`
- `11-roadmap.md`
- `12-openclaw-gap-analysis.md`

## Rebuild principles

- Safety first: remote git and backup strategy from day one
- Local-first: great offline/local workflows by default
- Tool-verified outputs: avoid guessing on freshness-sensitive tasks
- Provenance by default: task runs should explain what happened
- Isolation by design: task workspaces and execution should be scoped
- Documentation-first: architecture and decisions stay ahead of implementation

## Immediate next steps

1. Recreate the monorepo scaffold
2. Add remote git and CI immediately
3. Build the core app skeleton
4. Restore chat, tools, tasks, and memory in phases
