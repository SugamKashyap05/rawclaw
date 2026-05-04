# A Content Approval Dashboard Project Brief

- Source: generated
- App type: ai_tool
- Control mode: assist_only
- Template: web-dashboard
- Workspace: default

## Prompt

Build a content approval dashboard for a small operations team.

Requirements:
- Web app
- Responsive layout
- Main views:
  - Overview dashboard
  - Pending approvals list
  - Approved / rejected history
  - Item detail panel
- Each item should have:
  - title
  - owner
  - status
  - priority
  - submitted date
  - notes
- Actions:
  - approve item
  - reject item
  - mark urgent
  - filter by status and priority
  - search by title
- No real backend required for v1; local mock data is fine
- Keep it polished and easy to preview locally

RawClaw control:
- add SDK hooks and manifest
- expose actions:
  - list_items
  - approve_item
  - reject_item
  - mark_urgent
  - filter_items
  - get_dashboard_state
- emit events when:
  - item approved
  - item rejected
  - filters changed
- return structured state for control

Refinement:
what do you understand about this app so far?

Refinement:
tell me live agent activety

Refinement:
# A Content Approval Dashboard Plan

Interactive calculator with keypad, expression display, history, and RawClaw control hooks.

## Features
- addition
- subtraction
- multiplication
- division
- decimals
- percent
- history
- keyboard input
- approval workflow
- local preview

## Architecture
- Framework: react
- Build: vite
- SDK transport: http

Refinement:
i dont see the files in the files cheak what hapend and tell me what you wrote in plan