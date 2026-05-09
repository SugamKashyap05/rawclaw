# RawClaw Chat UI Browser Cleanup Report

## Summary

This pass implemented the **browser-observed chat cleanup** on top of the prior v1.2 chat work, then retested the real UI in the in-app browser at:

- `http://localhost:5173/chat`

The result is materially better:

- internal helper tools no longer leak into the default chat thread
- `WORK STORY` is now human-readable instead of blending into raw trace noise
- `LIVE WORK` no longer shows obvious junk like `Unknown Tool` or provenance heartbeat rows
- failed page reads no longer dump raw structured payloads into the main answer surface
- the previously reported fake `Agent Service Unavailable` path was **not reproduced**

However, the retest also surfaced a **new boundary**:

- the OpenAI changelog page still fails extraction in live runs, so the UI is now clean, but the underlying page-read reliability problem still exists

This report separates:

1. what was implemented
2. what the live browser retest confirmed
3. what problems still remain
4. what the Council now needs to decide

---

## What Was Implemented

### 1. Internal/meta tool output is hidden from the default thread

Implemented via:

- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/components/chat/toolVisibility.ts`

Behavior now:

- tool results whose names are clearly internal/meta are filtered out of the main assistant thread
- this includes:
  - `skill_*`
  - `unknown-tool`
- those results are no longer rendered as normal tool cards in chat

User-facing effect:

- no visible `skill_grounded-web-summary` card
- no visible `Unknown Tool` card in the main message flow

---

### 2. BrowserResult now keeps failure states readable

Implemented via:

- `apps/web/src/components/chat/BrowserResult.tsx`

Behavior now:

- when extraction succeeds, the card shows normal title / URL / trust-state / content
- when extraction fails and there is no real extracted text:
  - it shows concise failure copy:
    - `No usable page content was extracted from this page.`
  - it does **not** render `JSON.stringify(result.output)` in the default body
  - raw technical payload remains accessible only through a collapsed `Technical details` control

User-facing effect:

- failed page reads now look like understandable failures
- the chat surface is no longer flooded with raw backend payloads

---

### 3. Work Story and Trace were separated more cleanly

Implemented via:

- `apps/web/src/components/chat/WorkStoryCard.tsx`
- `apps/web/src/components/chat/ProvenanceTrace.tsx`
- `apps/web/src/components/chat/tracePresentation.ts`

Behavior now:

- `WORK STORY` uses only short, user-facing steps
- it ignores:
  - `skill_*` helper tools
  - payload-like provenance blobs
  - generic trace bookkeeping
- inline `TRACE` remains available, but payload-like summaries are sanitized into short technical labels such as:
  - `Structured tool output captured`
  - `Reviewer approved the draft`
  - `Tool error recorded`

Additional wording fix made after live retest:

- generic trace errors now map to `Reported a tool failure`
- they no longer incorrectly map to `Reported an execution limit`

User-facing effect:

- `WORK STORY` reads like a story again
- `TRACE` stays technical without shouting raw payloads into the chat

---

### 4. Live Work is now filtered and humanized

Implemented via:

- `apps/web/src/components/ChatSidebar.tsx`

Behavior now:

- section label changed from `LIVE_WORK` to `LIVE WORK`
- client-side session filtering remains in place
- low-value rows are dropped, including:
  - `unknown-tool`
  - provenance heartbeat noise
  - reviewer-approved noise
- only meaningful rows are kept:
  - active / queued / failed runs
  - page read activity
  - web search activity
  - memory captured / used
  - review requested changes

User-facing effect:

- the panel reads more like presence/activity and less like a system log

---

## Test Coverage Added

Frontend regression coverage now includes:

- `apps/web/src/pages/Chat.test.tsx`
- `apps/web/src/components/chat/BrowserResult.test.tsx`
- `apps/web/src/components/chat/WorkStoryCard.test.tsx`
- `apps/web/src/components/chat/ProvenanceTrace.test.tsx`
- `apps/web/src/components/ChatSidebar.test.tsx`

Verified by test:

- helper tools are hidden from the default chat thread
- `web_extract` still routes through `BrowserResult`
- failed BrowserResult hides raw payload from the default visible body
- Work Story ignores helper/payload-like trace data
- inline trace sanitizes payload-like summaries
- Live Work drops `Unknown Tool` and provenance noise

Command run:

```powershell
npx vitest run src/pages/Chat.test.tsx src/components/chat/BrowserResult.test.tsx src/components/chat/WorkStoryCard.test.tsx src/components/chat/ProvenanceTrace.test.tsx src/components/ChatSidebar.test.tsx
```

Result:

- `17 passed`

---

## What The Live Browser Retest Confirmed

### 1. Warm greeting path

Prompt:

- `hi`

Observed:

- warm response
- source identity still visible
- no helper-tool leak

Verdict:

- **Pass**

---

### 2. Official-source web summary path

Prompt:

- `Search the latest OpenAI API changelog and summarize it in 2 bullets.`

Observed:

- no `Agent Service Unavailable`
- no `skill_*` helper card
- no raw instruction/payload dump in the default thread
- `WORK STORY` rendered human-readable steps
- failed page reads showed concise failure copy instead of raw structured output

Verdict:

- **Pass for chat-surface cleanup**
- **Not a pass for page extraction reliability**

---

### 3. Direct page-read path

Prompt:

- `Read https://developers.openai.com/api/docs/changelog and summarize it in 2 bullets.`

