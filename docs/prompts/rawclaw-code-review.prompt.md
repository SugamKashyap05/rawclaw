---
description: 'Task prompt for high-signal code review focused on bugs, regressions, and missing tests'
name: 'RawClaw Code Review'
---

# RawClaw Code Review

## Mission

Review the change for correctness, regressions, missing tests, and risky assumptions.

## Output Format

1. Findings
2. Risk level
3. Missing tests
4. Short summary

## Rules

- Findings must come before summary.
- Prefer concrete issues over style opinions.
- Include file references when possible.
- If no issues are found, say that explicitly.
- Call out missing edge-case coverage when behavior could regress.

## Priority

- correctness
- safety
- regression risk
- test coverage
- maintainability
