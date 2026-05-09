# RawClaw Council Report: Chat Grounding Bug + Tasks Surface Inventory

Date: 2026-05-08

## Executive Summary

This report adds one new bug to the council record and documents the current Tasks surface so the council can decide what to fix next and what to add.

There are two separate truths at once:

1. The recent chat/browser cleanup pass was real and improved the visible UI.
2. A new agent-answer bug is still present: the final assistant reply can still claim that evidence was "too weak or too thin" even after a page-read path has already succeeded strongly enough to produce usable page evidence.

That second issue is not the old BrowserResult renderer bug. It is a different layer:

- BrowserResult / extraction card path
- final answer synthesis / grounded-answer path

The Tasks page is also functional today, but incomplete. It already supports task definitions, schedules, manual runs, run inspection, artifacts, and chat-linked resume behavior. What it lacks is the product layer that would make it feel complete: status filtering, schedule controls, task tool configuration, better provenance rendering, and parity between the `/tasks` page and the chat-side task panel.

## New Bug To Add To Council Record

### Bug Name

Grounded-answer synthesis bug for direct page-read / OpenAI changelog flows

### User-visible symptom

The agent replied:

- "I could not verify two strong current OpenAI API updates from the gathered evidence."
- "The available search results were too weak or too thin to support a reliable comparison."
- "The current OpenAI API update timeline could not be confirmed from the available evidence."

### Why this is a real bug

This is not just a cautious answer. It is inconsistent with the known evidence path.

In earlier debugging, the live `Technical details` payload for the same class of request showed:

- `pageReadOrchestrated: true`
- `backendUsed: browser`
- `backendResult: success`
- `evidenceStatus: strong`
- `wordCount: 5366`
- `backendAttempts` showing:
  - `http -> failed`
  - `browser -> success`
  - `search_fallback -> skipped (direct evidence accepted)`

That means the system had a successful browser-based page read and enough recovered text to clear the useful-content threshold. If the final assistant answer still falls back to "search results were too weak or too thin," then the bug is no longer in the extractor card. It is in the grounded final-answer synthesis path.

### Most likely code path

The exact reply text appears as hard-coded fallback content in `apps/agent/src/executor.py`.

Relevant branches include:

- OpenAI/API weak-evidence fallback around lines `3607-3618`
- OpenAI/API findings fallback around lines `5007-5013`
- OpenAI/API findings minimum-bullet fallback around lines `5088-5094`

These branches strongly suggest the following failure mode:

1. page-read evidence exists
2. the final answer synthesis path fails to convert that evidence into usable bullets or evidence lines
3. the executor falls through to the OpenAI/API-specific abstain template
4. the user sees a weak-evidence answer even though page evidence was actually recovered

### Working hypothesis

The council should treat this as a synthesis/grounding bug, not a BrowserResult display bug.

Most likely gaps:

- extracted page evidence is not being promoted into `evidence_lines` strongly enough
- `bullets_from_evidence(...)` is returning no usable bullets for this content shape
- the final answer path is overweighting weak search state even when direct page evidence succeeded
- the answer renderer is still optimized for "latest updates from search" more than "strong direct page read from one authoritative changelog page"

### Severity

High trust bug.

Why:

- the tool card can say the page read succeeded
- the final answer can still talk like the evidence failed
- the user has no clean mental model for which layer to trust

### Council decision requested

Treat this as a separate bug from the already-fixed BrowserResult rendering issue.

Recommended next implementation target:

1. instrument the final grounded-answer path for direct page reads
2. confirm whether recovered page text is entering `bullets_from_evidence(...)`
3. if direct page evidence is present and above threshold, prevent the OpenAI/API weak-search abstain template from firing unless page evidence also fails

## Current Tasks Surface: What Exists Today

This section documents the actual Tasks product as implemented now, across the dedicated `/tasks` page, the shared task contract, and the chat-side task panel.

## Tasks Page Frontend

Primary page:

- `apps/web/src/pages/Tasks.tsx`

Current user-facing functions:

- list all task definitions
- search task definitions by:
  - name
  - description
  - schedule string
