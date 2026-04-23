# RawClaw Implementation Task List

## Overview
This document tracks all implementation tasks across the 7-phase RawClaw development program. Tasks are marked as ✅ Completed.

---

## Phase 1: Core Backend and Runtime Stability

**Goal:** Establish reliable async execution and model routing foundations.

### Tasks
- [x] **1.1** Fix async tool stream handling in tool parser
  - File: `apps/agent/src/models/tool_parser.py`
  - Status: ✅ Completed
  - Outcome: No more event loop blocking during tool execution

- [x] **1.2** Ensure selected agent model preferences are respected
  - File: `apps/api/src/chat-orchestrator.service.ts`
  - Status: ✅ Completed
  - Outcome: Agent modelId no longer ignored, prevents fallback to default routing

- [x] **1.3** Improve model ID normalization in router
  - File: `apps/agent/src/models/router.py`
  - Status: ✅ Completed
  - Outcome: Correct provider selection for all model formats

**Outcome:** Stable async execution and correct model selection honoring agent preferences.

---

## Phase 2: Tool Execution and Synthesis Reliability

**Goal:** Improve tool calling and multi-turn synthesis.

### Tasks
- [x] **2.1** Add tool-call follow-up synthesis loop
  - File: `apps/agent/src/executor.py`
  - Status: ✅ Completed
  - Outcome: Model continues after tool results to synthesize answer

- [x] **2.2** Fix hallucinated tool alias normalization
  - File: `apps/agent/src/executor.py`
  - Status: ✅ Completed
  - Outcome: `google:search` → `web_search`, etc.

- [x] **2.3** Fix malformed ToolResult returns in web fetch
  - File: `apps/agent/src/tools/builtin/web_fetch.py`
  - Status: ✅ Completed
  - Outcome: Proper ToolResult structure returned

- [x] **2.4** Add authenticated confirmation requests
  - File: `apps/agent/src/tools/confirmation_gate.py`
  - Status: ✅ Completed
  - Outcome: Auth token included in confirmation requests

- [x] **2.5** Design post-tool grounding prompts
  - File: `apps/agent/src/executor.py`
  - Status: ⚠️ Partially Completed (designed, implementation in progress)
  - Outcome: Prevents generic filler responses after tool use

- [x] **2.6** Add tool call UI handling in chat
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed
  - Outcome: Tool calls displayed with approval state

---

## Phase 3: Memory and RAG Correctness

**Goal:** Ensure KnowledgeBrain initialization and retrieval works with proper fallbacks.

### Tasks
- [x] **3.1** Ensure KnowledgeBrain is always initialized
  - File: `apps/agent/src/main.py`
  - Status: ✅ Completed
  - Outcome: No null reference errors

- [x] **3.2** Improve blended retrieval (semantic + literal)
  - File: `apps/agent/src/memory/knowledge_brain.py`
  - Status: ✅ Completed
  - Outcome: Better recall accuracy

- [x] **3.3** Add literal search fallback for exact matches
  - File: `apps/agent/src/memory/chroma_memory.py`
  - Status: ✅ Completed
  - Outcome: Exact identifier matches work (e.g., `PROJECT_VANGUARD`)

- [x] **3.4** Add deterministic direct-memory answer path
  - File: `apps/agent/src/executor.py`
  - Status: ✅ Completed
  - Outcome: Explicit recall queries answered directly

- [x] **3.5** Narrow direct-memory triggers
  - File: `apps/agent/src/executor.py`
  - Status: ✅ Completed
  - Outcome: Avoids over-eager matching

---

## Phase 4: Prompt Architecture and Agent Behavior

**Goal:** Build reusable prompt system for consistent agent behavior.

### Tasks
- [x] **4.1** Create prompt pack index documentation
  - File: `docs/prompts/README.md`
  - Status: ✅ Completed

- [x] **4.2** Create core system prompt
  - File: `docs/prompts/rawclaw-core-system.prompt.md`
  - Status: ✅ Completed

- [x] **4.3** Create tool grounding prompt
  - File: `docs/prompts/rawclaw-tool-grounding.prompt.md`
  - Status: ✅ Completed

- [x] **4.4** Create review/correction prompt
  - File: `docs/prompts/rawclaw-review-correction.prompt.md`
  - Status: ✅ Completed

- [x] **4.5** Create web research prompt
  - File: `docs/prompts/rawclaw-web-research.prompt.md`
  - Status: ✅ Completed

- [x] **4.6** Create planning prompt
  - File: `docs/prompts/rawclaw-planning.prompt.md`
  - Status: ✅ Completed

- [x] **4.7** Create code review prompt
  - File: `docs/prompts/rawclaw-code-review.prompt.md`
  - Status: ✅ Completed

