# RawClaw — Generation Prompts for Antigravity
**Run these prompts in order. Do not skip phases. Each phase unblocks the next.**

---

# PHASE 1.1 — Fix Broken Imports & Build Artifacts
**Effort: < 1 hour | Unblocks: Agent startup, Desktop builds**

```
You are working in the RawClaw Turborepo monorepo. This phase fixes three broken dependencies
that prevent the agent from starting and the desktop from building. Make ALL three fixes in
a single pass.

## Fix 1 — Add pythonjsonlogger to requirements.txt

File: apps/agent/requirements.txt

The package `python-json-logger` is imported in `apps/agent/src/main.py` at line 64 as:
  from pythonjsonlogger import jsonlogger

This package is NOT in requirements.txt. Add it:
  python-json-logger==2.0.7

Add it directly after the existing fastapi/uvicorn/pydantic lines. Do not remove or
reorder any existing entries.

## Fix 2 — Correct pyproject.toml path reference

File: apps/agent/pyproject.toml

There is a path reference to `services/ai-core` which does not exist in this repo.
The AI core service lives at `apps/agent/`. Find every occurrence of `services/ai-core`
in this file and replace it with `apps/agent`. If the pyproject.toml defines the package
root, make sure it points to `apps/agent/src` (or wherever `main.py` lives).

## Fix 3 — Build web/dist for Tauri

The Tauri desktop config at `apps/desktop/src-tauri/tauri.conf.json` references
`../../web/dist` as the `build.frontendDist`. This directory does not exist.

Do the following:
1. Open `apps/web/package.json` and verify the build script is `vite build`
2. Verify `apps/web/vite.config.ts` outputs to `dist/` (default for Vite — confirm it is
   not overridden to a different outDir)
3. If the build script and outDir are correct, document the exact command a developer
   must run: `cd apps/web && npm run build`
4. If the outDir is misconfigured (pointing somewhere other than `dist/`), fix it so Vite
   outputs to `apps/web/dist/`
5. Add a note to the root README.md (or create one if missing) that says:
   "Run `pnpm --filter @rawclaw/web build` before running `tauri build` for the first time."

## Verification checklist

After making all changes, confirm:
- [ ] `apps/agent/requirements.txt` contains `python-json-logger==2.0.7`
- [ ] `apps/agent/pyproject.toml` has no reference to `services/ai-core`
- [ ] `apps/web/vite.config.ts` outputs to `dist/` (relative to apps/web)
- [ ] Root README.md documents the web build step

Do not change any other files. Do not refactor any existing code.
```

---

# PHASE 1.2 — Fix AnthropicProvider Streaming Tool Use Handler
**Effort: 1–2 hours | Unblocks: Real-time tool call display in chat UI**

```
You are working in the RawClaw monorepo. This phase fixes a critical streaming bug in the
Anthropic model provider.

## The problem

File: apps/agent/src/models/providers/anthropic.py

At approximately line 50, inside the streaming handler, there is a block that handles
`tool_use` content blocks during streaming. The handler body is `pass` — it does nothing.

This means: during SSE streaming, when Claude returns a tool call, the executor never sees
the tool_use block in real time. It only captures tool calls after the full message
completes (via the `final_msg` processing path). This breaks real-time tool call display
in the Chat UI.

## What you must implement

Read the entire `anthropic.py` provider file carefully. Understand the streaming loop
structure: how text deltas are yielded, how the final_message is assembled.

Then implement the streaming `tool_use` handler as follows:

When a streaming chunk contains a `content_block_start` event with type `tool_use`:
  - Begin accumulating the tool call: store the tool name and id
  - As `content_block_delta` events arrive with `input_json_delta`, accumulate the
    JSON string for the tool inputs

When a `content_block_stop` event arrives for a tool_use block:
  - Parse the accumulated input JSON string into a dict
  - Yield a dict in this exact shape:
    {
      "type": "tool_call",
      "tool_name": "<name of the tool>",
      "tool_call_id": "<id>",
      "tool_input": { ...parsed dict... }
    }

This dict is what the Executor reads to detect a pending tool call during streaming.
Make sure the yielded structure matches exactly what the Executor's streaming loop
checks for (read executor.py to confirm the exact key names it checks).

If the executor loop checks for a different key shape, match whatever the executor
expects — do NOT change the executor. Only change anthropic.py.

## Multiple tool calls in one response

Handle the case where Claude returns multiple tool_use blocks in a single response.
Each tool_use block should yield its own dict when its content_block_stop event fires.

## Preserve existing behavior

Do not change how text deltas are yielded. Do not change the final_message assembly.
Do not change the function signature. Only add the tool_use streaming logic.

## Verification

After implementation, trace through this scenario mentally and confirm it works:
- User sends: "Search the web for the latest AI news"
- Claude's streaming response contains a tool_use block for `web_search`
- The executor should see `{"type": "tool_call", "tool_name": "web_search", ...}`
  BEFORE the full message has completed streaming
- The executor should call the tool and stream the result back

If there are any existing unit tests for the Anthropic provider, run them and
make sure they still pass. If there are no tests, note this.
```

---

# PHASE 2.1 — JWT Authentication for NestJS Gateway
**Effort: 2–3 hours | Unblocks: Production API security, future pairing/OAuth flows**