- create task definitions
- edit task definitions
- delete task definitions
- manually run a task definition immediately
- choose an agent for a task
- set an optional cron schedule
- preview cron schedule validity and next run time
- set a workspace id
- see task cards showing:
  - name
  - description
  - agent
  - workspace
  - last run status
  - next run
  - schedule badge
- inspect recent runs in an execution log side panel
- load full run detail for a selected run
- view run metadata:
  - created time
  - started time
  - finished time
  - resumed-from linkage
  - description
- download run artifacts
- open run output path
- delete runs
- inspect recorded run steps
- inspect raw provenance JSON

## Chat-side Task Surface

Chat panel component:

- `apps/web/src/components/chat/TaskRunPanel.tsx`

Current chat-side functions:

- show recent background tasks for the current session
- sort runs newest-first
- show honest run state:
  - queued
  - running
  - done
  - failed
  - cancelled
- show resumable failed/cancelled runs
- resume a failed/cancelled run into the active chat session
- show resumed badge when a run came from another run
- show duration / elapsed time
- show inline run error messages
- show indeterminate running indicator instead of fake percent progress

This panel is more session-aware than the main `/tasks` page.

## Shared Task Contract

Shared types:

- `packages/shared/src/contracts/task.ts`

Current modeled concepts:

- `Task`
  - definition metadata
  - name / description
  - agent id
  - tool ids
  - schedule
  - workspace id
  - last run status
- `TaskRun`
  - task linkage
  - run status
  - started / finished times
  - selected agent
  - output path
  - provenance
  - error message
  - resumed-from run id
  - session id
  - steps
- `RunStep`
  - step type
  - tool name
  - input summary
  - output summary
  - source URL
  - duration
  - timestamp
- execution/result-oriented task models for future richer task execution reporting

## Tasks Backend

Main files:

- `apps/api/src/tasks/tasks.controller.ts`
- `apps/api/src/tasks/tasks.service.ts`
- `apps/api/src/tasks/schedule.service.ts`

Current backend/API functions:

- create task definitions
- list task definitions
- get a single task definition
- update task definitions
- delete task definitions
- preview cron schedule validity / next run
- list scheduled tasks
- list runs with pagination (`/tasks/runs`)
- list recent runs (`/tasks/runs/recent`)
- filter recent runs by `sessionId`
- enqueue manual runs (`POST /tasks/:id/run`)
- fetch run detail (`GET /tasks/runs/:runId`)
- delete a run
- update a run from the agent side
- resume a run into a new queued run linked by `resumedFromRunId`
- download a run artifact

Scheduling behavior:

- cron schedules are loaded on module init
- a minute-based scheduler checks whether each cron expression should fire
- matching definitions are enqueued through the same `enqueueRun(...)` path as manual runs

Agent execution handoff:

- queued runs are sent to the agent service via `POST {agentUrl}/execute/task`
- resume runs create a new run row instead of mutating the old one

## What The Tasks Surface Does Well Already

The Tasks system is not empty or conceptual. It already has a real foundation:

- task definitions exist
- runs are persisted
- schedules are real
- artifacts are downloadable
- provenance is stored
- step-level detail exists
- session-linked resume exists
- chat can already surface task activity for the current session

That means the council is not deciding whether to build a Tasks product from zero. The council is deciding how to turn an existing engine and utility UI into a complete product surface.

## Gaps In The Current Tasks Surface

These are the most important product and engineering gaps visible from the current implementation.

### 1. Tool configuration exists in contract, but not in the UI

The shared model supports `toolIds`, but the `/tasks` page always saves:

- `toolIds: []`

So today:

- the data model says tasks can declare tool scope
- the create/edit UI does not let the user configure it

This is a real capability gap.

### 2. The `/tasks` page is not session-aware enough

The chat-side `TaskRunPanel` can resume runs into the current session.

The `/tasks` page:

- lists recent runs globally
- does not expose session grouping
- does not expose resume from the main task detail UI

This creates a split experience where the chat panel is better for session-linked recovery than the actual Tasks page.

### 3. Provenance is raw, not usable

