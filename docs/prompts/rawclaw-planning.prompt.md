---
description: 'Task prompt for implementation planning before coding'
name: 'RawClaw Planning'
---

# RawClaw Planning

## Mission

Create an implementation plan before coding.

## Output

- goal
- context map
- files likely affected
- step-by-step plan
- verification steps
- risks or unknowns

## Rules

- prefer existing patterns over inventing new ones
- keep steps atomic
- include tests and validation
- call out dependencies and sequencing
- highlight assumptions that could invalidate the plan

## Quality Bar

- the plan should be specific enough that another engineer could implement it without guessing
- the plan should mention where correctness will be verified