```
You are working in the RawClaw monorepo. This phase adds JWT authentication to the
NestJS API gateway at apps/api/.

## Context

The API currently has NO authentication. Every endpoint is publicly accessible.
The .env.example already defines `JWT_SECRET` (with a dangerous placeholder default).
The goal is standard JWT bearer token auth: issue a token, verify it on protected routes.

## What to install

In apps/api/package.json, add these dependencies if not already present:
  @nestjs/passport
  @nestjs/jwt
  passport
  passport-jwt
  @types/passport-jwt (devDependency)

Run the install after adding them.

## What to generate

### 1. AuthModule (apps/api/src/auth/)

Create the following files:

**auth.module.ts**
- Import JwtModule.registerAsync() using ConfigService to read JWT_SECRET and
  set expiresIn to '7d'
- Import PassportModule
- Provide JwtStrategy, AuthService
- Export JwtAuthGuard, JwtStrategy, AuthService

**auth.service.ts**
- `generateToken(payload: object): string` — signs and returns a JWT
- `validateToken(token: string): any` — verifies and decodes a JWT
- No database lookup needed in Phase 2.1 — token payload IS the identity

**jwt.strategy.ts**
- Extends PassportStrategy(Strategy, 'jwt')
- Reads JWT_SECRET from ConfigService
- Extracts bearer token from Authorization header
- validate(payload) returns the payload as-is (full trust of signed tokens for now)

**jwt-auth.guard.ts**
- Extends AuthGuard('jwt')
- Standard implementation — no custom logic needed

**auth.controller.ts**
- POST /auth/token
  - Body: { secret: string }
  - If body.secret matches AUTH_SECRET env var, return { access_token: <jwt> }
  - If not, throw UnauthorizedException
  - This is a simple shared-secret bootstrap — not OAuth
  - The JWT payload should be: { sub: 'rawclaw-client', iat: now }

**auth.dto.ts**
- TokenRequestDto: { secret: string } — validated with @IsString()

### 2. Add AUTH_SECRET to .env.example

Add: AUTH_SECRET=CHANGE_THIS_TO_A_STRONG_SECRET

### 3. Apply @UseGuards(JwtAuthGuard) to protected controllers

Apply the guard at the CONTROLLER level (not individual routes) to:
  - ChatController
  - TasksController
  - ToolsController (GET only — not modifying tools, just listing)
  - ModelsController
  - MCPController

Do NOT apply the guard to:
  - HealthController (GET /health must always return 200 — monitoring requirement)
  - AppController (GET /health-v2 same reason)
  - AuthController itself (bootstrapping — must be public)

### 4. Register AuthModule in AppModule

Import AuthModule into AppModule. Make sure ConfigModule is global so JwtModule
can read JWT_SECRET via ConfigService.

### 5. Update the Vite proxy in apps/web

The web app makes API calls via Vite proxy (/api → localhost:3000).
After auth is added, the web app needs to send the JWT in requests.

For now, implement a minimal token bootstrap in apps/web:
- In a new file apps/web/src/lib/auth.ts:
  - On app startup, if no token in sessionStorage, POST /api/auth/token with
    { secret: import.meta.env.VITE_AUTH_SECRET }
  - Store the returned access_token in sessionStorage
  - Export getAuthHeaders(): { Authorization: 'Bearer <token>' }
- Update all fetch/axios calls in Chat.tsx, App.tsx to include getAuthHeaders()
- Add VITE_AUTH_SECRET to apps/web/.env.example (create this file if missing)

## Configuration

Add to apps/api/src/config/configuration.ts:
  authSecret: process.env.AUTH_SECRET,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

## Verification checklist

- [ ] POST /auth/token with correct secret returns { access_token: ... }
- [ ] POST /auth/token with wrong secret returns 401
- [ ] GET /chat/sessions without Authorization header returns 401
- [ ] GET /chat/sessions with valid Authorization: Bearer <token> returns 200
- [ ] GET /health returns 200 with no auth header (monitoring must always work)
- [ ] Web app sends Authorization header on all API requests
```

---

# PHASE 2.2 — ChromaDB Vector Memory
**Effort: 3–4 hours | Unblocks: Semantic memory across turns, RAG, Phase 2.3 LangGraph**

```
You are working in the RawClaw monorepo. This phase adds ChromaDB vector memory to the
FastAPI AI core at apps/agent/.

## What to install

Add to apps/agent/requirements.txt:
  chromadb==0.5.3
  sentence-transformers==3.0.1

Do NOT use openai embeddings — use a local embedding model so the system works offline.
The embedding model to use is: all-MiniLM-L6-v2 (from sentence-transformers)

## Architecture

The memory system has two layers:
1. Short-term: the conversation message list (already exists in executor.py)
2. Long-term: ChromaDB persistent vector store for cross-session semantic recall

## What to generate

### 1. Memory service (apps/agent/src/memory/chroma_memory.py)

Create a `ChromaMemory` class with the following interface:

```python
class ChromaMemory:
    def __init__(self, persist_directory: str, collection_name: str):
        # Initialize ChromaDB PersistentClient
        # Initialize SentenceTransformer embedding model
        # Get or create collection with cosine distance

    def add_message(self, session_id: str, role: str, content: str,
                    metadata: dict = None) -> None:
        # Embed content using SentenceTransformer
        # Add to ChromaDB with metadata: {session_id, role, timestamp, ...metadata}
        # Document ID: f"{session_id}_{timestamp}_{role}"

    def search(self, query: str, session_id: str = None,
               n_results: int = 5) -> list[dict]:
        # Embed query
        # Query ChromaDB, optionally filter by session_id in metadata
        # Return list of {content, role, session_id, timestamp, distance}

    def get_session_history(self, session_id: str,
                            limit: int = 20) -> list[dict]:
        # Get recent messages for a session ordered by timestamp
        # Return list of {role, content, timestamp}

    def clear_session(self, session_id: str) -> None:
        # Delete all documents with metadata.session_id == session_id
