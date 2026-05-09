# RawClaw Chat UI v1.2 Implementation Report

## Summary

This pass implemented the core of the **Chat UI v1.2** plan:

- the **partial-content-on-error hotfix**
- the **shared tool activity shell**
- the **BrowserResult trust rendering pass**
- the **assistant source chip**
- the **lightweight memory indicator**
- the **baseline persona fragment**

The work is real and verified, but it is not a perfect 100% completion of every operational item in the plan. The main code paths are implemented. The plan items that require production telemetry, live deployed page-read traffic, or a human qualitative review are documented below as **not fully completed from within the repo alone**.

---

## What Was Implemented

### 1. Partial-content-on-error hotfix

Implemented in:
- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/components/chat/InterruptedBanner.tsx`

Behavior now:
- if an assistant message has `content`, the content is rendered
- if that same message also has `error`, the UI renders the new interrupted banner beneath the content
- the full `ErrorCard` now renders only for **error-only** assistant messages with no content

User-facing copy:
- `I was cut off - here's what I had. Want me to continue?`

Retry behavior:
- retry/regenerate is shown only when `message.id` exists
- in-flight placeholder messages without an id render the banner as informational only

This closes the major trust bug where the backend had already persisted partial assistant output, but the frontend hid it whenever `message.error` existed.

---

### 2. Shared tool activity shell

Implemented in:
- `apps/web/src/components/chat/ToolActivityCard.tsx`
- `apps/web/src/components/chat/GenericToolCard.tsx`
- `apps/web/src/components/chat/toolResultUtils.tsx`

New shared status interface:
- `success`
- `failed`
- `degraded`
- `skipped`

What changed:
- the old per-renderer header presentation was replaced with a single shell component
- the shell owns source label, status, and optional duration
- existing renderer bodies were preserved as much as possible to keep regression risk low

Fallback behavior:
- unknown tool families now render through `GenericToolCard`
- fallback labels are humanized
- long labels are truncated intentionally
- the full raw tool name is preserved via `title=...` on hover

This means unmatched tools no longer fall through to raw inline JSON in the main chat surface.

---

### 3. BrowserResult trust migration

Implemented in:
- `apps/web/src/components/chat/BrowserResult.tsx`
- `apps/web/src/pages/Chat.tsx`

Important routing fix:
- `ToolResultRenderer` now routes `web_extract` through `BrowserResult`
- without this, the new page-read trust UI would not have appeared for the main direct page-read path

Trust fields rendered when present:
- `backendResult`
- `evidenceStatus`
- `redirectedUrl`
- `isFallback`
- `fallbackAttempted`
- `contentTruncated` (with fallback to existing truncation signal where needed)

User-facing behaviors:
- `backendResult='skipped'` renders as a neutral informational state
- browser queue-full shows:
  - `Not attempted - browser queue was full.`
- redirect info is shown only when the final URL differs from the requested URL
- degraded and fallback states are visible instead of hidden inside content

Partial-presence behavior:
- fields are rendered only when present
- missing fields are silently omitted
- no blank trust rows are rendered

This is intentionally resilient to partial backend rollout, though the original plan wanted this phase gated on live v15.3 deployment verification.

---

### 4. Assistant source identity

Implemented in:
- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/components/chat/messageMetadataUtils.ts`

What now appears in the assistant header:
- umbrella label: `RAWCLAW`
- source chip:
  - resolved agent label
  - model short name

Resolution rules implemented:
1. use `AgentProfile.name` when `message.agentId` matches a loaded profile
2. otherwise apply the reserved mapping
3. otherwise humanize the raw id with underscore/hyphen replacement and truncation

Reserved mapping implemented:
- `main` -> `Main Agent`
- `app_builder` / `app-builder` -> `App Builder`
- `research_agent` / `research-agent` -> `Research Agent`
- `automation_worker` / `automation-worker` -> `Automation`

Streaming rule implemented:
- source chip is seeded at assistant-message creation time
- it does **not** update mid-stream in v1

This matches the plan and explicitly keeps multi-agent mid-stream visualization out of this sprint.

---

### 5. Lightweight memory visibility

Implemented in:
- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/components/chat/messageMetadataUtils.ts`

What changed:
- replaced the default `RECALLED` chip + bulky memory block behavior with a compact memory summary
- summary format now follows the plan:
  - `Used memory: {name1}, {name2}, {name3}`
  - `+N more` when needed
- when detailed names are unavailable, UI falls back to plain `Used memory`

Interaction:
- compact summary appears in the header area
- clicking it reveals memory details below the message

Advisory events:
- left visible in their own block
- **not** merged into the memory indicator

This gets much closer to the coworker-style acknowledgment the plan called for.

---

### 6. Baseline persona fragment

Implemented in:
- `apps/api/src/prompt-catalog.service.ts`
- `apps/api/src/prompt-catalog.service.spec.ts`

Implementation choice:
- persona fragment was added in `PromptCatalogService`
- not in `Chat.tsx`
- not as a one-off append in the orchestrator

Placement:
- after `Prompt Pack`
- before `Active Workflow Guidance`
- before `Active Agent`

Intent:
- stabilize greeting tone and simple conversational posture
- avoid overriding later agent-specific instructions

This was covered by a new API-side spec test asserting section order.

---

## Tool Renderer Migration Status

Wrapped in `ToolActivityCard`:
- `BrowserResult`
- `WebSearchResult`
- `FileResult`
- `CodeResult`
- `TerminalResult`

Fallback:
- `GenericToolCard` replaces raw JSON fallback rendering

