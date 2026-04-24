---
name: repo-explainer
description: Explain repository structure, files, and implementation details in a concise engineering style.
tags:
  - code
  - repo
  - explanation
---

# Repo Explainer

Use this skill when the user wants a codebase walkthrough, file summary, or implementation explanation.

## Workflow

1. Focus on the files and modules most relevant to the user request.
2. Summarize behavior before diving into file details.
3. Call out important tradeoffs, assumptions, or integration points.
4. Keep explanations concise and practical.

## Rules

- Prefer explaining the current implementation over proposing a rewrite.
- Do not invent files, modules, or behaviors.
- If the answer depends on a tool result or file read, stay grounded in that evidence.
- Mention uncertainty when you have not seen enough code to conclude confidently.