```

### 2. Memory configuration

Add to apps/agent/.env.example (create if missing):
  CHROMA_PERSIST_DIR=./data/chroma
  CHROMA_COLLECTION=rawclaw_memory

Add to apps/agent/src/config.py (or wherever env vars are read):
  CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
  CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "rawclaw_memory")

### 3. Initialize ChromaMemory in main.py lifespan

In the FastAPI app lifespan handler (where TOOL_REGISTRY is initialized):
  - Instantiate ChromaMemory(CHROMA_PERSIST_DIR, CHROMA_COLLECTION)
  - Store it in app.state.chroma_memory
  - Log: "ChromaDB memory initialized"

### 4. Wire memory into Executor

In apps/agent/src/executor.py (or wherever the main execute() function lives):

At the START of execute():
  - Get chroma_memory from app.state (or inject via dependency)
  - Retrieve session history: `history = chroma_memory.get_session_history(session_id, limit=10)`
  - Prepend this history to the messages list BEFORE calling ModelRouter
  - If session_id is None, skip memory retrieval

After EACH assistant turn (after the model responds):
  - Store the user message: `chroma_memory.add_message(session_id, "user", user_content)`
  - Store the assistant response: `chroma_memory.add_message(session_id, "assistant", assistant_content)`

After tool execution:
  - Store the tool result as a message with role="tool" and metadata {tool_name: ...}

### 5. Add memory search endpoint

In apps/agent/src/main.py, add a new endpoint:
  GET /api/memory/search?q=<query>&session_id=<optional>&n=<5>
  Returns: { results: [{content, role, session_id, timestamp, distance}] }

### 6. Create data directory

Add apps/agent/data/.gitkeep (empty file) so the chroma persist dir is tracked.
Add apps/agent/data/chroma/ to .gitignore.

## Important constraints

- ChromaDB must use PersistentClient (not EphemeralClient or HttpClient)
- The embedding model (all-MiniLM-L6-v2) downloads ~90MB on first run — add a log
  message: "Loading embedding model (first run may take a moment)..."
- Do not add async to ChromaDB calls — chromadb 0.5.x is synchronous
- If ChromaDB fails to initialize (e.g. missing directory), log a warning and
  continue without memory — do NOT crash the agent

## Verification checklist

- [ ] ChromaDB PersistentClient initializes without error
- [ ] SentenceTransformer model loads (may be slow on first run)
- [ ] add_message() stores a document in the collection
- [ ] search() returns relevant results for a query
- [ ] get_session_history() returns messages in chronological order
- [ ] /api/memory/search endpoint returns JSON results
- [ ] Memory is loaded at start of execute() when session_id is provided
- [ ] Memory is saved after each turn
- [ ] Agent startup does not crash if ChromaDB fails
```

---

# PHASE 2.3 — Replace Direct Loop with LangGraph StateGraph
**Effort: 4–6 hours | Unblocks: Multi-step planning, checkpoint resume, true agent memory**

```
You are working in the RawClaw monorepo. This phase replaces the direct
ModelRouter → ToolRegistry loop in the FastAPI AI core with a LangGraph StateGraph.

## What to install

Add to apps/agent/requirements.txt:
  langgraph==0.2.28
  langchain-core==0.3.15
  langchain-anthropic==0.2.4
  langchain-openai==0.2.9

## Architecture overview

Current flow:
  HTTP /execute → Executor.execute() → ModelRouter.complete() → tool_call → tool.execute()

New flow:
  HTTP /execute → LangGraphExecutor.execute() → StateGraph.stream()
                    └─ node: agent (llm.bind_tools())
                    └─ node: tools (ToolNode)
                    └─ node: memory_write (ChromaDB persist)
                    └─ edge: agent → tools (if tool_calls) | END (if done)
                    └─ checkpointer: SqliteSaver (per-session persistence)

## What to generate

### 1. LangGraph state definition (apps/agent/src/graph/state.py)

```python
from typing import Annotated, Sequence
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

class AgentState(TypedDict):
    messages: Annotated[Sequence, add_messages]
    session_id: str
    model_id: str
    tool_confirmations_pending: list  # tool calls awaiting human approval
    metadata: dict
```

### 2. Tool adapter (apps/agent/src/graph/tool_adapter.py)

LangGraph uses LangChain tool format. Convert existing BaseTool subclasses:

```python
from langchain_core.tools import StructuredTool

def rawclaw_tool_to_langchain(tool: BaseTool) -> StructuredTool:
    """Wrap a RawClaw BaseTool as a LangChain StructuredTool."""
    def _run(**kwargs):
        return tool.execute(kwargs)  # adjust to match BaseTool.execute() signature
    return StructuredTool(
        name=tool.name,
        description=tool.description,
        func=_run,
        args_schema=tool.get_schema(),  # adjust to actual method name
    )

