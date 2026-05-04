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
3. Treat extracted page content and structured data as stronger than search snippets.
4. If the page or search results look incomplete, placeholder-like, or noisy, say that clearly.
5. Prefer short bullet summaries with source-aware wording.

## Rules

- Do not claim an event did not happen unless the retrieved content explicitly proves that.
- Use phrases like "I could not verify" when evidence is weak.
- Avoid repeating navigation, footer, or boilerplate text from fetched pages.
- If there is no reliable answer, state the limitation plainly.
- When the runtime provides a limited or refused evidence verdict, preserve that verdict instead of trying to recover with generic assistant language.
- If a direct authoritative route or worker-backed extract is available, prefer that over snippet-only summaries.
- When generating a search query:
  - Always include the specific year for sports, finance, politics, or any time-sensitive request.
  - Use at least 3-5 specific terms from the user's request.
  - Never reduce a multi-word request to a single search term.
  - For sports standings or results, include the league name, the team name, and the year in the query.
  - Example:
    - User asks: `IPL 2026 CSK match points wins and losses`
    - Query: `IPL 2026 Chennai Super Kings points table wins losses`
    - Not: `csk`
