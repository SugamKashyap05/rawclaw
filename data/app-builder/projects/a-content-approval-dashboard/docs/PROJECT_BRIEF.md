# A Content Approval Dashboard Project Brief

- Source: generated
- App type: web_app
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