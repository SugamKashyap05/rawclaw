# RawClaw Chat UI Council Report

Date: 2026-05-07

## Executive summary

RawClaw's main chat UI is not missing intelligence. It is missing legibility.

The current frontend already receives rich metadata for assistant messages and tool work:

- `agentId`
- `modelId`
- `memoryRecall`
- `memoryEvents`
- `advisoryEvents`
- `workflowState`
- `provenanceTrace`
- `runIds`
- `tool_calls`
- `toolResults`

The backend is already doing more than the user can see. The immediate opportunity is to render what is already flowing before adding new backend behavior.

The repo evidence supports a stricter version of the council's thesis:

1. Tool activity is rendered inconsistently across families.
2. Message source identity exists in metadata but is not surfaced as a first-class UI concept.
3. Memory visibility exists, but as technical after-the-fact blocks rather than as a lightweight "I remembered this" interaction.
4. SSE partial-response persistence is stronger than previously assumed, but the current UI hides persisted partial content whenever `message.error` exists.

This means the next sprint should be UI-first, but not blind. The correct order is:

1. Normalize tool-result rendering.
2. Surface agent/model identity.
3. Fix partial-content-on-error rendering.
4. Refactor memory visibility into a lighter coworker signal.
5. Add a chat-owned baseline persona layer.

## Scope of this report

This report answers the two gating questions raised by the council:

- What tool-renderer inventory exists in `Chat.tsx` today?
- What is the actual SSE partial-message persistence contract in `chat-orchestrator.service.ts`?

It also translates those findings into a concrete change order for the chat UI.

## Evidence summary

Primary files reviewed:

- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/components/chat/BrowserResult.tsx`
- `apps/web/src/components/chat/WebSearchResult.tsx`
- `apps/web/src/components/chat/FileResult.tsx`
- `apps/web/src/components/chat/CodeResult.tsx`
- `apps/web/src/components/chat/TerminalResult.tsx`
- `apps/web/src/components/chat/toolResultUtils.tsx`
- `apps/api/src/chat-orchestrator.service.ts`
- `packages/shared/src/contracts/tool.ts`

## Current chat UI: what already exists

### 1. Assistant message metadata already visible in limited form

The assistant message header in `Chat.tsx` already exposes some metadata:

- hardcoded speaker label: `RAWCLAW`
- timestamp
- `modelId`
- `memoryRecall` badge (`RECALLED`)
- NLU / intent chips
- lane / confidence chips

Below the message, the UI can also render:

- `tool_calls`
- orchestration harness logs
- approval-required state
- `memoryEvents`
- `advisoryEvents`
- `provenanceTrace`

This matters because the council's "metadata graveyard" diagnosis is only partially true. The data is not entirely invisible. It is visible in fragmented, technical, and inconsistent ways.

### 2. Tool results are rendered through a family dispatcher, not a universal card

`ToolResultRenderer` in `Chat.tsx` maps tool results like this:

- `search` -> `WebSearchResult`
- `browser` / `fetch` / `navigate` -> `BrowserResult`
- `file` -> `FileResult`
- `python` / `code` -> `CodeResult`
- `shell` / `terminal` / `bash` / `command` -> `TerminalResult`

Any unmatched tool falls through to a generic JSON card:

- title: `result.tool_name`
- body: `JSON.stringify(result.output ?? result.error ?? result.input, null, 2)`

This is the single clearest proof that RawClaw does not yet have a universal tool activity rendering model.

### 3. Page-read UI is styled, but trust-light

`BrowserResult.tsx` is already a styled card. It can show:

- header
- title
- URL
- screenshot
- content

But it does not prominently surface page-read hardening metadata such as:

- `backendResult`
- `evidenceStatus`
- `redirectedUrl`
- `isFallback`
- `fallbackAttempted`
- `contentTruncated`

So the page-read stack is ahead of the UI that explains it.

## Gating answer 1: full tool-renderer inventory

The current tool-rendering state in chat is:

| Family match | Renderer | State |
|---|---|---|
| `search` | `WebSearchResult` | Styled card |
| `browser` / `fetch` / `navigate` | `BrowserResult` | Styled card |
| `file` | `FileResult` | Styled card |
| `python` / `code` | `CodeResult` | Styled card |
| `shell` / `terminal` / `bash` / `command` | `TerminalResult` | Styled card |
| everything else | generic fallback | Raw JSON block |

Important implication:

- There are five explicit tool-family renderers.
- There is still a catch-all fallback path.
- Therefore the renderer inventory is not fully normalized today.

This means the council's proposed "ToolActivityCard first" sequence is correct, but the first concrete task is not just interface design. It is to replace or wrap the fallback path so unknown tools stop degrading into raw JSON.

## Gating answer 2: SSE partial persistence contract

The backend does persist partial assistant content.

### What `chat-orchestrator.service.ts` actually does

During streaming:

- content chunks are appended into `fullAssistantResponse`
- tool calls and tool results are collected
- metadata and provenance are accumulated

On completion, timeout, disconnect, or stream error, `finalize(...)` runs.

In `finalize(...)`:

- `persistContent` is derived from `fullAssistantResponse`
- if there is content and an error, the content is still persisted
- an error object is also written into message metadata when the payload type is `error`
- the assistant message is created through `chatService.createMessage(...)`

The error paths include at least:

- `stream_timeout`
- `stream_interrupted`
- `Aborted`

### The real UI problem

The frontend currently renders assistant content only when `!message.error`.

If `message.error` exists:

- the main assistant content branch is skipped
- an `ErrorCard` is shown instead

So the actual contract today is:

- backend: partial content is persisted
- frontend: persisted partial content is hidden if the message also has an error

This closes one council uncertainty and reveals a sharper implementation bug:

> RawClaw does not lose partial responses at persistence time; it loses them at render time.

That should move SSE recovery from "open architecture question" to "UI rendering fix with explicit UX policy."

## What must change in the chat UI, and in what order

### Phase 0: already resolved by this audit

These are no longer open questions:

1. Tool-renderer inventory is known.
2. SSE partial persistence is server-persisted, but UI-hidden on error.

Implementation can proceed without waiting on further backend discovery.

### Phase 1: introduce a universal `ToolActivityCard` wrapper

Do this first.

Reason:

- tool rendering is the most visible inconsistency in the chat surface
- the fallback path currently collapses unmatched tools into raw JSON
- page-read hardening already needs richer trust signals

Recommendation:

- define a shared `ToolActivityCard` UI shell
- make existing tool-specific renderers supply content inside that shell
- keep renderer-specific detail sections, but unify header semantics

Minimum common card fields:

- `sourceLabel` - tool or family label
- `status` - success / failed now, expandable later to strong / medium / degraded / skipped
- `durationMs`
- `summary`
- `details` slot / collapsible section

Important implementation note:

The shared `ToolResult` contract in `packages/shared/src/contracts/tool.ts` does not yet guarantee a universal rich status model. So the first pass should be a wrapper plus adapters, not a forced backend-wide schema migration.

### Phase 2: migrate `BrowserResult` first

`BrowserResult` should be the reference migration because page-read already has the richest trust metadata.

It should visibly surface:

- `backendResult`
- `evidenceStatus`
- `redirectedUrl`
- `contentTruncated`
- fallback state when present

This gives RawClaw one fully legible trust-sensitive tool family before generalizing further.

### Phase 3: add assistant source identity at the message level

Do this after the card wrapper is in place.

Reason:

- `agentId` and `modelId` already exist
- this is mostly rendering work
- it upgrades the chat from a monolithic speaker illusion to a legible coordinated system

Recommendation:

- keep `RAWCLAW` as the umbrella speaker label if desired
- add a compact source chip like:
  - `Main Agent | gpt-4o`
  - `App Builder | local`
  - `Research Agent | claude`

This should live in the assistant message header, not inside each tool card.

### Phase 4: change error rendering so partial persisted content is still visible

This is the highest-value reliability fix in the current chat renderer.

Current behavior:

- error present -> content hidden -> `ErrorCard` only

Recommended behavior:

- if `message.content` exists and `message.error` exists:
  - render the content
  - render a warning/error banner or `ErrorCard` beneath it
  - clearly state that the response was interrupted or incomplete

This turns a hidden persistence feature into visible resilience.

### Phase 5: refactor memory visibility into a coworker signal

RawClaw already shows:

- a `RECALLED` chip when `memoryRecall` is true
- a `MEMORY EVENTS` block when `memoryEvents` exists

So memory is not absent. It is just clunky and post hoc.

Recommendation:

- keep detailed memory events available in expandable form
- add a lighter inline memory indicator in the main message header or subheader
- treat memory as acknowledgment, not just audit

Example:

- `Used memory: project brief, your name`

This is a rendering refinement over existing data, not a new memory feature.

### Phase 6: add a chat-owned baseline persona fragment

Do this after the UI becomes more legible.

Reason:

- if you define personality before source, status, and memory are legible, the personality has nothing stable to rest on
- the current chat feel still varies too much with model and agent profile selection

Recommendation:

- inject a small system-level baseline fragment in the chat layer
- it should guarantee warmth, groundedness, and a stable greeting posture
- it should not replace agent profiles; it should stabilize them

## What is UI-only vs what needs backend work

### UI-only or mostly UI-only

- universal card wrapper
- browser result trust rendering
- agent source label
- memory visibility refinement
- error + partial-content co-rendering

### Backend coordination but not major backend invention

- if richer per-tool summaries are desired, some tools may need better `provenance_hint` or structured output fields
- if fully universal status values are required across tools, `ToolResult` may need schema extension later

### Not required before the first UI sprint

- new agent runtime features
- new memory system features
- new provenance capture
- new SSE transport layer

## Recommended sprint order

1. Inventory is complete; close the audit task.
2. Build `ToolActivityCard` shell and map existing five renderers into it.
3. Migrate `BrowserResult` with page-read trust fields.
4. Add assistant source chip from `agentId` and `modelId`.
5. Change assistant error rendering to show partial content when available.
6. Refactor memory visibility into lighter inline signals with expandable detail.
7. Add the chat-owned baseline persona fragment.

## Risks to watch while implementing

### 1. Do not overfit the first shared card schema

The current `ToolResult` contract is intentionally loose. If the first pass tries to force every tool into one overly rich data model, the UI rewrite will turn into a backend migration.

Start with a shared shell and adapter pattern.

### 2. Do not duplicate source identity inside both cards and messages

Tool source and assistant source are different concepts.

- Message header should answer: who is speaking?
- Tool card should answer: what operation just ran?

Mixing them will make the UI noisier, not clearer.

### 3. Fix the partial-content error rendering before adding reconnection theatrics

The system already preserves content. The first win is to show it. A retry/resume UX can come later if needed.

## Bottom line

The council is directionally right, but the repo evidence sharpens the plan:

- the renderer audit is finished
- SSE partial persistence is not unknown; it is already implemented on the backend
- the main immediate defect is that the frontend hides partial persisted content on error

So the next instruction set should not begin with more discovery. It should begin with a UI sprint that:

1. unifies tool rendering,
2. makes source identity visible,
3. exposes persisted partial content during failures,
4. turns memory from an audit block into a coworker signal,
5. then stabilizes persona at the chat layer.

That is the shortest path from "generic tool activity" to "coherent coworker experience" using data RawClaw already has.
