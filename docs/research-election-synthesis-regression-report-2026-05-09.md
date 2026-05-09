# Research Election Synthesis Regression Report

Date: 2026-05-09

## Scope

This report captures the current West Bengal 2026 election research regression after the planner-bias fix.

The latest screenshot indicates:

- the query is now clean
- `web_search` fires before `web_extract`
- two `web_extract` calls still run
- the final answer still says the evidence was not enough
- `Strongest source signals:` is still empty

That means the original ECI-planner-bias bug is improved, but there is still a downstream failure somewhere between:

1. `web_search` returning results
2. `web_extract` returning page output
3. evidence record construction
4. answerability gating
5. fallback/final synthesis rendering

## Council Questions

These are the concrete questions the Council asked to resolve before the next implementation session.

### Adversary

- Is extracted content being silently dropped between `web_extract` and synthesis?
- Is the synthesis stage judging with the evidence in hand, or falling back without it?

### Strategist

- Is the verdict truthful because the extracted pages were genuinely weak?
- Or is the synthesis stage receiving malformed or empty extraction input?

### Scientist

- For each `web_extract`, what are:
  - URL
  - extracted content length
  - quality-gate pass/fail result
  - quality-gate reason
- Are we in one of these states:
  - network failure
  - extraction success
  - extraction partial
  - extraction empty

### Visionary

- Are we extracting the wrong pages entirely, such as pre-election coverage instead of post-result reporting?
- Do search results need stronger post-result temporal bias?

### Engineer

- Where do `web_extract` results enter synthesis?
- What does the evidence quality gate actually check?
- Is "not enough evidence" decided by the agent or the API orchestrator?
- What exactly does the synthesis/fallback formatter read?

### Philosopher

- What changed between the earlier working West Bengal turn and this failing turn?
- Is this a regression from recent research-path or safety/emission work?

### Humanist

- Why does the UI still show an empty `Strongest source signals:` section?
- Why is the system not using a more honest failure message while debugging continues?

## Code Packet

### 1. `web_extract` result handler: extraction output entering the evidence pipeline

File: `apps/agent/src/executor.py`

The extraction phase preserves:

- the raw `ToolResult`
- a fetch-quality summary
- the evidence gate output
- the fetch status

```py
fetch_quality = self._classify_fetch_quality(latest_user_query, attempted_fetch)

if fetch_quality == "fetch_extract_clean":
    fetch_result_phase = attempted_fetch
    fetch_status_phase = str(((attempted_fetch.output or {}) if isinstance(attempted_fetch.output, dict) else {}).get("quality") or "ok")
    break

if not attempted_fetch.error and fetch_quality not in {"fetch_irrelevant", "fetch_failed"}:
    fallback_fetch_result = attempted_fetch
    fallback_fetch_status = str(
        ((attempted_fetch.output or {}) if isinstance(attempted_fetch.output, dict) else {}).get("quality")
        or fetch_quality
        or "attempted"
    )

...

extraction_summary_phase = self._extract_quality_summary(fetch_result_phase)
evidence_gate_phase = self._extract_evidence_gate(latest_user_query, fetch_result_phase)
```

Relevant location:

- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:6916>)

### 2. `web_extract` to evidence records: how content is turned into synthesis inputs

File: `apps/agent/src/executor.py`

`_build_research_evidence_records(...)` converts both search snippets and extracted page content into normalized records. The extracted page content is not fed into synthesis raw; it is converted into scored evidence records first.

```py
if fetch_result and not fetch_result.error and isinstance(fetch_result.output, dict):
    fetch_output = fetch_result.output
    fetch_title = str(fetch_output.get("title") or "").strip()
    fetch_url = str(fetch_result.source_url or fetch_output.get("url") or "").strip()
    fetch_content = self._normalize_snippet(fetch_output.get("content", ""), 1800)
    fetch_quality = self._classify_fetch_quality(query, fetch_result)
    structured_data = fetch_output.get("structuredData") if isinstance(fetch_output.get("structuredData"), dict) else {}
```

If `structured_data` exists, records are built from it. Otherwise claims are extracted from normalized page text and scored for relevance, dates, numbers, rankings, and change markers.

Relevant location:

- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:4626>)

### 3. Evidence quality gate: what "not enough evidence" actually checks