`toolResultUtils.tsx` status:
- kept:
  - `toRecord`
  - `asString`
  - `formatDuration`
  - `CollapsiblePre`
- removed from ownership:
  - old header/status presentation role

This matches the wrapper-first migration strategy from the plan.

---

## What Was Verified

### Frontend

Added:
- `apps/web/src/pages/Chat.test.tsx`

Covered by tests:
- assistant message with `content + error` renders both content and interrupted banner
- full error card stays hidden when content exists
- source chip renders agent + model
- memory summary renders in compact form and expands to details
- page-read/browser trust state renders inside the chat thread
- skipped browser results render with neutral queue-full copy
- generic tool fallback shows a truncated label with the full raw tool name in the tooltip

Command run:

```powershell
npx vitest run src/pages/Chat.test.tsx
```

Result:
- `4 passed`

### API

Added:
- baseline persona ordering test in `apps/api/src/prompt-catalog.service.spec.ts`

Command run:

```powershell
npm --workspace @rawclaw/api test -- prompt-catalog.service.spec.ts
```

Result:
- `4 passed`

---

## What Was Not Fully Completed

These are important because the plan included operational and product checks that code alone cannot satisfy from this workspace.

### 1. Production fallback fire-rate audit

Planned:
- determine which tool names currently hit the generic fallback path and how often

Status:
- **not completed from repo-only context**

Reason:
- no production telemetry/query surface was available in this session

Impact:
- `GenericToolCard` is implemented and safe
- but we do not yet know whether this is covering a frequent production path or mostly a defensive fallback

---

### 2. Visible duration pre-sprint audit

Planned:
- confirm whether `duration_ms` is meaningful across all five tool families before committing to it visually

Status:
- **not fully completed as a formal audit**

Actual implementation:
- duration remains optional
- `ToolActivityCard` renders it only when numeric and greater than zero

Impact:
- the UI is safe
- but the original operational question, “is duration consistently meaningful enough to deserve header space?”, is not fully closed

---

### 3. Formal Phase 3 live-deployment gate for v15.3 page-read fields

Planned:
- verify v15.3 trust fields in live representative main-chat results before BrowserResult migration begins

Status:
- **not completed as a live deployment verification task**

What was done instead:
- BrowserResult was implemented with conditional rendering for all trust fields
- missing fields are omitted silently
- no blank rows are rendered

Impact:
- code is safe against partial presence
- but the exact operational gate described by the plan still needs a real live-system check

---

### 4. Human qualitative gate before persona rollout

Planned:
- a named sprint owner uses RawClaw for 20 minutes and answers:
  - `Does the chat feel more like a coworker than before?`

Status:
- **not completed**

Reason:
- this requires a human product/design review, not a code patch

Impact:
- persona fragment is implemented in code
- but the plan’s intended human checkpoint still needs to happen in the real product workflow

---

## Deviations From Plan Worth Calling Out

### Browser trust rendering proceeded without waiting for a separate deployment checkpoint

This is the largest meaningful deviation.

Why:
- the backend trust fields already existed in repo code
- the frontend can render them conditionally
- implementing the UI now was lower risk than leaving the path unbuilt

Consequence:
- the UI is more capable now
- but the council should still require a live-result spot check before calling the BrowserResult trust migration fully “closed”

---

### Advisory events remain rendered

The sprint plan deferred `advisoryEvents` as full provenance storytelling work.

What I did:
- left advisory rendering visible in its existing block
- did not merge it into the new compact memory signal

Consequence:
- this avoids removing useful information
- but the chat still has two different “why this happened” surfaces rather than one unified provenance story

---

## Remaining Gaps / Council-Facing Open Items

The implementation is strong enough to use, but the council should know what is still unresolved:

1. **No production telemetry-backed fallback inventory yet**
   - we still need to know which tool names hit `GenericToolCard` in real usage

2. **No human qualitative signoff yet**
   - the planned coworker-feel checkpoint is still pending

3. **No Sprint 2 provenance storytelling yet**
   - `workflowState`, `runIds`, and `provenanceTrace` remain mostly technical rather than user-facing narrative

4. **No session-level agent continuity visualization yet**
   - source chip exists per message
   - session-level continuity and live coworker activity remain future work

---

## Recommended Council Position

### What is fair to say now

- the **core v1.2 implementation is real**
- the **highest-trust bug is fixed**
- the **chat UI now exposes more of RawClaw’s actual intelligence instead of hiding it**
- the **frontend and API changes both have targeted regression coverage**

### What is not fair to say yet

- that all operational gates in the plan are complete
- that the BrowserResult trust migration has been validated against live deployed traffic
- that the coworker-feel qualitative review has happened

---

## Suggested Council Instruction Set

If the council wants to move cleanly from implementation to acceptance, the next instruction set should be:

1. **Accept the code implementation**
   - hotfix
   - shared card shell
   - BrowserResult trust rendering
   - source chip
   - memory visibility
   - persona fragment

2. **Require three post-implementation checks before calling the sprint fully closed**
   - live page-read trust field spot check in main chat
   - fallback renderer frequency audit
   - 20-minute human coworker-feel review

3. **Then write the Sprint 2 UI spec**
   - session-level agent continuity timeline
   - live coworker sidebar activity
   - provenance storytelling
   - advisory-events integration

---

## Bottom Line

This implementation meaningfully improves trust, legibility, and emotional clarity in RawClaw’s chat UI.

It does **not** complete every operational acceptance step from the plan, but it does complete the main code work the plan called for.

If the council wants the honest one-line verdict:

**The sprint is implemented in code, verified in tests, and ready for council review — but not yet fully accepted until the live-result and human-experience gates are performed.**