The `/tasks` page currently renders provenance as raw JSON.

That is useful for debugging, but weak as a product surface. The user gets:

- run steps
- raw provenance dump

but not:

- a readable work summary
- grouped attempts
- trust story
- clear outcome summary

### 4. Run controls are incomplete

Current run actions are limited relative to what a user would expect from a Tasks page.

Missing or partial:

- resume from `/tasks` page
- rerun selected historical run
- cancel running task
- pause / disable scheduled task without deleting it
- retry last failed run from the definition page

### 5. History and filtering are thin

The page has text search, but not operational filtering.

Missing filters:

- by status
- by agent
- by workspace
- by scheduled vs manual
- by session
- by has artifact / has error

The backend already has a paged runs endpoint, but the main page currently pulls only recent runs and does not expose pagination controls.

### 6. Status naming is not fully unified

The shared contract mixes:

- `pending/running/completed/failed/cancelled`

and

- `queued/running/done/failed/cancelled`

The UI mostly uses the run-level vocabulary, but the contract still carries two related status dialects.

This is survivable, but it is a long-term clarity and mapping risk.

### 7. Error and success storytelling are missing

Tasks today can show:

- error message
- output link
- provenance JSON

But they do not yet show:

- what the task tried
- what succeeded
- what failed
- what recovery path was taken
- what changed after resume

In practice, the task system has the data but not yet the narrative layer.

## Council-Level Product Gaps: What To Add Next

If the council wants the Tasks page to become a complete product surface instead of a power-user utility page, these are the strongest additions to consider.

### A. Add task configuration depth

Recommended additions:

- tool allow-list picker
- model selection
- timeout / max-iteration controls
- schedule enable/disable toggle
- manual-only vs scheduled badge

### B. Bring parity between `/tasks` and chat-side tasks

Recommended additions:

- resume action on `/tasks` page
- session-aware run filter
- show which chat/session a run belongs to
- jump from task run to originating chat session

### C. Replace raw provenance with readable execution storytelling

Recommended additions:

- run summary card
- grouped attempt list
- readable step labels
- outcome-level explanation
- expanded raw provenance only as technical detail

### D. Add operational control surface

Recommended additions:

- cancel running run
- retry last failed run
- rerun selected historic run
- pause scheduled task
- disable schedule without deleting definition

### E. Add task management filters and history

Recommended additions:

- status filter
- agent filter
- workspace filter
- scheduled/manual filter
- pagination or archived history view
- artifact-only / failed-only quick views

## Council Decisions Requested

The council should make decisions on two tracks.

### Track 1: New chat/agent bug

Decision:

Should we prioritize the grounded-answer synthesis bug now, before more chat UI polish?

Recommendation:

Yes.

Reason:

The system can now recover strong direct page evidence and still answer as if evidence were weak. That is a trust bug at the answer layer.

### Track 2: Tasks product direction

Decision:

Should the next Tasks work focus on:

1. operational completeness
2. UX clarity / provenance readability
3. chat-to-task parity

Recommendation:

Start with:

1. task/tool configuration
2. resume/retry/cancel parity
3. readable run summary replacing raw provenance as the default view

That combination improves both utility and trust without needing a full redesign.

## Recommended Next Steps

### Immediate bug follow-up

1. Instrument the grounded-answer path for direct page-read evidence
2. Verify whether recovered page text reaches `bullets_from_evidence(...)`
3. Block the OpenAI/API weak-search abstain template when direct page evidence succeeded strongly enough

### Tasks page follow-up

1. Add tool configuration to create/edit task form
2. Add resume to `/tasks` page
3. Add status/session/agent filtering
4. Replace default provenance JSON with a readable run outcome summary
5. Decide whether schedule pause/disable belongs in this sprint or the next one

## Final Council Bottom Line

The new bug to log is:

- the assistant can still produce a weak-evidence abstain answer even after a strong direct page-read succeeded

The Tasks page today is:

- real
- useful
- backed by working services

but still missing the controls and explanation layers that would make it feel complete.

That is the gap the council now needs to prioritize.