Observed:

- `BrowserResult` rendered
- failure copy rendered cleanly
- `Technical details` remained collapsed
- raw payload was not visible by default
- no fake availability error

Verdict:

- **Pass for UI behavior**
- **Still failing at extraction/data acquisition**

---

### 4. Search-heavy stress query

Prompt:

- `Research the latest 8 OpenAI API changes from official sources and summarize them with dates in 5 bullets.`

Observed:

- no fake `Agent Service Unavailable`
- no `Reasoning Limit Reached`
- no `Unknown Tool` in `LIVE WORK`
- no visible helper-tool card
- answer stayed grounded/cautious when evidence was weak

Verdict:

- **Pass**

---

### 5. Status-badge flash

Observed:

- on this retest pass, the earlier false red/down badge flash was **not reproduced**

Verdict:

- no follow-up required from this pass alone

---

## Problems That Still Exist After The Cleanup

### Problem 1. OpenAI changelog extraction still fails in live use

This is the main unresolved issue.

What changed:

- the UI now handles that failure cleanly

What did **not** change:

- the actual page-read/extraction path still failed against the OpenAI changelog page in live browser testing

Meaning:

- the chat UI legibility problem is improved
- the underlying extraction reliability problem is **not** solved by this pass

This is now a backend/tooling/data-acquisition issue rather than a default chat rendering issue.

---

### Problem 2. One high-level research turn can still surface multiple failure cards

During the official-source summary flow, the UI showed multiple `BrowserResult` failure cards for the same high-level ask.

The cards were now clean and readable, but the conversation still feels a little operationally noisy when several low-level attempts fail in one turn.

This is not a raw-payload leak anymore. It is now a **product-shape question**:

- should the user see every failed extract attempt as its own card?
- or should those attempts be collapsed into one summarized page-read outcome?

---

### Problem 3. Technical details still live in the main message surface

The raw payload is no longer visible by default, which is good.

But the collapsed `Technical details` control still lives directly inside the BrowserResult card in the main chat thread.

This is now a design/product question rather than a correctness bug:

- keep technical details inline for power users
- or move them entirely into trace / provenance / a separate advanced view

---

## Council Questions / Decisions Needed

### Decision 1. Treat the changelog extraction failure as a separate incident?

The browser cleanup pass did its job. The remaining failure is extractor reliability.

The Council should decide whether to:

- open a separate page-read / extractor hardening task
- or fold that work into the next chat-surface sprint

Recommendation:

- **separate task**

Reason:

- the UI is now behaving responsibly in the presence of failure
- the remaining issue is a lower-layer retrieval/extraction problem

---

### Decision 2. Keep multiple BrowserResult cards, or collapse them?

Current state:

- each failed page-read attempt can still show its own clean BrowserResult card

Question:

- should one user ask map to one summarized page-read outcome instead of multiple low-level cards?

Recommendation:

- **collapse multiple low-level extract attempts into one summarized outcome card**

Reason:

- the raw-noise problem is fixed
- the next UX improvement is reducing repeated operational clutter

---

### Decision 3. Keep inline Technical details, or move them behind trace only?

Current state:

- `Technical details` exists inline inside failed BrowserResult cards

Question:

- is that the right place for advanced detail?

Recommendation:

- **move advanced payload inspection behind trace/provenance in a later pass unless power-user feedback says otherwise**

Reason:

- the main chat surface should stay explanation-first

---

## Recommended Council Position

Accept this pass as:

- **successful chat-surface cleanup**
- **successful browser retest against the original visible issues**

Do **not** call the changelog path fully solved.

Instead:

1. close the UI leak/noise work
2. open a separate extractor/page-read follow-up
3. decide whether multiple low-level BrowserResult attempts should remain visible or collapse into one higher-level outcome

That is the real state of the system after implementation and retest.
