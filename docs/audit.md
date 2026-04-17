# RawClaw Codebase Audit

**Date:** 2026-04-15  
**Auditor:** Claude Code (Antigravity-compatible)

---

## HEALTH SUMMARY

| Component | Score | Notes |
|---|---|---|
| Monorepo structure | **PARTIAL** | Turborepo pipeline correct, but `apps/agent/pyproject.toml` references non-existent `services/ai-core` path |
| Gateway (NestJS) | **5/10** | Controllers + services exist, properly wired to agent via configurable URL. Missing: auth, WebSocket, test files, DTO validation |
| AI Core (FastAPI) | **4/10** | Real tool registry, executor, SSE streaming. Missing: LangGraph, ChromaDB, Redis, cost routing, proper streaming tool call detection |
| Web UI (React) | **7/10** | Full chat UI with real SSE streaming, 5 pages with substantive implementations. Missing: settings page, error boundaries, global store |
| Desktop (Tauri) | **3/10** | Minimal shell loading web app via Vite proxy. No Tauri commands, no native capabilities, `web/dist` missing |
| Test suite | **0/0** | 0 test files exist across the entire monorepo |
| Integration seams | **2/8 wired** | NestJS→Agent HTTP ✅, ToolRegistry→Executor ✅. All others missing or untested |

---

## CRITICAL BLOCKERS

1. **`apps/agent/pyproject.toml`** references path `services/ai-core` which does not exist — AI core lives at `apps/agent`
2. **`pythonjsonlogger`** imported in `main.py:64` but absent from `requirements.txt` — broken dependency
3. **`web/dist` does not exist** — Desktop production builds will fail; Tauri references `../../web/dist`
4. **No LangGraph** — Agent loop is direct `ModelRouter → TOOL_REGISTRY`, no graph state, no checkpointer, no memory persistence
5. **`AnthropicProvider.complete()` streaming gap** — `pass` at line 50 leaves the streaming `tool_use` handler empty; tool calls not yielded in real time during streaming, only at message completion
6. **No ChromaDB** — Document memory planned but absent; no `chromadb` in `requirements.txt`
7. **No authentication** — NestJS has no `JwtStrategy`, no `AuthGuard`, no `PassportModule`
8. **`MCPController.connect` is a stub** — accepts `url` in POST body but ignores it entirely

---

## SECTION 1 — Monorepo & Tooling

### Turborepo Pipeline (`turbo.json`)

```json
{ "build", "test", "lint", "check-types", "dev", "@rawclaw/desktop#build" }
```

Desktop build correctly depends on `^build` + `@rawclaw/web#build`. ✅

### Workspace Packages (`package.json`)

```json
"workspaces": ["apps/*", "packages/*"]
```

`apps/` and `packages/` correctly registered. ✅

### Circular Dependency Risk

None detected. Dependency graph is acyclic.

### `.env.example` — Crash Risk Analysis

| Variable | Default | Crash if absent? |
|---|---|---|
| `API_URL` | none | **YES** — throws at `configuration.ts:4` |
| `DATABASE_URL` | none | **YES** — throws at `configuration.ts:8` |
| `REDIS_URL` | none | **YES** — throws at `configuration.ts:13` |
| `AGENT_URL` | none | **YES** — throws at `configuration.ts:3` |
| `JWT_SECRET` | `PLEASE_CHANGE_ME...` | No (dangerous default) |
| `ENCRYPTION_KEY` | `32-CHAR-HEX-KEY...` | No (dangerous default) |
| `BRAVE_API_KEY` | empty | No (search falls back to DuckDuckGo) |

### Docker Compose / Dockerfile

Neither exists anywhere in the repo.

### Config Issues

- `apps/agent/pyproject.toml` — `services/ai-core` path reference is wrong (should be `apps/agent`)
- `apps/agent/main.py:64` — `pythonjsonlogger` imported but not in `requirements.txt` ⚠️ **BROKEN IMPORT**

---

## SECTION 2 — NestJS Gateway

### Modules in `AppModule`

`ConfigModule`, `HttpModule`, `ToolsModule`, `MCPModule`, `TasksModule` — all implemented ✅