File: `apps/agent/src/executor.py`

The gate does not just look for non-empty content. It checks:

- extraction `tier`
- extraction `confidence`
- `wordCount`
- structured field count
- missing fields
- date signals
- numeric signals
- page type
- source mode
- whether the query needs current numeric evidence

```py
quality = self._extract_quality_summary(fetch_result)
...
structured_data = output.get("structuredData") if isinstance(output.get("structuredData"), dict) else {}
missing_fields = [str(item) for item in (output.get("missingFields") or []) if str(item)]
...
if self._query_needs_numeric_current_evidence(query):
    evidence_text = " ".join([
        str(output.get("title") or ""),
        str(output.get("content") or ""),
        json.dumps(structured_data, default=str),
    ])
    has_date_signal = self._text_has_date_signal(evidence_text)
    has_number_signal = self._text_has_number_signal(evidence_text)
    if word_count < 150 and not (has_date_signal and has_number_signal and explicit_structured_fields):
        return {
            "mode": "ABSTAIN",
            "reason": "the page did not expose enough dated numeric evidence for the requested current count",
        }
```

Later branches return `PROCEED_FULL`, `PROCEED_CAUTIOUS`, or `ABSTAIN`.

Relevant locations:

- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:443>)
- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:1068>)

### 4. Answerability logic: where evidence can still be downgraded after extraction

File: `apps/agent/src/executor.py`

Even when search and extract succeed, `_evaluate_answerability(...)` can still decide:

- `sufficient`
- `partial`
- `abstain`

For general research, it uses:

- trustworthy records
- synthetic/official records
- extraction gate result
- corroboration mode
- freshness summary

```py
result = {
    "relevant": bool(evidence) or fetch_quality not in {"not_attempted", "fetch_failed", "fetch_irrelevant"},
    "usable": bool(usable_records),
    "sufficient": False,
    "partial": False,
    "abstain": False,
    "fetch_quality": fetch_quality,
    "reasons": [],
    "extraction_gate": extraction_gate,
    "evidence_breakdown": evidence_breakdown,
    "corroboration_mode": corroboration_mode,
    "freshness_summary": freshness_summary,
}
```

For the default category path:

```py
if extraction_gate["mode"] == "PROCEED_FULL":
    result["sufficient"] = bool(trustworthy_records or structured_data)
    result["partial"] = not result["sufficient"] and bool(usable_records)
    result["abstain"] = not result["sufficient"] and not result["partial"]
elif extraction_gate["mode"] == "PROCEED_CAUTIOUS":
    result["sufficient"] = False
    result["partial"] = bool(usable_records or structured_data or fetch_result)
    result["abstain"] = not result["partial"]
else:
    result["abstain"] = True
```

Relevant location:

- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:4816>)

### 5. Search ranking: where temporally wrong pages can still enter extraction

File: `apps/agent/src/executor.py`

Search results are scored with content relevance, source quality, recency hints, election-result terms, and source-profile penalties.

```py
if plan["recency_matters"] and any(marker in haystack for marker in ["2026", "latest", "updated", "current", "today", "april"]):
    score += 3
...
if is_election_query and any(marker in haystack for marker in ["election", "assembly", "result", "results", "winner", "won", "seat tally", "seats"]):
    score += 8
```

There is some recency handling, but it is heuristic, not an explicit post-result date filter.

Relevant location:

- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:4189>)

### 6. Failure formatter: where the empty section is produced

File: `apps/agent/src/executor.py`

The failure message and `Strongest source signals:` section are generated in the agent, not the API orchestrator.

```py
if evidence_state == "no_results":
    lines.append("- Search results did not return strong, clearly relevant evidence for this question.")
else:
    lines.append(f"- What I found was not enough: {blocker}.")
    if found_lines:
        lines.append("- Strongest source signals:")
        lines.extend(found_lines[:3])
```

Relevant location:

- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:5277>)

### 7. API orchestrator role: it relays/classifies, it does not author the string

File: `apps/api/src/chat-orchestrator.service.ts`

The API-side research strength classifier only inspects the final assistant text. It does not create the `"not enough evidence"` message.

```ts
if (lowered.includes('could not verify') || lowered.includes('not enough evidence') || lowered.includes('uncertain')) return 'limited';
```

