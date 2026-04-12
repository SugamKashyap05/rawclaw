# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Run all apps in dev mode
npm run build        # Build all apps (topological order via Turborepo)
npm run lint         # Lint all apps
npm run test         # Run tests
npm run check-types  # Type check all apps
```

**Per-app commands:**
- `apps/web`: `vite`, `tsc && vite build`, `eslint .`
- `apps/api`: `ts-node-dev --respawn`, `prisma generate && tsc`
- `apps/agent`: `python -m src.main`, `ruff check src`, `pytest`, `mypy src`
- `apps/desktop`: `tauri dev`, `tauri build`, `cargo clippy`, `cargo test`

**Desktop build requires web build first** (configured in turbo.json).

## Ports

- API: 3000
- Agent: 8000
- Web (Vite dev): 5173

## Architecture

Monorepo with four apps:

```
apps/
├── web/        # React + Vite frontend
├── api/        # NestJS platform API (Prisma + SQLite + Redis)
├── agent/      # FastAPI agent engine (Python)
└── desktop/    # Tauri 2 desktop shell (Rust)
packages/
└── shared/     # TypeScript contracts (ChatMessage, ToolCall, Task, etc.)
```

**Communication model:**
- Web → API only (never talks to agent directly)
- API ↔ Agent via internal REST
- Both backends use Redis for pub/sub and queuing

**Shared contracts in `packages/shared`**: ChatMessage, ChatRequest, ChatResponse, ToolCall, ToolResult, ToolSchema, Task definitions. Use these types when crossing app boundaries.

## Standards

- TypeScript strict mode
- Python lint + typecheck (ruff + mypy)
- Small files, focused modules
- Architecture changes must update `docs/`
- No temp, cache, or test artifacts in source folders

## Environment Setup

1. Node.js 20+, Python 3.11+, Rust
2. Copy `.env.example` to `.env`
3. Key env vars: `API_PORT`, `AGENT_PORT`, `DATABASE_URL`, `REDIS_URL`, model provider keys

## Development Workflow

User works via Antigravity agent (step-by-step prompt execution). Provide prompts that can be run independently; user will execute and report back.

## Project Status

Between Phase 1 (Monorepo skeleton) and Phase 2 (Chat MVP). See `docs/11-roadmap.md` for phase details.