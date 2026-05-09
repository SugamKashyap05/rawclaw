# RawClaw Web Page-Read Hardening v15 Implementation Report

## Scope

This report documents the implemented state of the `RawClaw Web Page-Read Hardening Plan v15` in the current workspace.

The implementation goal was to harden direct URL page reads around five areas:

1. deterministic `HTTP -> browser -> search fallback` orchestration
2. safe async browser capability caching
3. explicit evidence and backend-result ownership
4. safer browser queue handling
5. unambiguous fallback summaries and final error mapping

## Implemented Changes

### 1. Shared page-read contracts and helpers

Implemented in:

- `apps/agent/src/tools/builtin/page_read_types.py`

What is present:

- `PageReadContext`
- `PageReadResult`
- `CapabilityOutcome`
- duration, queue, and summary constants
- structural schema hashing helpers
- backend-result aggregation
- evidence classification helpers
- failure-chain summary truncation
- provenance deep-copy helper
- slug extraction helper for search fallback

Notable contract details now enforced:

- `PageReadResult.backendResult` uses `success | garbage | failed | skipped`
- `PageReadResult.evidenceStatus` uses `strong | medium | degraded | failed`
- `PageReadResult` now carries:
  - `pageType`
  - `taskType`
  - `sourceMode`
  - `fetchFailureKind`
  - `networkError`
  - `httpStatus`
  - `transportStrategy`
  - `redirectedUrl`
- failure summary uses a fixed marker reservation and caps omitted count display at `[+99 more]`
- schema hashing is structural, keeps `format`, and treats `const` and `enum` distinctly

### 2. Browser capability cache

Implemented in:

- `apps/agent/src/tools/builtin/browser_capability.py`

What is present:

- cache state with `result`, `future`, and lock
- caching for both capability present and capability absent
- transient retry handling with:
  - `BROWSER_CAPABILITY_TRANSIENT_RETRIES = 1`
  - `BROWSER_CAPABILITY_FUTURE_WAIT_TIMEOUT_S = 5.0`
- detached finalizer tasks stored in `_capability_finalizer_tasks`
- finalizer clears `future` and writes `result` only on successful computation
- timeout and transient outcomes cause a single same-call retry before uncached `False`
- runtime-shutdown `RuntimeError` during wait returns uncached `False`

Operational detail:

- test fixtures must clear `_capability_finalizer_tasks` between event loops

### 3. Browser page-read adapter

Implemented in:

- `apps/agent/src/tools/builtin/browser_page_read_adapter.py`

What is present:

- serialized browser page-read execution with semaphore capacity `1`
- queue handling for `1 active + 3 waiting`
- queue-full result shape:
  - `backendUsed = "browser"`
  - `backendResult = "skipped"`
  - `error = "browser queue full"`
- separate cleanup paths for waiting-count decrement and semaphore release
- co-located browser capability requirement via `browser_navigate` + `browser_snapshot`
- schema-aware URL field resolution for `browser_navigate`
- render wait handling via `browser_wait_for` when available, otherwise timed sleep
- snapshot extraction with typed `PageReadResult` output
- browser result metadata now includes page/task/source fields

### 4. Page-read orchestrator

Implemented in:

- `apps/agent/src/tools/builtin/page_read_orchestrator.py`

What is present:

- direct URL page-read orchestration as a single flow
- HTTP phase using `web_extract` with:
  - `allowInternalBrowserEscalation = False`
  - clamped `maxDurationMs`
- browser escalation based on weak direct evidence
- search fallback only when no direct HTTP/browser attempt produced `backendResult = "success"`
- result aggregation across attempt sequence `1=http`, `2=browser`, `3=search_fallback`
- explicit top-level fallback shape:
  - `backendUsed = "search_fallback"`
  - `backendResult = "success"`
  - `isFallback = True`
  - `fallbackAttempted = True`
  - `evidenceStatus = "degraded"`
- transport failure metadata from the HTTP phase is carried into the final result when later phases win

Important behavioral point:

- the orchestrator is now the single owner of `evidenceStatus`
- `web_extract` may still emit quality metadata, but the orchestrator computes the final evidence classification

### 5. Executor integration

Implemented in:

- `apps/agent/src/executor.py`

What is present:

- direct user-named URL `page_read` calls are routed through `PageReadOrchestrator`
- the executor injects its existing confirmed tool execution path into the orchestrator
- this preserves testability and existing tool-confirmation behavior
- fallback rendering now understands `isFallback = True` and produces explicit wording that the answer is a fallback summary, not a direct page read

Important architectural consequence:

- for orchestrated direct URL page reads, fallback no longer appears as a separate outer executor `web_search` tool path
- the executor still emits the outer `web_extract` tool call
- internal search fallback is performed inside the orchestrated `web_extract` flow

This is intentional and aligns with the plan’s requirement that page-read orchestration become the single entry point for direct URL page reads.

### 6. Existing web extraction and MCP URL gating

Implemented in:

- `apps/agent/src/tools/builtin/web_extract.py`
- `apps/agent/src/tools/mcp_tool_wrapper.py`

What is present:

- browser action tools are excluded from extractor scoring
- MCP tools tagged as not accepting URL input are excluded from page-read extraction candidates
- `web_extract` accepts:
  - `allowInternalBrowserEscalation`
  - `maxDurationMs`
- `browserEscalationSuppressed` metadata is emitted when orchestration disables internal browser escalation
- MCP wrappers now compute:
  - `accepts_url`
  - `last_schema_hash`
  - `mcp_server_id`

### 7. Local Playwright guard in `web_fetch`

Implemented in:

- `apps/agent/src/tools/builtin/web_fetch.py`

What is present:

- local Playwright fallback is skipped when MCP browser page-read capability is available
- a skipped attempt is recorded instead of silently double-attempting browser rendering

## Tests Added And Updated

### New focused test file

Added:

- `apps/agent/tests/test_page_read_hardening.py`

Coverage includes:

- browser capability cache stores confirmed `False`
- future wait timeout retries once then returns uncached `False`
- late finalizer still updates cache for next caller
- queue-full browser result shape
- schema hashing differences for `format` and `const` vs `enum`
- failure summary cap and `[+99 more]` behavior
- medium HTTP evidence maps to `success` and skips fallback
- `browser_attempted` prevents double browser calls
- provenance deep-copy isolation
- direct browser/non-URL MCP tool exclusion in `web_extract`

### Existing smoke tests updated

Updated:

- `apps/agent/tests/test_single_session_chat_smoke.py`

These updates reflect the intentional architectural change that search fallback is now internal to orchestrated `web_extract` for direct URL page reads.

## Verification Run

Executed successfully:

```powershell
python -m pytest tests/test_page_read_hardening.py tests/test_web_fetch.py tests/test_single_session_chat_smoke.py -q
```

Observed result:

- `41 passed`

## What Claude Should Verify

Suggested audit checklist for Claude:

1. Capability cache behavior
   - confirmed-absent capability is cached
   - transient future wait retries once
   - finalizer tasks hold strong references until completion

2. Direct URL orchestration behavior
   - direct URL `page_read` goes through `PageReadOrchestrator`
   - browser is called at most once per page-read context
   - search fallback triggers only when no direct success exists

3. Result contract ownership
   - orchestrator assigns final `evidenceStatus`
   - medium HTTP evidence maps to `backendResult = "success"`
   - final `ToolResult.error` is recomputed from final output, not copied from intermediate stage errors

4. Fallback reporting
   - `isFallback` answers are rendered as fallback summaries, not direct page reads
   - failure summary truncation matches the fixed reservation rule

5. Browser/MCP extractor safety
   - `browser_*` action tools are not treated as extraction backends
   - MCP tools without URL-shaped input are excluded from direct URL extraction candidates

## Known Notes

- The implementation preserves existing executor behavior by injecting the executor’s tool runner into the orchestrator, instead of letting the orchestrator call tools completely out-of-band.
- Smoke tests were updated where they previously assumed a separate top-level `web_search` tool call for direct URL fallback. That assumption is no longer true under the orchestrated design.
- Test output still shows existing upstream warnings unrelated to this hardening work:
  - deprecated Windows asyncio policy warning
  - pydantic v2 deprecation warning in existing config code
  - `datetime.utcnow()` deprecation warning in the orchestrator

## Bottom Line

The v15 page-read hardening plan is implemented in the current workspace with the intended unified orchestration behavior. The main reviewer-visible change is that direct URL fallback is now represented as an orchestrated `web_extract` result rather than a second outer `web_search` tool call.