### All Endpoints

| Controller | Route | Endpoints |
|---|---|---|
| `ChatController` | `/chat` | `POST /send`, `GET /sessions`, `GET /sessions/:id`, `GET /models` |
| `HealthController` | `/health` | `GET /` |
| `AppController` | `/health-v2` | `GET /` |
| `ToolConfirmationController` | `/tools/confirm` | `POST /request`, `GET /:id`, `GET /?sessionId=`, `POST /:id/approve`, `POST /:id/deny` |
| `ModelsController` | `/models` | `GET /`, `POST /preferences`, `DELETE /preferences/:id` |
| `TasksController` | `/tasks` | `POST /`, `GET /`, `GET /runs`, `GET /runs/recent`, `GET /:id`, `DELETE /:id`, `POST /:id/run`, `GET /runs/:runId`, `DELETE /runs/:runId`, `POST /runs/:runId/update`, `GET /runs/:runId/artifact` |
| `ToolsController` | `/tools` | `GET /`, `GET /info`, `GET /health`, `GET /:name` |
| `MCPController` | `/mcp` | `GET /servers`, `GET /health`, `POST /connect` |

### DTO Validation

`CreateTaskDto` and `UpdateTaskRunDto` validated with `class-validator`. All other endpoints have no DTO class — **no validation** on `ChatRequest`, `ToolConfirmationController` bodies, `MCPController.connect`, `ModelsController.preferences`.

### JWT Auth

**NOT WIRED.** No `JwtStrategy`, `AuthGuard`, `PassportModule`, or `JwtModule` anywhere. All endpoints publicly accessible.

### Middleware

None registered in `configure()`.

### WebSocket

None.

### Agent HTTP Calls

All go through `${agentUrl}` (from `ConfigService.get('agentUrl')`) ✅ — URL configurable, throws at startup if absent. Endpoints: `POST /execute`, `GET /api/models`, `GET /health`, `POST /execute/task`, all tool/MCP proxied endpoints.

### ToolRegistry in Gateway

**Does NOT exist.** `ToolsService` and `MCPController` are pure HTTP proxies to the agent.

### MCP Bridge

`MCPModule` + `MCPController` exist ✅ but **`POST /connect` is a stub** — it accepts `{ url?: string }` in the body but ignores it completely; the actual MCP connection logic lives only in the agent's `MCPGateway`.

### Skill Loader

Not present in API.

### Stubs/TODOs

- `apps/api/src/tasks/schedule.service.ts:21` — `onModuleInit` logs `"In Phase 7, we would register this with a real scheduler"` instead of scheduling
- `apps/api/src/tasks/schedule.service.ts:47` — `lastRunStatus: 'stub'` always placeholder
- `apps/api/src/mcp/mcp.controller.ts:38` — `connectServer` does not actually connect; body param ignored

### Test Files

None (0 `.spec.ts` files in entire API).

---

## SECTION 3 — FastAPI AI Core

### Routers

**No routers** — all 10 endpoints are flat on the FastAPI `app` instance. No `include_router()` calls.

### All Endpoints

| Path | Method | Handler | State |
|---|---|---|---|
| `/health` | GET | `health_check` | ✅ Implemented |
| `/api/models` | GET | `list_models` | ✅ Implemented |
| `/api/tools` | GET | `list_tools` | ✅ Implemented |
| `/api/tools/info` | GET | `list_tools_info` | ✅ Implemented |
| `/api/tools/health` | GET | `tools_health` | ✅ Implemented |
| `/api/tools/{tool_name}` | GET | `get_tool` | ✅ Implemented |
| `/execute` | POST | `execute_chat` | ✅ Implemented (streaming) |
| `/execute/task` | POST | `execute_task` | ✅ Implemented |
| `/api/mcp/servers` | GET | `list_mcp_servers` | ✅ Implemented |
| `/api/mcp/health` | GET | `mcp_health` | ✅ Implemented |

### LangGraph

