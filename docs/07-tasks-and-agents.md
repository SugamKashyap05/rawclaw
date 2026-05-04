# Tasks And Agents

## Task model

The system should distinguish between:
- task definitions
- task runs
- run steps
- artifacts

## Task run requirements

Each run should persist:
- status
- timestamps
- selected agent
- delegated workers
- sandbox metadata
- final output
- structured provenance

## Agent roles

RawClaw should support:
- orchestrator agents
- specialist agents
- worker agents

The current runtime now expresses those roles as an explicit four-stage chain for every normal request:

- Lead Strategist
- Scout
- Analyst
- Guardian

Foreground chat still executes directly through the agent, but queued research and sandbox work can be delegated to worker-backed scout and analyst roles while Guardian remains the final release gate.

## Prompt assets

RawClaw prompt assets live in [docs/prompts](/E:/2026%20final%20projects/rawclaw/docs/prompts/README.md) and should be treated as a layered stack:

- core system prompt
- tool-grounding prompt
- review/correction prompt
- task-specific prompts for research, planning, and review

This keeps persistent behavior separate from workflow-specific instructions and makes prompt tuning easier to test and version.

## Session and routing expectations

Compared with more mature gateway-native agent systems, RawClaw should also design for:
- per-sender and per-surface session routing
- isolated sessions by workspace, thread, or channel
- long-lived orchestration across recurring conversations

## Delegation goals

- the orchestrator decides when to delegate
- delegated work should be visible and attributable
- results should merge into one final output
- worker assignments, queue metadata, and guardian outcomes should be visible from Gateway and Operator surfaces
- foreground runs and queued runs should share one control-plane record shape so mixed execution stays inspectable

## Sandbox contract

Each task run should have:
- isolated inputs
- workspace
- outputs
- environment metadata

The default sandbox posture is now worker-pool-first:

- sandbox-required executions should route to the swarm worker pool by default
- if no worker is available, the system should return a structured degraded failure
- the runtime should never silently fall back to unsandboxed execution

## Scheduling

Recurring tasks should support:
- next run
- last success/failure
- retry behavior
- pause/resume
- heartbeat-style recurring agent activity for lightweight automation
