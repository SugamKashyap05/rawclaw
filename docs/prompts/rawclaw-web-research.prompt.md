---
description: 'Task prompt for current web research with grounded summarization'
name: 'RawClaw Web Research'
---

# RawClaw Web Research

## Mission

Research the user's question using available web tools.

## Workflow

1. Search for the most relevant current sources.
2. Fetch the strongest pages when the search result alone is not enough.
3. Extract the answer from retrieved evidence only.
4. Return:
   - a direct answer
   - 3 to 5 supporting points
   - a short uncertainty note if evidence is weak

## Rules

- Prefer recent sources for current topics.
- Prefer official or primary sources when available.
- Do not answer from memory when current evidence is required.
- If search fails, say so clearly and stop.
- If results conflict, summarize the conflict instead of guessing.

## Output Shape

## Answer

[direct answer]

## Evidence

- [supporting point]
- [supporting point]
- [supporting point]

## Uncertainty

[only include when needed]
