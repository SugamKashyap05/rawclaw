# RawClaw Web Page-Read Hardening v15.2 Review Report

## Summary

This report documents the current implemented state of the recent page-read hardening work, plus the small but real follow-up bugs that surfaced immediately after the main pass.

The big work was the `v15` / `v15.2` direct-URL page-read hardening effort:

1. unify direct URL reads behind orchestrated `web_extract`
2. make `HTTP -> browser -> search fallback` deterministic
3. harden browser capability caching and queue behavior
4. clarify result/evidence ownership and redirect semantics
5. shrink provenance to compact reviewer-relevant metadata

After that work landed, one user-facing routing bug and a few contract leaks showed up. Those follow-up issues are now fixed in the current workspace.

## Big Work Implemented

### 1. Shared contracts and helpers

Implemented in:

- `apps/agent/src/tools/builtin/page_read_types.py`

Current state:

- `PageReadContext`, `PageReadResult`, and `CapabilityOutcome` are present
- page-read constants now include:
  - `DEFAULT_MIN_CONTENT_CHARS = 200`
  - `MIN_USEFUL_CONTENT_CHARS = DEFAULT_MIN_CONTENT_CHARS`
  - `PAGE_READ_FAILURE_SUMMARY_MAX_CHARS = 200`
  - `PAGE_READ_FAILURE_MARKER_RESERVE_CHARS = len("[+99 more]")`
- `FetchFailureKind` is now a typed `Literal[...]` for current wire-compatible failure kinds
- `normalize_redirected_url(requested, final)` exists and is the shared redirect-normalization helper
- schema hashing is explicitly documented as structural, not semantic
- provenance extraction is compact rather than full-output deep-copy

Notable contract behavior now enforced:

- `backendResult` uses `success | garbage | failed | skipped`
- `evidenceStatus` uses `strong | medium | degraded | failed`
- `redirectedUrl` is now the public final-destination field and is `None` when the final URL is effectively the same as the requested URL after normalization

### 2. Browser adapter and capability flow

Implemented in:

- `apps/agent/src/tools/builtin/browser_page_read_adapter.py`
- `apps/agent/src/tools/builtin/browser_capability.py`

Current state:

- browser page reads remain serialized
- queue remains `1 active + 3 waiting`
- nested cleanup structure is preserved:
  - outer `finally` for waiting-count cleanup
  - inner `finally` for semaphore release
- browser results now use the shared redirect-normalization contract
- browser capability checks remain cached and retried as designed

### 3. Orchestrated direct URL page reads

Implemented in:

- `apps/agent/src/tools/builtin/page_read_orchestrator.py`
- `apps/agent/src/tools/builtin/web_fetch.py`
- `apps/agent/src/tools/builtin/web_extract.py`

Current state:

- direct URL page reads still go through a single orchestrated `web_extract` path
- HTTP results are mapped using existing `web_extract` quality metadata rather than a second invented classifier
- non-empty weak direct content can now map cleanly to `garbage`
- redirect metadata is normalized consistently across HTTP and browser paths
- `browserEscalationSuppressed` is now diagnostic-only and no longer feeds weak-signal classification

### 4. Executor routing and rendering

Implemented in:

- `apps/agent/src/executor.py`

Current state:

- page-read orchestration remains integrated through the executor tool path
- fallback rendering continues to distinguish direct page reads from fallback summaries
- direct URL routing now correctly prefers `web_extract` over `read_file`

## Follow-up Bugs Found After The Main Pass

### 1. Bare `Read https://...` prompts were misrouted to `read_file`

Observed symptom:

- a prompt such as `Read https://example.com/ and tell me what is on the page`
- produced a `read_file` tool call
- failed with a local-path access error

Root cause:

- in `Executor._maybe_force_tool_call()`, the `"read ..."` fast-path ran before the direct-URL fast-path
- a dotted URL token like `https://example.com/` was treated as a file path candidate

Fix applied:

- `read the contents of ...` and `read ...` now short-circuit to `web_extract` when the target begins with `http://` or `https://`
- `read_file` scoring no longer gets boosted for URL-bearing prompts
- URL-bearing prompts now get a strong scoring bias toward `web_extract`

Files:

- `apps/agent/src/executor.py`
- `apps/agent/tests/test_workflow_matrix.py`

### 2. `browserEscalationSuppressed` still affected weak-signal logic

Observed issue:

- the field was supposed to be diagnostic-only after orchestration ownership was clarified
- but `has_weak_signal()` still read it

Fix applied:

- removed `browserEscalationSuppressed` from `has_weak_signal()`
- left it emitted only as diagnostic metadata
- added an inline comment forbidding it from influencing evidence classification, fallback decisions, or rendering

Files:

- `apps/agent/src/tools/builtin/page_read_types.py`
- `apps/agent/src/tools/builtin/web_extract.py`