def get_all_langchain_tools() -> list:
    """Convert all registered tools to LangChain format."""
    return [rawclaw_tool_to_langchain(t) for t in TOOL_REGISTRY.list_tools()]
```

Read the existing BaseTool and ToolRegistry to understand their exact APIs before writing this.

### 3. Graph builder (apps/agent/src/graph/builder.py)

```python
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.sqlite import SqliteSaver
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

def build_graph(model_id: str, tools: list, checkpointer) -> CompiledStateGraph:
    """Build and compile the agent StateGraph."""

    # Select LangChain model based on model_id
    # If model_id starts with "claude" → ChatAnthropic
    # If model_id starts with "gpt" or "openai" → ChatOpenAI
    # Use model_id to set the specific model string
    llm = _get_llm(model_id)
    llm_with_tools = llm.bind_tools(tools)

    def agent_node(state: AgentState):
        response = llm_with_tools.invoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state: AgentState):
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    tool_node = ToolNode(tools)

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile(checkpointer=checkpointer)
```

### 4. LangGraph executor (apps/agent/src/graph/executor.py)

Create a new LangGraphExecutor class that:
- Initializes SqliteSaver checkpointer using SQLITE_CHECKPOINTER_PATH env var
  (default: ./data/checkpoints.db)
- On execute(messages, session_id, model_id):
  - Builds the graph (or uses a cached compiled graph per model_id)
  - Creates LangChain message objects from the raw messages list
  - Calls graph.stream() with config={"configurable": {"thread_id": session_id}}
  - Yields streaming chunks in the SAME NDJSON format as the current Executor
    so the NestJS gateway doesn't need any changes:
    {"type": "content", "text": "..."} for text
    {"type": "tool_call", "tool_name": "...", "tool_input": {...}} for tool calls
    {"type": "tool_result", "tool_name": "...", "result": "..."} for tool results
    {"type": "done"} at the end

### 5. Update main.py

In the lifespan handler:
- Initialize SqliteSaver checkpointer
- Store in app.state.checkpointer

In the /execute endpoint:
- Replace `executor.execute()` call with `langgraph_executor.execute()`
- Keep the same StreamingResponse wrapping
- Keep the same NDJSON format

### 6. Tool confirmation integration

The existing system has a ToolConfirmationGate that asks NestJS to approve
sensitive tool calls before executing. This must continue to work.

In the tool_node or in a wrapper around ToolNode:
- Before executing a tool, check if it requires confirmation (read BaseTool
  for the requires_confirmation flag or equivalent)
- If it does, POST to NestJS /tools/confirm/request and poll for approval
  (replicate the existing ConfirmationGate logic)
- If approved, execute the tool
- If denied, return an error message to the graph

### 7. Add to .env.example

  SQLITE_CHECKPOINTER_PATH=./data/checkpoints.db

### 8. Backward compatibility

The old Executor class must NOT be deleted yet. Rename it to `LegacyExecutor`
and keep it in place. Add an env var USE_LANGGRAPH=true that switches between
LegacyExecutor and LangGraphExecutor. Default to USE_LANGGRAPH=false until
the new executor is verified working.

## Verification checklist

- [ ] Graph compiles without error
- [ ] Single-turn chat works: user message → agent response → done
- [ ] Tool call works: user asks for web search → tool_call chunk → tool_result chunk → agent synthesizes → done
- [ ] Multi-turn works: second message in same session_id has access to first turn's messages via checkpointer
- [ ] NDJSON output format is identical to the old Executor (no NestJS changes needed)
- [ ] USE_LANGGRAPH=false falls back to LegacyExecutor cleanly
- [ ] Tool confirmation still fires for tools that require it
```

---

# PHASE 3.1 — Wire MCPController.connect + Fix ScheduleService
**Effort: 2–3 hours | Unblocks: Real MCP server connections, working task scheduling**

