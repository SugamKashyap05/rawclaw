# Claude Review Report: Transformer Layer V1

## Scope

This report is intentionally scoped to the Transformer Layer V1 chat changes, not the entire dirty worktree.

### Files in scope

- `packages/shared/src/contracts/transformer.ts`
- `packages/shared/src/contracts/chat.ts`
- `packages/shared/src/index.ts`
- `apps/api/src/chat-transformer.service.ts`
- `apps/api/src/chat-transformer.service.spec.ts`
- `apps/api/src/chat-orchestrator.service.ts`
- `apps/api/src/chat-orchestrator-nlu-tools.spec.ts`
- `apps/api/src/chat.service.ts`
- `apps/api/src/chat.service.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/agent/src/executor.py`
- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/components/chat/WorkStoryCard.tsx`
- `apps/web/src/components/chat/WorkStoryCard.test.tsx`
- `apps/web/src/components/chat/messageMetadataUtils.ts`
- `apps/web/src/components/chat/messageMetadataUtils.test.ts`

## Findings

### 1. [P1] The latency gate test does not exercise the actual guarded path

The plan promises a CI gate on request acceptance to first non-heartbeat SSE event, but the current enforcement test only benchmarks local helper calls against a trivial object-literal baseline. It never runs the real `processAndStreamChat()` path, never opens SSE, never resolves session pipeline mode, and never measures the first emitted non-heartbeat event that the runtime actually records. That means the current CI test cannot prove the stated `+50ms p95 / +25ms median` budget in the path users hit.

Relevant references:

- [apps/api/src/chat-transformer.service.spec.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-transformer.service.spec.ts:120)
- [apps/api/src/chat-orchestrator.service.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-orchestrator.service.ts:1088)
- [apps/api/src/chat-orchestrator.service.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-orchestrator.service.ts:1719)

Why this matters:

- the policy is good, but the current test is only a regression sentinel for helper cost
- the highest-risk overhead lives in orchestration and stream startup, not just envelope construction
- a future change can pass CI and still regress the real first-token path

Suggested follow-up for Claude:

- replace or supplement the current spec with an orchestrator-level perf harness that stubs the agent and measures first non-heartbeat SSE emission end to end

### 2. [P1] `TransformTrace` is only partially wired on the agent side

The plan says agent timing should cover execution and evidence stages, but the implementation currently emits exactly one timing fragment, `model_execution`, and only when provider metadata includes `durationMs`. Tool, search, fetch, extract, and synthesis stages are not emitted. The API aggregator is correctly prepared to merge timing fragments, but the agent is not yet producing the breadth of timing data the trace contract suggests.

Relevant references:

- [apps/agent/src/executor.py](/E:/2026%20final%20projects/rawclaw/apps/agent/src/executor.py:2651)
- [apps/api/src/chat-orchestrator.service.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-orchestrator.service.ts:2072)
- [packages/shared/src/contracts/transformer.ts](/E:/2026%20final%20projects/rawclaw/packages/shared/src/contracts/transformer.ts)

Why this matters:

- trace completeness is part of the value proposition of the layer
- current traces can underreport where time actually goes on research turns
- debugging slow grounded turns will still be guessier than the contract implies

Suggested follow-up for Claude:

- decide whether V1 should explicitly document partial trace coverage, or wire tool/search/fetch/extract stage timings before the flag goes on by default

### 3. [P2] Coworker identity logic is duplicated across API and web

The reserved agent-name mapping and related label-derivation logic now live in both the API transformer service and the web fallback helper. That was a pragmatic implementation choice, but it creates a drift risk: persisted `CoworkerActivityFrame` labels and client-side fallback labels can diverge when someone updates one mapping or template set but not the other.

Relevant references:

- [apps/api/src/chat-transformer.service.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-transformer.service.ts:90)
- [apps/api/src/chat-transformer.service.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-transformer.service.ts:101)
- [apps/web/src/components/chat/messageMetadataUtils.ts](/E:/2026%20final%20projects/rawclaw/apps/web/src/components/chat/messageMetadataUtils.ts:3)

Why this matters:

- the visible source label is the main user-facing proof that V1 is live
- fallback rendering happens exactly when trust is already stressed
- a label mismatch between persisted frame and fallback UI will look flaky fast

Suggested follow-up for Claude:

- either centralize the runtime mapping/templates in a shared value-safe module, or add a contract test that asserts API and web mappings stay identical

## Open Questions / Assumptions

- I reviewed only the Transformer Layer V1 change set above, not unrelated modifications already present in the repository.
- I am assuming the current runtime-helper duplication is intentional and temporary, because the implementation note said shared value exports were unstable under the current test runners.
- I did not find an obvious correctness bug in the `activity_frame` abnormal-close fallback itself; the larger concerns are observability completeness and the realism of the perf gate.

## Release Recommendation

Do **not** enable `RAWCLAW_TRANSFORM_PIPELINE_V1` by default yet.

The implementation is real and worth keeping, but the Council verdict is right on the release boundary:

1. the latency gate is not measuring the real guarded path yet
2. the visible source-label identity can still drift between API and web fallback paths
3. `TransformTrace` currently implies broader coverage than it actually delivers on research-heavy turns

My recommendation for Claude is:

- keep the flag **off by default**
- treat the next step as a short hardening sprint, not a redesign
- block default-on until the three items above are closed or explicitly narrowed in contract language

## Council Follow-up: Concrete Default-On Blockers

### Blocker 1: Replace the fake latency gate with an orchestrator-level harness

The current helper benchmark is useful as a local regression scent, but it is **not** a trustworthy release gate.

What needs to exist before default-on:

- an agent stub that emits a synthetic SSE stream without real inference
- an orchestrator-level test that drives `processAndStreamChat()`
- measurement from request acceptance to first non-heartbeat SSE event
- CI failure when the `+50ms p95 / +25ms median` budget is exceeded

### Blocker 2: Centralize source-label mapping before users depend on it

The label mapping should move into one shared runtime-safe constants module in `packages/shared`, or at minimum be guarded by a cross-suite contract test that proves API and web resolve the same labels for the same IDs.

Right now the duplication lives here:

- [apps/api/src/chat-transformer.service.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-transformer.service.ts:90)
- [apps/web/src/components/chat/messageMetadataUtils.ts](/E:/2026%20final%20projects/rawclaw/apps/web/src/components/chat/messageMetadataUtils.ts:3)

### Blocker 3: Narrow or expand `TransformTrace` coverage honestly

Current implementation evidence:

- the API is ready to merge agent timing fragments
- the agent currently emits only a single `model_execution` fragment when `durationMs` is available

Current emission point:

- [apps/agent/src/executor.py](/E:/2026%20final%20projects/rawclaw/apps/agent/src/executor.py:2651)

That means V1 should do one of two things before default-on:

- either wire search/fetch/extract/tool timings in Python, or
- explicitly document in the shared contract that V1 trace coverage is model-execution-only

## Work Story Templates For Human Review

These are the current template anchors in implementation:

- `direct`: `Answered directly from the conversation.`
- `grounded`: `Checked {sourceCount} source{plural} and used {strongestSource} for the answer.`
- `partial`: `Found a lead in {strongestSource}, but the evidence is still incomplete.`
- `degraded`: `Tried {toolLabel}, but the result was limited because {degradationReasonLabel}.`

Source:

- [apps/api/src/chat-transformer.service.ts](/E:/2026%20final%20projects/rawclaw/apps/api/src/chat-transformer.service.ts:101)

My read:

- `direct` is fine and calm.
- `partial` is close.
- `grounded` and `degraded` are truthful, but they still read a bit like system narration rather than coworker speech.

If Claude wants a language pass before default-on, this is the place to do it.

## Change Summary

The patch adds a shared transformer contract, an API-side pre-stream transformer service, per-session pipeline latching, final SSE `activity_frame` delivery, persisted `coworkerActivityFrame` and `transformTrace` metadata, agent timing fragments, and frontend rendering that prefers normalized frames while degrading gracefully on abnormal stream termination.

It also adds coverage for:

- session pipeline latching
- persisted frame/trace metadata
- source-label rendering
- normalized work-story rendering
- degraded fallback rendering on interrupted streams
- basic transformer contract behavior and the current helper-level perf sentinel

## Verification Already Run

```powershell
npx tsc -p apps/api/tsconfig.json --noEmit --incremental false
npx tsc -p apps/web/tsconfig.json --noEmit --incremental false
python -m py_compile apps/agent/src/executor.py
npx jest src/chat-transformer.service.spec.ts src/chat.service.spec.ts src/chat-orchestrator-nlu-tools.spec.ts --runInBand --config apps/api/jest.config.cjs
npx vitest run apps/web/src/components/chat/messageMetadataUtils.test.ts apps/web/src/components/chat/WorkStoryCard.test.tsx apps/web/src/pages/Chat.test.tsx
```

## Focused Git Diff For Claude

### Diff stat

```powershell
git diff --stat -- `
  apps/agent/src/executor.py `
  apps/api/src/app.module.ts `
  apps/api/src/chat-orchestrator-nlu-tools.spec.ts `
  apps/api/src/chat-orchestrator.service.ts `
  apps/api/src/chat.service.spec.ts `
  apps/api/src/chat.service.ts `
  apps/api/src/chat-transformer.service.ts `
  apps/api/src/chat-transformer.service.spec.ts `
  apps/web/src/pages/Chat.tsx `
  apps/web/src/components/chat/WorkStoryCard.tsx `
  apps/web/src/components/chat/WorkStoryCard.test.tsx `
  apps/web/src/components/chat/messageMetadataUtils.ts `
  apps/web/src/components/chat/messageMetadataUtils.test.ts `
  packages/shared/src/contracts/chat.ts `
  packages/shared/src/contracts/transformer.ts `
  packages/shared/src/index.ts
