---
name: grounded-web-summary
description: Summarize fetched or searched web content with explicit grounding and uncertainty handling.
tags:
  - web
  - research
  - grounding
---

# Grounded Web Summary

Use this skill when the task involves current web information, fetched pages, or search results that may be partial, noisy, or conflicting.

## Workflow

1. Identify the strongest facts present in the provided tool results.
2. Separate verified facts from inference.
3. If the page or search results look incomplete, placeholder-like, or noisy, say that clearly.
4. Prefer short bullet summaries with source-aware wording.

## Rules

- Do not claim an event did not happen unless the retrieved content explicitly proves that.
- Use phrases like "I could not verify" when evidence is weak.
- Avoid repeating navigation, footer, or boilerplate text from fetched pages.
- If there is no reliable answer, state the limitation plainly.

