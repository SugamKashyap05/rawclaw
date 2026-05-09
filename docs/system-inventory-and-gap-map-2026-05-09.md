# RawClaw System Inventory And Gap Map

Date: 2026-05-09

This document is a practical inventory of what exists in RawClaw today, how each part is used, and where the system is still weak or incomplete.

It is meant to answer questions like:

- What are all the major moving parts?
- Which ones are runtime-critical?
- Which ones are just support or testing layers?
- Where are we solid?
- Where are we still patching around architectural gaps?

---

## 1. Top-level runtime picture

RawClaw currently runs as a multi-app local-first system:

- `apps/web`
  - Main React UI
- `apps/api`
  - NestJS control plane, orchestration layer, persistence layer
- `apps/agent`
  - FastAPI foreground agent engine
- `apps/swarm-worker`
  - Queue consumer for background/scout/automation/sandbox/builder work
- `apps/desktop`
  - Tauri shell around the UI
- `packages/shared`
  - Shared contracts and types used across the stack

Backends used by the runtime:

- Redis
  - live queue/control-plane/session/worker state
- ChromaDB
  - semantic memory
- SQLite / Prisma
  - persistent platform records
- Ollama
  - local model runtime
- optional cloud model providers
  - via the model router

---

## 2. What exists today

### 2.1 Web UI surfaces

Main pages in `apps/web/src/pages`:

- `Chat.tsx`
- `Dashboard.tsx`
- `Gateway.tsx`
- `Operator.tsx`
- `Tasks.tsx`
- `Memory.tsx`
- `MCPServers.tsx`
- `Models.tsx`
- `Agents.tsx`
- `Tools.tsx`
- `Skills.tsx`
- `Sandbox.tsx`
- `Settings.tsx`
- `Learning.tsx`
- `Provenance.tsx`
- `Integrations.tsx`
- `AppBuilder.tsx`

How they are used:

- Chat is the main live conversation surface.
- Gateway and Operator expose run/control-plane visibility.
- Memory, Models, MCP Servers, Agents, Tools, and Skills are system-management views.
- Settings is where reset/bootstrap and runtime preferences live.
- App Builder is a separate higher-level generation workflow.

What this tells us:

- The product already has a broad operator-facing shell.
- The UI is not the missing piece; most gaps are backend/runtime quality and consistency.

---

### 2.2 API / control plane

Core API runtime lives in `apps/api/src`.

Important controllers/services:

- `chat.controller.ts`
- `chat-orchestrator.service.ts`
- `chat.service.ts`
- `chat-nlu.service.ts`
- `chat-transformer.service.ts`
- `intake-transformer.service.ts`
- `context-transformer.service.ts`
- `emission-transformer.service.ts`
- `persistence-transformer.service.ts`
- `gateway-control-plane.service.ts`
- `gateway-routing.service.ts`
- `gateway-execution.service.ts`
- `gateway-subagent.service.ts`
- `gateway-automation.service.ts`
- `gateway-events.service.ts`
- `gateway-worker-monitor.service.ts`
- `operator.service.ts`
- `process-controller.service.ts`
- `memory.service.ts`
- `models.service.ts`
- `agents.service.ts`
- `settings.service.ts`
- `bootstrap.service.ts`
- `self-improvement.service.ts`
- `knowledge-graph.service.ts`
- `reflection.service.ts`
- `prompt-catalog.service.ts`

How the API is used:

- It is the runtime broker between UI and agent.
- It owns session records, run records, queue state, persisted messages, prompt provenance, operator views, and worker registration.
- It also performs tool selection, NLU steering, pipeline transforms, and SSE streaming behavior before/after the agent runs.

Important architectural reality:

- The API is not just a thin proxy anymore.
- It is already the de facto control plane.

Main strengths:

- Strong orchestration surface
- Central place for persistence
- Good place for trust, policy, routing, and observability

Main weakness:

- Too much important behavior now lives partly in API and partly in agent, which means regressions often happen at the seam.

---

### 2.3 Agent engine

Core agent runtime lives in `apps/agent/src`.

Key files/directories:

- `main.py`
- `executor.py`
- `models/`
- `tools/`
- `memory/`
- `research/`
- `provenance/`
- `gateway/`
- `graph/`
- `sessions/`
- `sandbox/`
- `agents/`

How the agent is used:

- It executes the foreground request loop.
- It decides on tool calling, runs tools, gathers evidence, writes grounded answers, and emits provenance.
- It is still the "truth engine" for a turn.

What exists inside it:

- model router
- provider adapters
- tool registry
- confirmation gate
- research pipeline
- memory recall hooks
- output review / guardian gate
- provenance tracing

Main strengths:

- Rich execution logic already exists
- Tool-based grounded behavior is real, not just planned
- Research stages are explicit

Main weakness:

- `executor.py` is carrying a lot of responsibility at once
- behavior can drift because selection, synthesis, review, and repair all converge there

---

### 2.4 Swarm worker

Background worker runtime lives in `apps/swarm-worker/src/main.py`.

Queues currently handled:

- subagent queue
- automation queue
- sandbox queue
- builder queue

How it is used:

- It registers with the API
- consumes Redis streams
- heartbeats worker status
- handles queued background work

What it gives us:

- worker-pool-first execution for non-foreground tasks
- clear separation between "foreground chat path" and queued work

Where it is still weak:

- operational complexity is higher now
- local restart/bootstrap reliability matters a lot
- queue behavior is powerful but harder to reason about without good dashboards

---

### 2.5 Desktop shell

Desktop runtime lives in `apps/desktop`.

How it is used:

- wraps the web app in Tauri
- provides a desktop-native shell
- currently mostly acts as packaging + local delivery surface

What is missing:

- desktop-native trust/diagnostics are not yet the center of the architecture
- it is still more wrapper than first-class runtime controller

---

### 2.6 Shared contracts

Shared definitions live in `packages/shared/src/contracts`.

What they are used for:

- chat events
- gateway/control-plane records
- app builder records
- process controller / harness records
- model contracts
- memory contracts
- MCP contracts
- transformer pipeline contracts

Why this matters:

- shared contracts are one of the stronger parts of the codebase
- they are the main defense against frontend/backend drift

Gap:

- not every runtime behavior is cleanly represented as a small typed concept yet
- some important behavior is still "hidden in implementation" rather than explicit in contracts

---

## 3. Runtime subsystems, one by one

### 3.1 Chat pipeline

Used in:

- `chat.controller.ts`
- `chat-orchestrator.service.ts`
- `chat.service.ts`
- `chat-transformer.service.ts`
- `intake-transformer.service.ts`
- `context-transformer.service.ts`
- `emission-transformer.service.ts`
- `persistence-transformer.service.ts`

How it works today:

1. request enters API
2. API resolves session, controls, model, selected agent
3. API fetches tools from agent
4. API performs NLU/tool selection/prompt assembly
5. API streams request to agent
6. agent executes
7. API sanitizes/streams/persists result

Strength:

- this pipeline is now explicit enough to debug

Gap:

- behavior is spread across several transformer stages plus the agent, so root-cause tracing still takes work

---

### 3.2 Model system

Used in:

- `apps/api/src/models.service.ts`
- `apps/agent/src/models/router.py`
- `apps/agent/src/models/providers/*`

Providers currently visible in router:

- Ollama
- Anthropic
- Minimax

How it is used:

- resolves explicit model or complexity-based model
- routes requests to local/cloud providers
- now includes capability-aware fallback logic for unsupported chat/generate/tool combinations

Strength:

- routing layer exists and is real

Gap:

- model capability metadata is still more runtime-discovered than centrally modeled
- small local models remain fragile under heavier research/tool workloads

---

### 3.3 Tools

Used in:

- `apps/agent/src/tools/registry.py`
- `apps/agent/src/tools/base_tool.py`
- built-in tool files under `apps/agent/src/tools/builtin/`
- MCP wrappers under `apps/agent/src/tools/mcp_*`

Tool families in practice:

- search
- fetch/extract
- browser
- filesystem
- shell/code
- date/time
- memory-adjacent helpers
- research helpers
- skill tools

How tools are used:

- API fetches full tool inventory from agent
- API scores/selects relevant tools for a turn
- agent re-scores/caps tools again for execution safety
- tools emit structured results and provenance

Strength:

- tool execution is first-class, not bolted on

Gaps:

- tool inventory is too large
- selection quality matters a lot because the registry is huge
- we already hit one real bug where "empty tool list" accidentally became "all tools"

This is one of the system's biggest practical risk zones.

---

### 3.4 Skills

Skill tools appear as `skill_*` tools in the agent tool inventory.

How they are used:

- API and agent both treat them as selectable tool-backed workflows
- they act like packaged playbooks rather than normal primitive tools

Examples seen in runtime:

- `skill_grounded-web-summary`
- `skill_repo-explainer`
- many installed automation-style skills

Strength:

- extensibility is real

Gap:

- the skill/tool surface has become very large
- discoverability and quality control of installed skills is a real concern

---

### 3.5 MCP