```

### Full focused diff

```powershell
git diff -- `
  apps/agent/src/executor.py `
  apps/api/src/app.module.ts `
  apps/api/src/chat-orchestrator-nlu-tools.spec.ts `
  apps/api/src/chat-orchestrator.service.ts `
  apps/api/src/chat.service.spec.ts `
  apps/api/src/chat.service.ts `
  apps/api/src/chat-transformer.service.ts `
  apps/api/src/chat-transformer.service.spec.ts `
  apps/web/src/pages/Chat.tsx `
  apps/web/src/components/chat/WorkStoryCard.tsx `
  apps/web/src/components/chat/WorkStoryCard.test.tsx `
  apps/web/src/components/chat/messageMetadataUtils.ts `
  apps/web/src/components/chat/messageMetadataUtils.test.ts `
  packages/shared/src/contracts/chat.ts `
  packages/shared/src/contracts/transformer.ts `
  packages/shared/src/index.ts
```

### Highest-signal files first

If Claude wants a faster read order, I would start here:

1. `packages/shared/src/contracts/transformer.ts`
2. `apps/api/src/chat-transformer.service.ts`
3. `apps/api/src/chat-orchestrator.service.ts`
4. `apps/web/src/pages/Chat.tsx`
5. `apps/agent/src/executor.py`
6. `apps/api/src/chat-transformer.service.spec.ts`

## Short Hand-off Summary For Claude

Transformer Layer V1 is in place behind `RAWCLAW_TRANSFORM_PIPELINE_V1`, with session-latched rollout, API-built pre-stream envelopes, final SSE `activity_frame` delivery, persisted frame/trace metadata, and frontend fallback rendering for abnormal stream closure. The main review pressure points are whether the current perf gate is realistic enough, whether partial `TransformTrace` coverage is acceptable for V1, and whether API/web label-template duplication is okay as a temporary compromise.