- [x] **4.8** Add prompt-pack reference to docs
  - File: `docs/07-tasks-and-agents.md`
  - Status: ✅ Completed

- [x] **4.9** Update default agent prompt
  - File: `apps/web/src/pages/Agents.tsx`
  - Status: ✅ Completed

**Outcome:** 6 specialized prompts plus prompt-pack index documentation for consistent agent behavior.

---

## Phase 5: Centralized Frontend Health Monitoring

**Goal:** Unify health monitoring data source across frontend surfaces.

### Tasks
- [x] **5.1** Create shared health status hook
  - File: `apps/web/src/hooks/useHealthStatus.ts`
  - Status: ✅ Completed
  - Outcome: Single source of truth for health data

- [x] **5.2** Refactor system poller to use health hook
  - File: `apps/web/src/hooks/useSystemPoller.ts`
  - Status: ✅ Completed
  - Outcome: Reduced duplicate polling

- [x] **5.3** Update status bar component
  - File: `apps/web/src/components/layout/StatusBar.tsx`
  - Status: ✅ Completed
  - Outcome: Uses shared health data

- [x] **5.4** Integrate health provider in App
  - File: `apps/web/src/App.tsx`
  - Status: ✅ Completed
  - Outcome: Health data available app-wide

- [x] **5.5** Clean up Chat-specific health inconsistency
  - Status: ✅ Completed
  - Outcome: Consistent health display

---

## Phase 6: Chat Page Layout Refactor

**Goal:** Improve chat interface layout and message rendering.

### Tasks
- [x] **6.1** Refactor message cards with avatars
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

- [x] **6.2** Add expand/collapse for long responses
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

- [x] **6.3** Redesign session info bar
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

- [x] **6.4** Improve input area with attachment handling
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

- [x] **6.5** Add better loading states
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

- [x] **6.6** Improve tool execution display
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

- [x] **6.7** Fix duplicate model card removal
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

- [x] **6.8** Add real empty states
  - File: `apps/web/src/pages/Chat.tsx`
  - Status: ✅ Completed

---

## Phase 7: Navigation and Session Management

**Goal:** Improve navigation flexibility and session handling.

### Tasks
- [x] **7.1** Make left navigation sidebar collapsible
  - File: `apps/web/src/components/layout/Sidebar.tsx`
  - Status: ✅ Completed
  - Outcome: Toggle between full width and collapsed

- [x] **7.2** Make chat session sidebar collapsible
  - File: `apps/web/src/components/ChatSidebar.tsx`
  - Status: ✅ Completed
  - Outcome: 240px ↔ 40px toggle

- [x] **7.3** Fix chat session column visibility bug
  - File: `apps/web/src/components/ChatSidebar.tsx`
  - Status: ✅ Completed
  - Outcome: Session list visible (layout bug fixed)

- [x] **7.4** Add task creation UI
  - File: `apps/web/src/pages/Tasks.tsx`
  - Status: ✅ Completed
  - Outcome: Real task creation flow

- [x] **7.5** Reduce header height and page padding
  - File: `apps/web/src/App.tsx`
  - Status: ✅ Completed
  - Outcome: More content space

---

## Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Core Backend | 3 | ✅ Complete |
| Phase 2: Tool Execution | 6 | ⚠️ Mostly Complete (1 partial) |
| Phase 3: Memory/RAG | 5 | ✅ Complete |
| Phase 4: Prompt System | 9 | ✅ Complete |
| Phase 5: Health Monitoring | 5 | ✅ Complete |
| Phase 6: Chat UX | 8 | ✅ Complete |
| Phase 7: Navigation | 5 | ✅ Complete |
| **Total** | **41** | **~98% Complete** |

---

## Files Modified (Summary)

### Backend (Agent)
- `apps/agent/src/executor.py`
- `apps/agent/src/main.py`
- `apps/agent/src/models/tool_parser.py`
- `apps/agent/src/models/router.py`
- `apps/agent/src/memory/knowledge_brain.py`
- `apps/agent/src/memory/chroma_memory.py`
- `apps/agent/src/tools/builtin/web_fetch.py`
- `apps/agent/src/tools/confirmation_gate.py`

### Backend (API)
- `apps/api/src/chat-orchestrator.service.ts`

### Frontend
- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/pages/Tasks.tsx`
- `apps/web/src/pages/Agents.tsx`
- `apps/web/src/components/ChatSidebar.tsx`
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/components/layout/StatusBar.tsx`
- `apps/web/src/hooks/useHealthStatus.ts`
- `apps/web/src/hooks/useSystemPoller.ts`
- `apps/web/src/App.tsx`

### Documentation
- `docs/prompts/README.md`
- `docs/prompts/rawclaw-*.prompt.md` (6 files)
- `docs/07-tasks-and-agents.md`

---

*Last updated: 2026-04-23*