**NOT INSTALLED.** `requirements.txt`:
```
fastapi==0.104.1
uvicorn==0.24.0.post1
pydantic==2.5.2
```
No `langgraph`, `langchain`, `chromadb`, or `redis` packages.

### Agent Loop Architecture

```
HTTP /execute → Executor.execute() → ModelRouter.complete()
                                           ↓ (yields str or dict deltas)
                                 tool_call dict → _execute_tool_with_confirmation()
                                           ↓
                                 TOOL_REGISTRY.get() → tool.execute()
                                           ↓
                                 NDJSON StreamingResponse
```

Direct loop, NOT a LangGraph. Works for single-turn tool execution but:
- No conversation memory across requests
- No checkpointer
- No graph-based planning nodes
- No state persistence

### DuckDuckGoSearchTool

**Does NOT exist as a class.** The search tool is `SearchWebTool` (`apps/agent/src/tools/builtin/search_web.py`) with `name: "web_search"`. DuckDuckGo is used as a fallback inside `_duckduckgo_search()`.

### ChromaDB

Not installed. Not configured. No collection, no embedding model, no `add_documents`/`query`.

### Redis

Not used in agent. `ConfirmationGate` uses **plain HTTP polling** to the NestJS API at `http://localhost:3000` — not Redis pub/sub.

### ToolRegistry (`TOOL_REGISTRY`)

Full implementation at `apps/agent/src/tools/registry.py`. All methods complete: `register()`, `get()`, `list_tools()`, `get_schemas()`, `health_check_all()`, `execute_tool()`.

### Built-in Tools

| Tool | File | Status |
|---|---|---|
| `DateTimeTool` | `datetime_tool.py` | ✅ Fully implemented |
| `SearchWebTool` (`web_search`) | `search_web.py` | ✅ Brave primary, DuckDuckGo fallback |
| `WebFetchTool` (`web_fetch`) | `web_fetch.py` | ✅ Implemented |
| `ReadFileTool` (`read_file`) | `read_file.py` | ✅ Sandbox + confirmation required |
| `MCPToolWrapper` | `mcp_tool_wrapper.py` | ✅ Wraps MCP tools as BaseTool |
| `SkillTool` | `skill_loader.py` | ✅ SKILL.md wrapper |

All complete — no stubs.

### MCPTool

`MCPToolWrapper` at `apps/agent/src/tools/mcp_tool_wrapper.py` ✅. MCP tools ARE registered in `TOOL_REGISTRY` in `main.py` lifespan handler ✅. However, MCP gateway only loads if `MCP_SERVERS_CONFIG` env var is set to a file path or `DOCKER_MCP_URL` is set.

### Model Cost Routing

Not present. `ModelRouter` selects by `complexity` only (`low`/`medium`/`high` → `DEFAULT_LOW/MEDIUM/HIGH_MODEL`). No token counting, no price lookup.

### TODOs / Stubs

- No TODOs in execution path ✅
- **No `NotImplementedError`** anywhere ✅
- `pass` statements only in abstract stubs and exception class bodies ✅

### AnthropicProvider Streaming Gap

`apps/agent/src/models/providers/anthropic.py:50` — the streaming `tool_use` handler body is `pass` (empty). Tool calls are only captured at `final_msg` processing. During streaming, the executor will NOT see tool call chunks until the full message completes. This breaks real-time tool call display in the UI.

### Missing from `requirements.txt`

- `pythonjsonlogger` (imported in `main.py:64` but not in deps) ⚠️

---

## SECTION 4 — React Web UI

### Routing (React Router v7)

| Route | Component | State |
|---|---|---|
| `/` | `Dashboard` | **Full UI** — health checks via axios, 10s polling |
| `/chat` | `Chat` | **Full UI** — SSE streaming via fetch, tool results, provenance |
| `/tools` | `Tools` | **Full UI** — tool registry, MCP gateway panel |
| `/tasks` | `Tasks` | **Full UI** — task matrix, run logs sidebar, 5s polling |
| `/models` | `Models` | **Full UI** — model inventory, favorites |

**No settings page.** No route, no component.

### Chat Interface