### 3. Redirect metadata contract was too loose

Observed issue:

- `redirectedUrl` could be repopulated from the original URL or fallback URL fields
- this made unchanged URLs look like redirects

Fix applied:

- added `normalize_redirected_url()`
- applied it in shared contract code, browser adapter, HTTP fetch path, and orchestrator mapping
- stopped repopulating `redirectedUrl` from generic `url` fields when there was no real redirect

Files:

- `apps/agent/src/tools/builtin/page_read_types.py`
- `apps/agent/src/tools/builtin/browser_page_read_adapter.py`
- `apps/agent/src/tools/builtin/web_fetch.py`
- `apps/agent/src/tools/builtin/page_read_orchestrator.py`
- `apps/agent/src/tools/builtin/web_extract.py`

### 4. Provenance hints were still too broad

Observed issue:

- provenance deep-copy behavior still included large orchestration arrays and did not reflect the compact contract

Fix applied:

- `provenance_subset()` now copies only compact provenance fields
- it no longer reads `backendAttempts` or `failureChain`
- it excludes large output fields such as page content

Files:

- `apps/agent/src/tools/builtin/page_read_types.py`
- `apps/agent/tests/test_page_read_hardening.py`

### 5. Failure-summary marker reservation was still hardcoded

Observed issue:

- the summary marker reserve was a literal `12`

Fix applied:

- replaced it with `len("[+99 more]")`
- added tests against the named constants

Files:

- `apps/agent/src/tools/builtin/page_read_types.py`
- `apps/agent/tests/test_page_read_hardening.py`

### 6. `datetime.utcnow()` warning remained in the orchestrator

Observed issue:

- targeted page-read tests still surfaced a deprecation warning from `page_read_orchestrator.py`

Fix applied:

- replaced `datetime.utcnow().year` with `datetime.now(timezone.utc).year`

Files:

- `apps/agent/src/tools/builtin/page_read_orchestrator.py`

## Tests Added Or Strengthened

### `apps/agent/tests/test_page_read_hardening.py`

Coverage now includes:

- redirect normalization:
  - trailing slash equivalence
  - case equivalence
  - genuine redirect preservation
- compact provenance behavior:
  - excludes `content`
  - excludes large orchestration arrays
  - does not require attempt arrays to exist
- `MIN_USEFUL_CONTENT_CHARS` boundary behavior via browser content classification
- long blocked page content still mapping to `garbage`
- browser snapshot failure releasing the semaphore and allowing the next queued request to succeed
- `browserEscalationSuppressed` non-interference with strong evidence
- failure summary exact-length truncation against named constants
- executor branching still using `fetchFailureKind` rather than `networkError`

### `apps/agent/tests/test_workflow_matrix.py`

Coverage now includes:

- regression guard for:
  - `Read https://example.com/ and tell me what is on the page.`
  - routing to `web_extract`
  - not routing to `read_file`

### `apps/agent/tests/test_single_session_chat_smoke.py`

Coverage now includes:

- direct URL page-read smoke guard now asserts:
  - at least one `web_extract` call occurred
  - no top-level `web_search` call was emitted for the direct URL path

## Verification Run

Executed successfully:

```powershell
python -m pytest tests/test_workflow_matrix.py tests/test_single_session_chat_smoke.py tests/test_page_read_hardening.py tests/test_web_fetch.py -q
```

Observed result:

- `74 passed`

## What Claude Should Review

Suggested review checklist:

1. Direct URL routing
   - confirm `Read https://...` can no longer fall into `read_file`
   - confirm URL-bearing prompts now score toward `web_extract`

2. Redirect contract
   - confirm `redirectedUrl` is only populated for genuine final-destination redirects
   - confirm unchanged URLs normalize to `None`

3. Evidence and garbage mapping
   - confirm the orchestrator uses existing `web_extract` quality metadata
   - confirm non-empty blocked/sparse/garbage evidence maps to `backendResult="garbage"`

4. Diagnostic-only suppression
   - confirm `browserEscalationSuppressed` is no longer consumed by weak-signal classification

5. Provenance compactness
   - confirm `provenance_subset()` excludes content and large orchestration arrays

6. Browser recovery
   - confirm browser snapshot exceptions still release the semaphore and unblock the next request

## Remaining Small Non-Blocking Notes

These warnings still appear in the targeted test run and are not part of this page-read work:

- deprecated Windows asyncio event-loop policy warning in test setup
- pydantic v2 deprecation warning in existing `src/config.py`
- pytest cache warning caused by the current local `.pytest_cache` state

They are worth cleanup, but they are not page-read regressions.

## Bottom Line

The big page-read hardening work is implemented, and the immediate follow-up bugs that surfaced after it landed have also been fixed. The most important post-implementation fix was the `Read https://...` routing bug, which previously prevented the hardened page-read stack from running at all for a very natural user phrasing.