Used in:

- `apps/agent/src/main.py`
- `apps/agent/src/tools/mcp_gateway.py`
- `apps/agent/src/tools/mcp_tool_wrapper.py`
- `apps/agent/src/tools/mcp_discovery.py`
- API `mcp/` module
- UI `MCPServers.tsx`

How MCP is used:

- agent boots MCP gateway if configured
- connects to stdio or SSE MCP servers
- wraps discovered MCP tools into the normal registry
- MCP tools can override built-in tools with the same name
- UI lets operator view/add/remove MCP servers

Strength:

- MCP is integrated into the live runtime, not just planned

Gap:

- MCP health/config/reliability still depends heavily on local environment quality
- wrapped MCP tools increase the already-large tool surface

---

### 3.6 Memory

Used in:

- `apps/api/src/memory.service.ts`
- `apps/api/src/memory.controller.ts`
- `apps/agent/src/memory/*`
- Chroma
- Prisma fallback storage

Memory layers in practice:

- session/short-term memory
- semantic/vector memory
- workspace memory files
- operator/mission/session collections

How it is used:

- API memory endpoints talk to agent memory first
- Prisma acts as fallback/local persistence for entries
- agent uses memory retrieval in execution

Strength:

- memory is not just a UI feature; it is wired into runtime behavior

Gap:

- memory behavior is still inconsistent enough that users notice when a turn "should have remembered"
- memory truthfulness and memory recall visibility are still active correctness concerns

---

### 3.7 Research pipeline

Used in:

- `apps/agent/src/research/*`
- large sections of `executor.py`

Stages that exist:

- planner
- pre-evidence filter
- extract router
- multi-attempt extract
- evidence judge
- answerability gate
- confidence/risk model
- final writer

How it is used:

- current-information or grounded queries route into explicit research stages
- evidence is clustered, judged, and then written into a grounded answer

Strength:

- this is one of the most explicit subsystems in the codebase

Gaps:

- extraction quality and final synthesis quality are still different maturity levels
- planner diversification is improved but still not fully hardened
- live pages and news-article variation still expose brittleness

---

### 3.8 Agent roles and role trace

Used in:

- `apps/agent/src/research/types.py`
- `apps/agent/src/research/swarm.py`
- API gateway control-plane/operator services

Foreground role model:

- Lead Strategist
- Scout
- Analyst
- Guardian

How it is used:

- even single-turn foreground chat can be annotated in these roles
- control plane stores role trace and guardian outcome
- operator/gateway surfaces can inspect the run

Strength:

- there is a meaningful internal role architecture now

Gap:

- a lot of this is trace/stateful semantics, not always separate runtime workers
- the naming is strong, but some behaviors are still co-located in the same foreground executor

---

### 3.9 Output reviewer / Guardian

Used in:

- `apps/api/src/prompt-catalog.service.ts`
- `apps/agent/src/executor.py`
- `apps/api/src/chat-orchestrator.service.ts`

How it is used:

- review can be enabled for prompts that need stronger truthfulness
- guardian outcome is persisted
- repair/rewrite prompts can revise degraded answers

Strength:

- answers already have a second-pass quality/truthfulness concept

Gap:

- this layer can mask deeper upstream issues if not instrumented carefully
- when formatting or synthesis is wrong, the failure can look like "review weirdness"

---

### 3.10 Gateway / control plane

Used in:

- `gateway-control-plane.service.ts`
- `gateway-routing.service.ts`
- `gateway-events.service.ts`
- `gateway-execution.service.ts`
- `gateway-subagent.service.ts`
- `gateway-automation.service.ts`
- `gateway-worker-monitor.service.ts`

What it owns:

- runs
- queue metadata
- worker assignments
- guardian outcomes
- short-term memory entries
- role trace snapshots
- recent activity

Strength:

- this is the real backbone of the Phase 3 runtime

Gap:

- operational complexity is now high enough that observability is mandatory
- without clean dashboards/log conventions, debugging becomes expensive

---

### 3.11 Tasks and automation

Used in:

- `apps/api/src/tasks/*`
- `apps/api/src/gateway-automation.service.ts`
- swarm worker queues

How it is used:

- task definitions and runs are first-class
- automations can queue background work
- worker pool executes queued task-like jobs

Gap:

- foreground chat is currently more mature than long-running automation UX
- run inspection is present but still not simple enough for casual operators

---

### 3.12 Harness

Important: "harness" currently means more than one thing.

It appears in:

- chat stream events (`type: "harness"`) from `apps/agent/src/executor.py`
- process-controller harness run/process records in `packages/shared/src/contracts/process-controller.ts`
- app-builder harness metadata/services in `apps/api/src/app-builder/*`
- UI harness status panel in `apps/web/src/components/chat/HarnessStatusPanel.tsx`

How it is used:

1. chat harness
   - lightweight orchestration/pre-invocation logs in live chat streams
2. process harness
   - tracks validation/process runs
3. app-builder harness
   - ties generation/validation metadata to builder runs

Strength:

- there is already a concept of structured execution bookkeeping

Gap:

- the word "harness" is overloaded
- this makes the system harder to explain and reason about quickly

This is a clarity problem, not just a code problem.

---

### 3.13 Bootstrap / onboarding / reset

Used in:

- `apps/api/src/bootstrap.service.ts`
- `apps/api/src/bootstrap.controller.ts`
- `apps/web/src/components/bootstrap/BootstrapWizard.tsx`
- `apps/web/src/pages/Settings.tsx`

How it is used:

- first-launch setup
- reset everything / fresh-start flow
- Ollama preflight
- main agent creation
- background base-agent profile creation

Strength:

- onboarding is now a real product path, not just environment setup

Gap:

- environment boot and service restart reliability still affect perceived onboarding quality

---

### 3.14 App Builder

Used in:

- `apps/api/src/app-builder/*`
- `apps/web/src/pages/AppBuilder.tsx`

What exists:

- planner
- architecture engine
- file graph generator
- context engine
- code generation engine
- validation engine
- self-healing loop
- deployment manager
- workflow state / lock / storage / harness metadata

Strength:

- app builder is substantial and not just a placeholder

Gap:

- it is its own mini-platform inside the platform
- that means it needs especially strong boundaries and naming to avoid becoming "the second system"

---

## 4. What the system is already good at

- Strong typed-contract culture
- Real multi-surface UI
- Real control plane
- Real queue/worker model
- Real tool execution and MCP integration
- Real research pipeline
- Real provenance and guardian/review concepts
- Real reset/onboarding flow

This is not a toy architecture anymore.

---

## 5. Where we are still lacking

### 5.1 Tool surface is too large

- The registry/tool inventory is enormous.
- Good behavior depends on selection being excellent.
- When selection fails, latency and weirdness rise fast.

This is a top-tier system risk.

### 5.2 Behavior is split across API and agent

- The API is making routing, selection, transform, and persistence decisions.
- The agent is also making selection, execution, synthesis, and review decisions.

This split is powerful, but it creates seam bugs.

### 5.3 Research quality is uneven by stage

- Search/extract have improved a lot.
- Final research answer writing is still less reliable than evidence capture.

So "facts found" and "answer delivered well" are not always equally mature.

### 5.4 Conversation quality and research quality are different systems

- Plain chat, memory, story writing, and grounded research do not fail for the same reasons.
- Some bugs are routing/tool problems, others are synthesis/formatting problems.

This means one green path does not imply the others are healthy.

### 5.5 Runtime observability is still too expensive

- We have logs and traces.
- But getting from symptom -> exact failure point still takes too much manual reading.

We need stronger "operator-grade" visibility, not just dev logs.

### 5.6 Harness naming is overloaded

- "harness" refers to at least three adjacent concepts.

This makes the mental model harder than it should be.

### 5.7 Local environment fragility still matters too much

- Redis/Chroma/Ollama/API/agent/worker boot quality directly affects perceived product reliability.
- Restart friction and model-path quirks still leak into debugging and validation work.

### 5.8 Capability metadata is not centralized enough

- model capabilities
- tool capabilities
- lane expectations
- review requirements

These exist, but not always as one explicit, inspectable policy layer.

---

## 6. The most important "clear picture" summary

If you want the shortest truthful summary of RawClaw today, it is this:

1. The system already has a real control plane, real agent runtime, real worker pool, real tool layer, real memory layer, and real UI shell.
2. The main weakness is not "missing components." The main weakness is **coordination quality between existing components**.
3. The highest-risk zones are:
   - tool selection
   - research synthesis
   - model capability/routing
   - runtime observability
   - local boot/restart reliability
4. The system is broad enough now that naming clarity and contract clarity matter almost as much as raw implementation.

---

## 7. Recommended next inventory follow-ups

If you want to go one level deeper after this document, the most useful follow-up inventories would be:

- a "tool inventory and pruning map"
- a "model routing and capability matrix"
- a "research pipeline failure map"
- a "gateway/control-plane event map"
- a "who owns what" file-by-file boundary map across API vs agent vs worker

Those would make the next architectural decisions much easier.