```
You are working in the RawClaw monorepo. This phase fixes two stubs in the NestJS gateway.

## Fix 1 — MCPController.connect

### The problem

File: apps/api/src/mcp/mcp.controller.ts

The POST /mcp/connect endpoint accepts { url?: string } in the body but ignores it.
The MCP connection logic lives in the agent's MCPGateway at apps/agent.

### What to implement

The NestJS MCPController should act as a proxy to the agent's MCP endpoints.

1. Add a DTO for the connect request:
   File: apps/api/src/mcp/dto/connect-mcp-server.dto.ts
   Fields:
     url: string (required, IsUrl)
     name: string (optional, IsString)
     transport: 'sse' | 'stdio' | 'http' (optional, default 'sse')

2. Implement connectServer() in mcp.controller.ts:
   - Validate the DTO
   - POST to `${agentUrl}/api/mcp/connect` with the dto as body
   - Forward the agent's response back to the caller
   - Handle errors: if agent returns an error, return a 502 with a clear message

3. In apps/agent/src/main.py, add a POST /api/mcp/connect endpoint:
   - Body: { url: str, name: Optional[str], transport: str = "sse" }
   - Call app.state.mcp_gateway.connect_server(url, name, transport)
   - Return { success: bool, server_name: str, tools_loaded: int }

4. Implement connect_server() in the MCPGateway class:
   Read the existing MCPGateway code carefully to understand its structure.
   The method should:
   - Validate the URL is reachable (GET {url}/health or equivalent)
   - Initialize an MCP client connection to the URL
   - Wrap the MCP server's tools using the existing wrap_mcp_tools() function
   - Register the wrapped tools in TOOL_REGISTRY
   - Return the number of tools successfully loaded

5. Add disconnect endpoint (GET /mcp/servers already exists, add DELETE /mcp/servers/:name):
   NestJS: DELETE /mcp/servers/:name → proxy to agent DELETE /api/mcp/servers/:name
   Agent: removes the server's tools from TOOL_REGISTRY and closes the MCP connection

## Fix 2 — ScheduleService

### The problem

File: apps/api/src/tasks/schedule.service.ts

onModuleInit() logs "In Phase 7, we would register this with a real scheduler"
and returns without scheduling anything.

The service also always returns `lastRunStatus: 'stub'`.

### What to implement

1. Install a cron scheduler in apps/api if not already present:
   Check if @nestjs/schedule is in package.json. If not, add it.
   Install: @nestjs/schedule and add ScheduleModule.forRoot() to AppModule.

2. Rewrite ScheduleService:
   - Inject TasksService (which should already have CRUD methods for tasks)
   - On startup (onModuleInit), load all tasks from the database that have a
     cronExpression defined
   - For each, call this.schedulerRegistry.addCronJob(task.id, cronJob)
   - The cronJob should: call TasksService.executeTask(task.id), log the result,
     update the task's lastRunAt and lastRunStatus fields

3. When a new Task is created via POST /tasks with a cronExpression:
   - The TasksService (or a hook in the controller) should notify ScheduleService
     to register the new cron job immediately

4. When a Task is deleted via DELETE /tasks/:id:
   - ScheduleService should remove its cron job if registered

5. Replace `lastRunStatus: 'stub'` with the actual last run status read from
   the task record in the database.

## Verification checklist

- [ ] POST /mcp/connect with a valid MCP server URL returns { success: true, tools_loaded: N }
- [ ] POST /mcp/connect with an unreachable URL returns a 502 with a clear error
- [ ] Newly connected MCP tools appear in GET /tools
- [ ] DELETE /mcp/servers/:name removes the server and its tools
- [ ] Tasks with a cronExpression run at the scheduled time
- [ ] Creating a task with a cron schedules it immediately (no restart needed)
- [ ] Deleting a task removes its schedule
- [ ] GET /tasks/:id returns the real lastRunStatus, not 'stub'
```

---

# PHASE 3.2 — Tauri Native Commands + Capabilities
**Effort: 3–4 hours | Unblocks: Desktop file ops, shell execution, notifications from UI**

```
You are working in the RawClaw monorepo. This phase gives the Tauri desktop shell
real native capabilities.

## Current state

- apps/desktop/src-tauri/src/main.rs is bare — zero #[tauri::command] functions
- apps/desktop/src/ does not exist — no frontend source at all
- tauri.conf.json capabilities list only core permissions (path, event, window, app, resources)

## Part 1 — Tauri Rust commands

### File: apps/desktop/src-tauri/src/main.rs

Implement these #[tauri::command] functions:

```rust
// 1. Read a file from the filesystem
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

// 2. Write a file to the filesystem
#[tauri::command]
async fn write_file(path: String, contents: String) -> Result<(), String> {
    tokio::fs::write(&path, contents)
        .await
        .map_err(|e| e.to_string())
}

// 3. List directory contents
#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<String>, String> {
    let mut entries = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        names.push(entry.file_name().to_string_lossy().to_string());
    }
    Ok(names)
}

// 4. Execute a shell command (sandboxed — only whitelisted commands)
#[tauri::command]
async fn run_shell(command: String, args: Vec<String>) -> Result<String, String> {
    let allowed = ["echo", "ls", "pwd", "git", "npm", "pnpm", "python3"];
    let cmd = command.split_whitespace().next().unwrap_or("");
    if !allowed.contains(&cmd) {
        return Err(format!("Command '{}' not in allowlist", cmd));
    }
    let output = tokio::process::Command::new(&command)
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// 5. Show a desktop notification
#[tauri::command]
fn show_notification(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show();
}

// 6. Get app version
#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// 7. Open a URL in the default browser
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    tauri::opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}
```

Register all commands in `.invoke_handler(tauri::generate_handler![...])`.

### Cargo.toml additions

Add these dependencies to apps/desktop/src-tauri/Cargo.toml:
  tokio = { version = "1", features = ["full"] }
  tauri-plugin-notification = "2"

### tauri.conf.json — update capabilities

In apps/desktop/src-tauri/capabilities/default.json, add:
  "fs:allow-read-text-file"
  "fs:allow-write-text-file"
  "fs:allow-read-dir"
  "shell:allow-execute" (scoped to allowlist — see above)
  "notification:allow-notify"
  "opener:allow-open-url"

Also update tauri.conf.json window config:
  - width: 1200 (increase from 800)
  - height: 800 (increase from 600)
  - center: true
  - title: "RawClaw"

## Part 2 — Desktop frontend bridge

Create apps/desktop/src/ with the following:

### apps/desktop/src/main.tsx

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
```