Real SSE via `fetch('/api/chat/send')` with `ReadableStream.getReader()`. Handles `content`, `tool_result`, `provenance`, `done`, `error`. ✅ NOT mock data.

### State Management

Pure component-local `useState`. No Zustand/Redux/Jotai/Context. `selectedModel` lives in `App.tsx` and is passed down as props.

### API Client

Raw `fetch` in `Chat.tsx`, `axios` in `App.tsx`. Vite proxy rewrites `/api → localhost:3000` and `/agent → localhost:8000`. No `.env` file in `apps/web`.

### Error Boundaries

**None.** `main.tsx` renders directly into `#root` with no try/catch. Component crash = white screen.

### Dead Code

- `apps/web/src/components/ToolCard.tsx` — defined but **never imported or used anywhere**
- `apps/web/src/pages/Tasks.css` — 1 comment line only, empty file

---

## SECTION 5 — Tauri Desktop Shell

### Bundle Config

`identifier = "com.rawclaw.dev"`, `productName = "rawclaw"`, `version = "0.1.0"` ✅ all consistent.

### Rust Tauri Commands

Zero `#[tauri::command]` functions. `main.rs` is bare bones with no native functionality.

### No Frontend Source

`apps/desktop/src/` does not exist. No `invoke()` calls possible.

### Native Capabilities

```json
["core:path:default", "core:event:default", "core:window:default",
 "core:app:default", "core:resources:default"]
```
**MISSING:** No `fs`, `shell`, `notification`, `clipboard`, `process`, or `http` permissions.

### Window

`800×600`, `resizable: true`, `decorations` defaults to OS native frame. No `center`.

### Desktop Loads Web App

Dev `http://localhost:5173` (Vite), Prod `../../web/dist`. **`web/dist` does not exist** — production Tauri build will fail.

---

## SECTION 6 — Shared Packages

### `packages/shared` Exports

All contracts fully defined (chat, tool, task, provenance, health, event). `RAWCLAW_VERSION = '0.1.0'`.

### Type Consistency Issues

| Issue | Location | Severity |
|---|---|---|
| Local `ToolCall` duplicate | `apps/api/src/chat.service.ts:6` — not imported from shared | Medium |
| `SessionWithMessages` not exported from shared | `apps/api/src/chat.service.ts:26` — app-specific | Low |
| `last_checked` type mismatch | Python `datetime`, TS `string` | Medium runtime risk |
| `AgentTaskDefinition`, `TaskExecutionRequest`, `TaskResult` missing from TS | Python has, TS doesn't | High |
| `ModelInfo`/`ChatStreamChunk` missing from Python | TS has, Python doesn't | Low |
| `ToolsListResponse`, `MCPServersResponse` not in shared | `apps/api/src/tools/tools.service.ts` | Low |

### `packages/ui`

**DOES NOT EXIST** — was planned but never generated.

---

## SECTION 7 — Tests

### Test Files Found: 0

| App | Command | Result |
|---|---|---|
| `apps/agent` | `pytest` | `'pytest' is not recognized` |
| `apps/api` | `echo 'Unit tests deferred to Phase 3'` | Placeholder |
| `apps/web` | `echo 'Browser tests deferred to Phase 3'` | Placeholder |
| `apps/desktop` | `cargo test` | 0 tests (no `#[test]` functions) |
| `packages/shared` | `echo 'TEST SHARED'` | Placeholder |

All test infrastructure is placeholder.

---

## SECTION 8 — Integration Seams

| Seam | Status | Evidence |
|---|---|---|
| NestJS → FastAPI HTTP | **WIRED** ✅ | `chat.controller.ts:40` → `POST ${agentUrl}/execute` with streaming; retry logic present |
| LangGraph tool binding | **MISSING** ❌ | LangGraph not installed; direct `ModelRouter.complete()` loop |
| Skill → Agent wiring | **UNTESTED** ❌ | `SkillLoader` + `SkillTool` exist but no skill files loaded |
| MCP → Agent bridge | **PARTIAL** ⚠️ | `MCPGateway` + `wrap_mcp_tools()` exist ✅; only loads if `MCP_SERVERS_CONFIG` or `DOCKER_MCP_URL` set |
| WebSocket → Agent stream | **PARTIAL** ⚠️ | SSE over HTTP (not WebSocket); Chat.tsx streaming works ✅ |
| ChromaDB → Agent memory | **MISSING** ❌ | ChromaDB not installed; no collection; no `add_documents`/`query` |
| Redis → Session state | **MISSING** ❌ | RedisService exists in API but agent uses HTTP polling instead |
| Tauri → Web bridge | **UNTESTED** ❌ | No Tauri commands defined; no `invoke()` calls |