Relevant location:

- [chat-orchestrator.service.ts](</E:/2026 final projects/rawclaw/apps/api/src/chat-orchestrator.service.ts:2797>)

## Strong Regression Candidate Found During Code Review

This is the most important finding in the packet.

In `_render_grounded_web_answer(...)`, the abstain path appears to call `_build_graceful_research_failure(...)` with the wrong positional arguments:

```py
if answerability_mode == "abstain":
    return self._build_graceful_research_failure(
        query,
        evidence,
        fetch_result if relevant_fetch else None,
        plan,
        search_status,
        fetch_status,
        assessment_reasons,
    )
```

But `_build_graceful_research_failure(...)` expects:

```py
def _build_graceful_research_failure(
    self,
    query: str,
    evidence: List[Dict[str, str]],
    fetch_result: Optional[ToolResult],
    plan: Dict[str, Any],
    search_status: str,
    fetch_status: str,
    evidence_state: ResearchEvidenceState,
    reasons: Optional[List[str]] = None,
) -> str:
```

That means `assessment_reasons` is being passed into the `evidence_state` slot by position.

Impact:

- `evidence_state == "extraction_failed"` will never match in that path
- `evidence_state == "no_results"` will never match in that path
- the formatter can fall into the generic `"What I found was not enough..."` branch even when a more specific failure state exists

This does not prove the entire root cause, but it is a precise regression candidate and should be investigated first.

Relevant locations:

- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:5277>)
- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:5825>)
- [executor.py](</E:/2026 final projects/rawclaw/apps/agent/src/executor.py:6011>)

## What We Can Answer Already

### Is the retrieval guard the likely cause?

No, not as the leading suspect.

A runtime-equivalent API-side tool-selection probe for the failing West Bengal query returned:

- `skill_grounded-web-summary`
- `web_search`
- `web_extract`
- `read_file`

So the research tool offer path is present.

### Is the "not enough evidence" string coming from the orchestrator?

No.

The API orchestrator only classifies the returned text as `grounded` or `limited`. The actual failure wording is authored in the agent executor.

### Do we have persisted logs from the earlier working session to diff?

Not in the repo workspace.

Observed state:

- `apps/agent/run_stdout.log` is empty
- `apps/agent/run_stderr.log` is empty
- no session-specific West Bengal research logs were found in workspace files

So the earlier working session is not currently available for log diffing from disk.

## What Is Still Missing

The Council asked for three runtime values per `web_extract` call on one failing turn:

- `url`
- `content_length_chars`
- `passed_quality_gate`
- `quality_gate_reason`

Those are not currently emitted in one clean diagnostic log line.

There is trace metadata for extraction and evidence gating, but not the exact Council-requested tuple in a single reproducible record.

## Recommended Next Instrumentation

Before the next implementation session, add one temporary debug log in the extraction phase after each `web_extract` returns:

```py
logger.debug(
    "research_extract_diagnostic",
    extra={
        "url": candidate_url,
        "content_length_chars": len(str(attempted_output.get("content") or "")),
        "passed_quality_gate": evidence_gate_phase.get("mode") != "ABSTAIN",
        "quality_gate_mode": evidence_gate_phase.get("mode"),
        "quality_gate_reason": evidence_gate_phase.get("reason"),
        "word_count": extraction_summary_phase.get("wordCount"),
        "tier": extraction_summary_phase.get("tier"),
    },
)
```

That will distinguish:

- extraction succeeded but synthesis/formatting downgraded it
- extraction returned weak content and the gate correctly abstained
- search selected temporally wrong pages

## Practical Interpretation

The current state looks like this:

1. planner bias fix worked
2. search now runs first
3. extraction is attempted
4. evidence still gets downgraded before a usable answer is rendered
5. there is a concrete regression candidate in the abstain formatter call signature

## Suggested Order for the Next Fix Session

1. instrument per-extract diagnostic logging
2. reproduce the failing West Bengal query once
3. confirm whether extracted pages have real content and whether the gate abstains
4. fix the positional `evidence_state` call mismatch in the abstain render path if reproduction confirms it affects this path
5. only then decide whether the remaining issue is:
   - bad page selection
   - over-aggressive quality gating
   - or synthesis assembly loss