### apps/desktop/src/App.tsx

A minimal desktop shell that:
1. Embeds the web app in an <iframe src="http://localhost:5173"> in dev
2. In production, loads from the Vite-built web app
3. Shows a native title bar area above the iframe with:
   - App name "RawClaw"
   - Version (fetched via invoke('get_version'))
   - A notification bell button (calls show_notification for testing)

### apps/desktop/src/lib/tauri-bridge.ts

Export typed wrappers around all tauri commands:

```typescript
import { invoke } from '@tauri-apps/api/core'

export const tauriBridge = {
  readFile: (path: string) => invoke<string>('read_file', { path }),
  writeFile: (path: string, contents: string) => invoke<void>('write_file', { path, contents }),
  listDir: (path: string) => invoke<string[]>('list_dir', { path }),
  runShell: (command: string, args: string[]) => invoke<string>('run_shell', { command, args }),
  showNotification: (title: string, body: string) => invoke<void>('show_notification', { title, body }),
  getVersion: () => invoke<string>('get_version'),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
}
```

### apps/desktop/package.json

If it doesn't have one already, create a package.json that:
- Has name: "@rawclaw/desktop"
- Has @tauri-apps/api as a dependency
- Has scripts: dev, build, tauri:dev, tauri:build

## Verification checklist

- [ ] `cargo build` in apps/desktop/src-tauri completes without errors
- [ ] invoke('get_version') returns the version string from Cargo.toml
- [ ] invoke('read_file', { path: '/tmp/test.txt' }) reads a file
- [ ] invoke('write_file', { path: '/tmp/test.txt', contents: 'hello' }) writes a file
- [ ] invoke('show_notification', ...) shows a desktop notification
- [ ] invoke('run_shell', { command: 'echo', args: ['hello'] }) returns 'hello\n'
- [ ] invoke('run_shell', { command: 'rm', args: ['-rf', '/'] }) returns an error (not in allowlist)
- [ ] Desktop window opens at 1200×800 centered
- [ ] tauriBridge.ts exports compile without TypeScript errors
```

---

# PHASE 4.1 — TypeScript Task Contract Mirrors
**Effort: 1–2 hours | Unblocks: Type-safe task execution across agent↔API boundary**

```
You are working in the RawClaw monorepo. This phase adds missing TypeScript type
definitions to packages/shared so the API and web app have type-safe contracts
for task execution.

## Context

The Python agent has these contracts defined at apps/agent/src/contracts/task.py:
  - AgentTaskDefinition
  - TaskExecutionRequest
  - TaskResult

These do NOT exist in packages/shared/src/. Several other types are also inconsistent
across the Python and TypeScript layers. This phase mirrors the Python types into TS.

## What to generate

### File: packages/shared/src/contracts/task.ts

```typescript
// Mirror of apps/agent/src/contracts/task.py

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AgentTaskDefinition {
  id: string
  name: string
  description: string
  cronExpression?: string       // cron string if scheduled, undefined if one-shot
  prompt: string                // the instruction given to the agent
  model?: string                // override the default model for this task
  tools?: string[]              // tool names this task is allowed to use (undefined = all)
  maxIterations?: number        // safety limit on agent loop iterations
  timeoutSeconds?: number       // overall timeout
  metadata?: Record<string, unknown>
  createdAt: string             // ISO timestamp
  updatedAt: string
}

export interface TaskExecutionRequest {
  taskId: string
  runId: string
  prompt: string
  model?: string
  tools?: string[]
  maxIterations?: number
  timeoutSeconds?: number
  context?: Record<string, unknown>   // extra context injected into the prompt
}

export interface TaskRunLog {
  timestamp: string
  level: 'info' | 'warning' | 'error'
  message: string
  metadata?: Record<string, unknown>
}

export interface TaskResult {
  taskId: string
  runId: string
  status: TaskStatus
  output?: string               // final agent response text
  artifactPath?: string         // path to any file artifact produced
  logs: TaskRunLog[]
  startedAt: string
  completedAt?: string
  errorMessage?: string
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCostUsd?: number
  }
}

export interface TaskRun {
  id: string
  taskId: string
  status: TaskStatus
  startedAt: string
  completedAt?: string
  result?: TaskResult
  triggeredBy: 'manual' | 'cron' | 'webhook'
}
```

### File: packages/shared/src/contracts/index.ts

If this file exists, add exports for the task contracts:
  export * from './task'

If the file doesn't exist, create it and export all contracts from shared.

### Fix type mismatch: last_checked

In packages/shared/src/ wherever HealthStatus or health response types are defined,
the field `last_checked` should be typed as `string` (ISO timestamp string) in TypeScript,
matching the Python side which returns a datetime serialized to ISO format.
Verify this is already the case and fix if not.

### Fix duplicate ToolCall type

In apps/api/src/chat.service.ts, there is a locally defined `ToolCall` type (line 6)
that duplicates or diverges from the one in packages/shared.

Replace the local definition with an import:
  import type { ToolCall } from '@rawclaw/shared'

Make sure the shared ToolCall type has all fields the chat.service.ts version uses.
If the shared version is missing fields, add them to packages/shared first.

### Verification checklist

