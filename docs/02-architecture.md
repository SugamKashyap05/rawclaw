# Architecture

## High-level architecture

RawClaw will use a four-application architecture:

- `apps/web`
  - React-based UI
- `apps/api`
  - NestJS platform API
- `apps/agent`
  - FastAPI agent engine
- `apps/desktop`
  - Tauri desktop shell

Additional shared packages will support common contracts and runtime concerns.

## Control-plane direction

Compared with mature systems like OpenClaw, RawClaw should not think of itself as only a web app plus backend. It should evolve toward a local control plane with:
- one long-lived host runtime as the operational source of truth
- typed event/request contracts between clients and runtime services
- session ownership, trust, routing, and presence managed centrally
- multiple UI and communication surfaces attached to the same runtime

## Service boundaries

### Web
- renders dashboard, chat, tasks, memory, MCP, models, settings
- talks only to the platform API

### API
- owns application state and persistent platform data
- manages MCP server registry and task definitions/runs
- brokers between UI and agent engine
- should also become the host control plane for runtime status, config, trust, pairing, and channel surfaces unless a separate gateway service is introduced later

### Agent
- owns planning, execution, tool routing, synthesis, memory retrieval
- integrates with model providers and runtime tools

### Desktop
- wraps the web UI
- adds desktop-native integrations such as updater, health checks, and local shell hooks
- should later support companion behavior, local trust approval, and runtime diagnostics

## Supporting services

- Redis for session/state/queue needs
- ChromaDB for semantic memory and retrieval
- SQLite for local app state
- Docker for local services and MCP ecosystem support
- Ollama for local model execution when present

## Future gateway/control-plane capabilities

The rebuilt system should explicitly account for these missing capabilities:
- channel connectors such as WebChat, Telegram, Discord, Slack, and similar surfaces
- a typed event protocol for status, agent output, presence, health, and automation events
- a config engine with validation and hot reload
- trust and pairing flows for local and remote clients
- remote access patterns such as SSH tunnel or tailnet access
- optional device and node capabilities for camera, screen, voice, location, and browser surfaces

## Communication model

- Web -> API only
- API -> Agent for chat/task execution
- API -> MCP management
- Agent -> model providers and approved tool runtimes

As RawClaw matures, add:
- UI/desktop clients -> typed control-plane channel
- control-plane -> server-push events for live status, tasks, health, and presence
- remote clients -> authenticated access through secure local-first tunnels

## Reliability expectations

- no planner/tool/model failure should crash the whole UX
- degraded states should still return structured results
- system health should be visible from the UI
- invalid config should fail loudly and diagnostically, not half-boot
- repair tooling should exist for common broken local states
