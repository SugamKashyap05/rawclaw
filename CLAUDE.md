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
- `apps/api`: `ts-node-dev --respawn`, `prisma generate && tsc`, `prisma:migrate`
- `apps/agent`: `python -m src.main`, `ruff check src`, `pytest`, `mypy src`
- `apps/desktop`: `tauri dev`, `tauri build`, `cargo clippy`, `cargo test`
- `packages/shared`: `tsc`

**Desktop build requires web build first** (configured in turbo.json).

**Individual test/lint commands:**
```bash
# Test specific apps
npm run test -- --filter=@rawclaw/web
npm run test -- --filter=@rawclaw/api
npm run test -- --filter=@rawclaw/agent
npm run test -- --filter=@rawclaw/desktop

# Lint specific apps  
npm run lint -- --filter=@rawclaw/web
npm run lint -- --filter=@rawclaw/api
npm run lint -- --filter=@rawclaw/agent
npm run lint -- --filter=@rawclaw/desktop
```

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
- API ↔ Agent via internal REST (ports 3000 ↔ 8000)
- Both backends use Redis for pub/sub and queuing

**Agent internals (apps/agent/src/):**
- `tools/registry.py` — Tool registration and health checks; auto-registers built-in tools on import
- `executor.py` — Execution loop with confirmation gates and provenance tracking
- `tools/mcp_gateway.py` — MCP server connections (SSE transport, Docker-backed)
- `models/router.py` — Multi-provider model routing (Anthropic, Ollama, etc.)

**Tool confirmation flow:**
- Tools marked `requires_confirmation=true` in their schema trigger a confirmation gate
- The API surfaces the confirmation request to the web UI via Redis pub/sub
- User approves/denies via the tool-confirmation controller
- Execution resumes or aborts based on the user's decision

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

**Required services:**
- Redis (for pub/sub and queuing)
- SQLite database (automatically created via Prisma)
- ChromaDB (for semantic memory and RAG)
- Optional: Docker (for MCP gateway support)
- Optional: Ollama (local LLM fallback)

**Python dependencies for agent:**
```bash
cd apps/agent
pip install -r requirements.txt  # or use uv/poetry if configured
```

## Development Workflow

User works via Antigravity agent (step-by-step prompt execution). Provide prompts that can be run independently; user will execute and report back.

**Key development patterns:**
- Changes to shared types require rebuilding the shared package first
- API and Agent communicate via internal REST (ports 3000 ↔ 8000)
- Web app only communicates with API (never directly with Agent)
- Use Redis for inter-process communication and state sharing

## Testing Strategy

**Current test status (Phase 1-2):**
- Web: Browser tests deferred to Phase 3
- API: Unit tests deferred to Phase 3  
- Agent: Python tests available via `pytest`
- Desktop: Rust tests available via `cargo test`

**Test commands:**
```bash
# Run all tests
npm run test

# Run specific app tests
cd apps/agent && pytest
cd apps/desktop && cargo test
```

## Project Status

Between Phase 1 (Monorepo skeleton) and Phase 2 (Chat MVP). See `docs/11-roadmap.md` for phase details.

**Current capabilities:**
- ✅ Monorepo structure with Turborepo
- ✅ Basic app skeletons (Web, API, Agent, Desktop)
- ✅ Shared TypeScript contracts
- ✅ Agent tool registry and MCP gateway support
- ✅ Basic health endpoints
- 🚧 Chat MVP implementation
- 🚧 Task execution system
- 🚧 Memory and RAG systems

**Key files for understanding architecture:**
- `docs/02-architecture.md` - Overall system architecture
- `docs/03-monorepo-structure.md` - Package structure and responsibilities
- `docs/04-core-systems.md` - Core system implementations
- `docs/05-data-and-memory.md` - Memory and RAG systems
- `docs/06-mcp-and-tools.md` - MCP and tool system details
- `docs/07-tasks-and-agents.md` - Task execution and agent internals
- `apps/agent/src/main.py` - Agent entry point with tool registration
- `packages/shared/src/*` - Shared TypeScript contracts