- [ ] packages/shared exports AgentTaskDefinition, TaskExecutionRequest, TaskResult, TaskRun, TaskRunLog, TaskStatus
- [ ] TypeScript compiles without errors: `pnpm --filter @rawclaw/shared build`
- [ ] apps/api imports TaskResult from @rawclaw/shared instead of defining it locally
- [ ] No duplicate ToolCall type in chat.service.ts
- [ ] All shared type changes are backward compatible (no removed fields)
```

---

# PHASE 4.2 — Docker Compose + Dockerfiles
**Effort: 2–3 hours | Unblocks: One-command local dev, contributor onboarding**

```
You are working in the RawClaw monorepo. This phase adds Docker Compose and Dockerfiles
so the entire stack can be started with a single command.

## Services to containerize

| Service | Source | Port |
|---|---|---|
| redis | image: redis:7-alpine | 6379 |
| chromadb | image: chromadb/chroma:0.5.3 | 8001 |
| agent | apps/agent/ | 8000 |
| api | apps/api/ | 3000 |
| web | apps/web/ | 5173 (dev) / 4173 (preview) |
| ollama | image: ollama/ollama (optional, profile: local-ai) | 11434 |

## docker-compose.yml (root of monorepo)

```yaml
version: '3.9'

services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  chromadb:
    image: chromadb/chroma:0.5.3
    restart: unless-stopped
    ports:
      - "8001:8000"
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
      interval: 5s
      timeout: 3s
      retries: 5

  agent:
    build:
      context: ./apps/agent
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - CHROMA_HOST=chromadb
      - CHROMA_PORT=8000
      - REDIS_URL=redis://redis:6379
    env_file:
      - ./apps/agent/.env
    depends_on:
      redis:
        condition: service_healthy
      chromadb:
        condition: service_healthy
    volumes:
      - ./apps/agent/data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - AGENT_URL=http://agent:8000
      - REDIS_URL=redis://redis:6379
    env_file:
      - ./apps/api/.env
    depends_on:
      agent:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "5173:5173"
    environment:
      - VITE_API_URL=http://api:3000
    depends_on:
      api:
        condition: service_healthy

  ollama:
    image: ollama/ollama
    profiles: ["local-ai"]
    restart: unless-stopped
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

volumes:
  redis_data:
  chroma_data:
  ollama_data:
```

## apps/agent/Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY pyproject.toml .

ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## apps/api/Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

## apps/web/Dockerfile (dev server for now)

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

## .env files

Create apps/agent/.env.example if it doesn't exist. Ensure it has:
  CHROMA_PERSIST_DIR=./data/chroma
  CHROMA_COLLECTION=rawclaw_memory
  CHROMA_HOST=localhost
  CHROMA_PORT=8001
  REDIS_URL=redis://localhost:6379
  SQLITE_CHECKPOINTER_PATH=./data/checkpoints.db
  MCP_SERVERS_CONFIG=
  DOCKER_MCP_URL=
  BRAVE_API_KEY=
  ANTHROPIC_API_KEY=
  OPENAI_API_KEY=

## Root Makefile

Create a Makefile in the repo root with these targets:
  up: docker compose up -d
  down: docker compose down
  logs: docker compose logs -f
  dev: pnpm dev
  build: pnpm build
  agent-shell: docker compose exec agent bash
  api-shell: docker compose exec api sh

## .dockerignore files

Create .dockerignore in apps/agent/:
  __pycache__
  .pytest_cache
  .env
  data/
  *.pyc

Create .dockerignore in apps/api/:
  node_modules
  dist
  .env

## Verification checklist

- [ ] `docker compose up -d` starts redis and chromadb without errors
- [ ] `docker compose up -d agent` starts the agent (may need ANTHROPIC_API_KEY set)
- [ ] `docker compose up -d api` starts the NestJS gateway
- [ ] `docker compose ps` shows all services healthy
- [ ] `docker compose down` stops all services cleanly
- [ ] `docker compose --profile local-ai up -d ollama` starts Ollama
- [ ] Makefile targets work
```

---

# PHASE 5 — Test Suite
**Effort: 6–8 hours | Completes: Full regression coverage across all seams**

```
You are working in the RawClaw monorepo. This phase generates the test suite.
Currently there are ZERO test files across the entire monorepo. This is the most
important phase for production readiness.

## Part 1 — FastAPI agent tests (pytest)

### Setup

Create apps/agent/tests/__init__.py (empty)
Create apps/agent/tests/conftest.py with:
  - TestClient fixture from httpx
  - Mock ChromaMemory fixture (no actual ChromaDB needed in unit tests)
  - Mock TOOL_REGISTRY fixture
  - Sample messages fixture

### Test files to generate

**tests/test_health.py**
  - test_health_returns_200
  - test_health_returns_agent_status_dict

**tests/test_tools.py**
  - test_list_tools_returns_all_registered_tools
  - test_get_tool_by_name_returns_correct_tool
  - test_get_nonexistent_tool_returns_404
  - test_tools_health_returns_status_per_tool

**tests/test_models.py**
  - test_list_models_returns_model_list
  - test_model_list_includes_required_fields (name, id, provider)