---

## SECTION 9 — MISSING SYSTEMS

```
MISSING: LangGraph Agentic Core
  Referenced in: docs/02-architecture.md, executor.py comments, pyproject.toml
  Required by: Planning loop, tool binding, checkpointer, multi-turn memory
  Priority: HIGH
  Estimated generation effort: medium

MISSING: ChromaDB Vector Memory
  Referenced in: docs/05-data-and-memory.md, .env.example (CHROMA_SERVER_*)
  Required by: Semantic memory retrieval between turns, RAG
  Priority: HIGH
  Estimated generation effort: medium

MISSING: JWT Authentication
  Referenced in: .env.example (JWT_SECRET), docs/02-architecture.md (trust/pairing)
  Required by: Securing all API endpoints; future OAuth/pairing flows
  Priority: HIGH
  Estimated generation effort: small

MISSING: Docker Compose + Dockerfile
  Referenced in: docs/02-architecture.md (Docker for MCP ecosystem)
  Required by: Containerized local dev full-stack
  Priority: MEDIUM
  Estimated generation effort: medium

MISSING: Tauri Native Commands + Capabilities
  Referenced in: tauri.conf.json, docs/02-architecture.md (desktop-native integrations)
  Required by: File system, shell, notifications, clipboard access
  Priority: MEDIUM
  Estimated generation effort: medium

MISSING: Test Files
  Referenced in: pytest.ini exists but no tests/; all package.json test commands are placeholders
  Required by: Verifying all integration seams, regression prevention
  Priority: HIGH
  Estimated generation effort: large

MISSING: web/dist Production Build Artifact
  Referenced in: apps/desktop/src-tauri/tauri.conf.json build.frontendDist
  Required by: Desktop production Tauri builds; tauri build fails without it
  Priority: HIGH
  Estimated generation effort: trivial (run `cd apps/web && npm run build`)

MISSING: pythonjsonlogger in requirements.txt
  Referenced in: apps/agent/src/main.py:64 (import)
  Required by: Agent startup (structured JSON logging)
  Priority: HIGH
  Estimated generation effort: trivial

MISSING: AnthropicProvider streaming tool_use handler
  Referenced in: apps/agent/src/models/providers/anthropic.py:50 (pass)
  Required by: Real-time tool call detection during streaming
  Priority: HIGH
  Estimated generation effort: small

MISSING: TypeScript task contract mirrors
  Referenced in: apps/agent/src/contracts/task.py (AgentTaskDefinition, TaskExecutionRequest, TaskResult)
  Required by: Type-safe agent↔API task execution
  Priority: MEDIUM
  Estimated generation effort: small

MISSING: packages/ui Component Library
  Referenced in: docs/03-monorepo-structure.md
  Required by: Shared UI primitives across web/desktop
  Priority: MEDIUM
  Estimated generation effort: large

MISSING: Settings Page in Web UI
  Referenced in: apps/web/src/App.tsx nav links (none)
  Required by: API URL config, theme, agent configuration
  Priority: LOW
  Estimated generation effort: medium
```

---

## SECTION 10 — GENERATION PLAN

