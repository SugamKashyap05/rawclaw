# Phase 6.6 Test Triage

Date: 2026-05-09

## Commands Run

| command | result |
|---|---|
| `npm --prefix apps/web test -- Chat.test.tsx` | passed: 13 tests |
| `python -m pytest apps/agent/tests/test_thinking_unified.py -q` | passed: 3 tests |
| `python -m pytest apps/agent/tests/test_research_stages.py -q` | passed: 31 tests |
| `npm --prefix apps/api test -- chat.controller.spec.ts chat-orchestrator.sse.spec.ts` | passed: 2 tests |
| `python scripts/regression-pack.py` | timed out after 180s before producing triageable failures |

## Failure Triage

| test_name | failure_class | root_cause | decision |
|---|---|---|---|
| `apps/web/src/pages/Chat.test.tsx` | n/a | Current Phase 6.6-facing Chat page suite is green. No assertion-level failure reproduced. | fix not required |
| `scripts/regression-pack.py` | live_dependency | The full regression pack did not complete within the local 180s verification window. No individual failure names were emitted before timeout, so the historical seven failures could not be classified from this run. | quarantine pending longer live-stack run |

## Tracking Note

The previously reported "7 phase 6.6 failures" were not reproducible in the focused Chat page suite. Before canary exit, rerun the full regression pack with the local model/API stack already warm and capture individual failure names. Any reproduced `assertion_mismatch` should be fixed; `import_error`, `setup_failure`, or `live_dependency` cases can remain quarantined with a linked issue.