**tests/test_execute.py** (most important)
  - test_execute_simple_chat_returns_streaming_response
  - test_execute_yields_content_chunks
  - test_execute_yields_done_chunk_at_end
  - test_execute_with_tool_call_yields_tool_call_chunk
  - test_execute_with_tool_call_yields_tool_result_chunk
  - test_execute_with_invalid_model_returns_400
  - test_execute_stores_messages_in_memory (mock ChromaMemory, assert add_message called)
  - test_execute_loads_session_history (mock ChromaMemory.get_session_history, verify it's prepended)

**tests/test_search_tool.py**
  - test_search_web_tool_name_is_web_search
  - test_search_web_tool_has_description
  - test_search_web_tool_executes_with_duckduckgo_fallback (mock requests)
  - test_search_web_tool_uses_brave_when_api_key_set (mock requests)

**tests/test_tool_registry.py**
  - test_register_and_get_tool
  - test_list_tools_returns_all
  - test_get_nonexistent_tool_returns_none
  - test_execute_tool_calls_correct_tool
  - test_health_check_all_returns_status_per_tool

**tests/test_mcp_gateway.py**
  - test_list_mcp_servers_returns_empty_when_none_configured
  - test_connect_server_registers_tools (mock MCP client)
  - test_disconnect_server_removes_tools (mock)

**tests/test_chroma_memory.py**
  - test_add_message_stores_document
  - test_search_returns_relevant_results
  - test_get_session_history_returns_ordered_messages
  - test_clear_session_removes_all_session_docs
  - test_memory_isolates_between_sessions

**tests/test_anthropic_provider.py**
  - test_streaming_yields_text_chunks
  - test_streaming_yields_tool_call_chunk_when_tool_used (most important — this was broken)
  - test_streaming_handles_multiple_tool_calls_in_one_response
  - test_streaming_yields_done_at_end

## Part 2 — NestJS API tests (Jest)

### Setup

In apps/api/package.json, verify jest and @nestjs/testing are in devDependencies.
Create apps/api/jest.config.ts if missing.

### Test files to generate

**src/health/health.controller.spec.ts**
  - should return 200 with status object

**src/auth/auth.service.spec.ts**
  - should generate a valid JWT token
  - should reject token signed with wrong secret
  - should validate a correct token

**src/auth/auth.controller.spec.ts**
  - POST /auth/token with correct secret returns access_token
  - POST /auth/token with wrong secret returns 401

**src/chat/chat.service.spec.ts**
  - should forward chat request to agent URL
  - should handle agent SSE stream and yield NDJSON chunks
  - should retry on agent connection failure (if retry logic exists)
  - should return 502 if agent is unreachable after retries

**src/tools/tools.service.spec.ts**
  - should proxy GET /tools to agent
  - should return 404 if tool not found

**src/tasks/tasks.service.spec.ts**
  - should create a task and return it with an id
  - should list all tasks
  - should delete a task by id
  - should trigger a task run and return a runId

**src/mcp/mcp.controller.spec.ts**
  - POST /mcp/connect with valid URL proxies to agent and returns success
  - POST /mcp/connect with unreachable URL returns 502

## Part 3 — End-to-end tests (Playwright)

### Setup

Create apps/web/e2e/ directory.
Install playwright: `pnpm --filter @rawclaw/web add -D @playwright/test`
Create apps/web/playwright.config.ts.

### Test files to generate

**e2e/dashboard.spec.ts**
  - homepage loads without errors
  - health status cards are visible
  - health checks poll and update

**e2e/chat.spec.ts**
  - chat page loads
  - user can type a message and submit
  - assistant response streams in
  - tool result cards appear when a tool is called
  - conversation persists across page navigations (session storage)

**e2e/tools.spec.ts**
  - tools page loads and shows tool list
  - tool details are visible
  - MCP panel is visible

**e2e/tasks.spec.ts**
  - tasks page loads
  - new task can be created via the form
  - task appears in the task list after creation
  - task can be deleted

## Verification checklist

- [ ] `cd apps/agent && pytest tests/ -v` runs all tests (target: 40+ tests passing)
- [ ] `cd apps/api && npm test` runs all tests (target: 25+ tests passing)
- [ ] `cd apps/web && npx playwright test` runs e2e tests (target: 10+ tests passing)
- [ ] No test imports a module that doesn't exist
- [ ] Test coverage for the AnthropicProvider streaming tool_use fix (this was the critical bug)
- [ ] Integration seam tests: execute with tool call covers the full NestJS → agent → tool → response path
```

---

## SUMMARY — Paste order into Antigravity

| Phase | Prompt | Est. Time | Unblocks |
|---|---|---|---|
| 1.1 | Fix broken imports + web/dist | < 1hr | Agent startup |
| 1.2 | AnthropicProvider streaming fix | 1–2hr | Real-time tool calls |
| 2.1 | JWT Authentication | 2–3hr | API security |
| 2.2 | ChromaDB vector memory | 3–4hr | Cross-session memory |
| 2.3 | LangGraph StateGraph | 4–6hr | True agent intelligence |
| 3.1 | Wire MCP + ScheduleService | 2–3hr | MCP + scheduling |
| 3.2 | Tauri native commands | 3–4hr | Desktop shell |
| 4.1 | TypeScript task contracts | 1–2hr | Type safety |
| 4.2 | Docker Compose | 2–3hr | One-command dev |
| 5 | Full test suite | 6–8hr | Regression safety |

**Total estimated generation time: ~30–36 hours of Antigravity execution**

Start with Phase 1.1. It takes under an hour and unblocks everything else.