```
PHASE 1.1 — Fix Broken Imports and Build Artifacts
  Goal: Make agent start without import errors and desktop buildable
  Generates:
    - Add pythonjsonlogger to apps/agent/requirements.txt
    - Run `npm run build` for apps/web to create web/dist
    - Fix apps/agent/pyproject.toml path reference (services/ai-core → apps/agent)
  Unblocks: Agent startup, Desktop production builds
  Depends on: Nothing
  Effort: <1 hour

PHASE 1.2 — Fix AnthropicProvider Streaming Gap
  Goal: Enable real-time tool call detection during streaming
  Generates: Implement the empty pass at anthropic.py:50 to yield tool_use chunks during streaming
  Unblocks: Real-time tool call display in Chat UI during streaming
  Depends on: Nothing
  Effort: 1-2 hours

PHASE 2.1 — Implement JWT Authentication
  Goal: Secure all NestJS API endpoints
  Generates: JwtStrategy, AuthGuard, JwtModule, @UseGuards on protected routes
  Unblocks: Production API security, future OAuth flows
  Depends on: Nothing
  Effort: 2-3 hours

PHASE 2.2 — Add ChromaDB Vector Memory
  Goal: Enable semantic memory retrieval between chat turns
  Generates: chromadb in requirements.txt, collection setup, embedding integration, memory read/write in executor
  Unblocks: RAG-style memory, tool-augmented knowledge recall
  Depends on: Phase 1.1
  Effort: 3-4 hours

PHASE 2.3 — Replace Direct Loop with LangGraph
  Goal: Graph-based agent orchestration with checkpointer and tool binding
  Generates: StateGraph with nodes (llm, tool executor, memory, synthesizer), checkpointer for conversation memory, llm.bind_tools() call
  Unblocks: Planning, multi-step reasoning, memory persistence, checkpoint resume
  Depends on: Phase 2.2 (recommended but not required)
  Effort: 4-6 hours

PHASE 3.1 — Add Tauri Native Commands + Capabilities
  Goal: Give desktop shell real functionality
  Generates: #[tauri::command] functions for fs/shell/notifications, frontend invoke() calls, updated capabilities/default.json with fs+shell+notification
  Unblocks: Desktop file operations, shell commands from UI
  Depends on: Phase 1.1
  Effort: 3-4 hours

PHASE 3.2 — Generate Test Files
  Goal: Verify integration seams and prevent regressions
  Generates: pytest files in apps/agent/tests/, jest tests in apps/api/src/__, playwright tests in apps/web/e2e/, #[test] functions in desktop Rust
  Unblocks: Confidence in all wiring, especially MCP bridge, LangGraph tool binding
  Depends on: Phases 2.x and 3.1
  Effort: 6-8 hours

PHASE 4.1 — Add TypeScript Task Contract Mirrors
  Goal: Complete type-level contract between agent and API for task execution
  Generates: AgentTaskDefinition, TaskExecutionRequest, TaskResult in packages/shared/src/contracts/task.ts
  Unblocks: Type-safe task execution across boundary
  Depends on: Nothing
  Effort: 1-2 hours

PHASE 4.2 — Add Docker Compose + Dockerfile
  Goal: Containerized local dev full-stack
  Generates: docker-compose.yml with Redis, ChromaDB, API, Agent, optional Ollama; Dockerfile per service
  Unblocks: One-command local dev for contributors
  Depends on: Phase 2.3
  Effort: 2-3 hours

PHASE 5 — Generate packages/ui Component Library (Ongoing)
  Goal: Shared design system across web and desktop
  Generates: Reusable React components with Storybook
  Unblocks: Consistent UI, faster feature development
  Depends on: Phase 1.1
  Effort: large (ongoing)
```

---

## BOTTOM LINE

The RawClaw monorepo has **real, working code** in the core execution path — the agent streams NDJSON, the tool registry executes tools, the chat controller retries failed agent requests, and the web UI has a fully styled SSE-powered chat interface with provenance timelines and tool result cards. These are not empty stubs.

What is genuinely absent: the **orchestration layer** (LangGraph, ChromaDB memory, Redis sessions, scheduled tasks), the **security layer** (JWT auth), the **native desktop layer** (Tauri commands and capabilities), and the **test layer** (zero test files).

The gap between "foundation-ready" and "production agent platform" is the Phase 2 LangGraph/ChromaDB work and Phase 3 native desktop integration. Start with Phase 1.1 (fix the broken import and missing `web/dist`) — it's under an hour and unblocks everything else.
