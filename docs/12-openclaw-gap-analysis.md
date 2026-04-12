# Deep Strategic Gap Analysis: RawClaw vs. OpenClaw (2026)

## Overview
This document evaluates the RawClaw rebuild (Phase 0-2) against **OpenClaw (v2026.1.29)**. OpenClaw is the current benchmark for local-first AI agents, but its architecture suffers from severe security vulnerabilities and operational "black-box" behavior. RawClaw's goal is to close capability gaps while maintaining its core differentiators: **Task Provenance** and **Security by Default**.

---

## Dimension Breakdown

### DIMENSION 1 — RUNTIME MODEL
- **OpenClaw Approach**: Single persistent process, always-on, event-driven, daemonized.
- **RawClaw P0-P2 State**: Request/response API model, 4 separate processes, user-initiated.
- **Gap Rating**: SIGNIFICANT
- **Gap Description**: RawClaw currently lacks a "Daemon Mode" to handle cron triggers, webhooks, or 24/7 background reasoning without an active UI session.
- **Recommendation**: **ADAPT**.
- **Rationale**: Separation of API (NestJS) and Agent (FastAPI) is superior for scaling and security boundaries, but the Agent needs a background runner.
- **Action items**:
  1. [PHASE 6] Introduce `DaemonService` in `apps/agent/src/services/daemon.py` for headless background tasks.

### DIMENSION 2 — USER INTERFACE / SURFACES
- **OpenClaw Approach**: Messaging apps (WhatsApp, Telegram, etc.) ARE the UI.
- **RawClaw P0-P2 State**: Custom React/Vite UI + Tauri Desktop shell.
- **Gap Rating**: MINOR
- **Gap Description**: No "Headless Control" via common messaging platforms.
- **Recommendation**: **DEFER**.
- **Rationale**: RawClaw's strength is its custom desktop command center; messaging adapters are commodity features to be added later.
- **Action items**:
  1. [PHASE 6] Design `SurfaceAdapter` interface in `packages/shared` for future channel integrations.

### DIMENSION 3 — SKILLS / TOOL SYSTEM
- **OpenClaw Approach**: `SKILL.md` directories, 5k+ community skills, context-scoped precedence.
- **RawClaw P0-P2 State**: Basic `ToolRegistry`; MCP (Model Context Protocol) planned for Phase 3.
- **Gap Rating**: SIGNIFICANT
- **Gap Description**: Lack of a decentralized registry or interoperability with OpenClaw's massive skill library.
- **Recommendation**: **ADAPT**.
- **Rationale**: MCP is the technical future, but OpenClaw's `SKILL.md` is the content standard. Use MCP for execution and `SKILL.md` for discovery.
- **Action items**:
  1. [PHASE 3] Implement `SkillLoader` that supports both native MCP and OpenClaw `SKILL.md` meta-wrappers.

### DIMENSION 4 — MEMORY SYSTEM
- **OpenClaw Approach**: `SOUL.md`, `USER.md` identity files injected into context; vector retrieval.
- **RawClaw P0-P2 State**: Redis for short-term, Prisma for messages, ChromaDB planned for Phase 5.
- **Gap Rating**: SIGNIFICANT
- **Gap Description**: RawClaw lacks human-inspectable "Soul" files; memory is purely database-driven.
- **Recommendation**: **ADAPT**.
- **Rationale**: Database is required for scale, but identity should be human-writable in Markdown.
- **Action items**:
  1. [PHASE 5] Implement "Identity Sync" between `config/identity/*.md` and ChromaDB.

### DIMENSION 5 — MODEL ROUTING
- **OpenClaw Approach**: Unified BYOK interface, health-aware switching across 22+ providers.
- **RawClaw P0-P2 State**: `ModelRouter` with complexity-based routing (low/medium/high).
- **Gap Rating**: MINOR
- **Gap Description**: Complexity mapping is powerful but currently lacks provider-specific override granularity.
- **Recommendation**: **ADAPT**.
- **Rationale**: RawClaw's abstraction (Complexity vs Provider) is a better UX.
- **Action items**:
  1. [PHASE 3] Expand `router.py` to support `preferred_provider` flags in `ChatRequest`.

### DIMENSION 6 — SECURITY MODEL
- **OpenClaw Approach**: Insecure defaults, root access, major CVEs (RCE in WebSocket).
- **RawClaw P0-P2 State**: Tool confirmation logic documented; architectural boundaries enforced.
- **Gap Rating**: **CRITICAL**
- **Gap Description**: Actual OS-level sandboxing (Docker/Wasm) for tool execution is not yet implemented.
- **Recommendation**: **ADAPT**.
- **Rationale**: RawClaw’s core pitch is "Local AI that won't delete your home dir."
- **Action items**:
  1. [PHASE 3] MUST implement `sandbox.py` utilizing Docker containers for filesystem-affecting tools.

### DIMENSION 7 — SESSION AND ROUTING
- **OpenClaw Approach**: Per-sender, per-channel session isolation by design.
- **RawClaw P0-P2 State**: Basic `sessionId` mapping to SQLite rows.
- **Gap Rating**: SIGNIFICANT
- **Gap Description**: No logic for multiple workspaces or "Owner/Sender" validation.
- **Recommendation**: **ADOPT**.
- **Rationale**: Multi-surface future requires identifying WHICH user on WHICH device is talking.
- **Action items**:
  1. [PHASE 3] Update `prisma/schema.prisma` with `workspaceId` and `senderIdentifier`.

### DIMENSION 8 — OPERATIONS AND DIAGNOSTICS
- **OpenClaw Approach**: `openclaw doctor` command for quick troubleshooting.
- **RawClaw P0-P2 State**: Basic `/health` endpoints.
- **Gap Rating**: SIGNIFICANT
- **Gap Description**: Nobody noticed the 0-byte DB during Phase 2; system was "half-dead" but looked alive.
- **Recommendation**: **ADOPT**.
- **Rationale**: If developer/operators can't fix it in 30 seconds, they will leave.
- **Action items**:
  1. [PHASE 2 FINAL] Create `scripts/doctor.ps1` for local environment verification.

### DIMENSION 9 — DEPLOYMENT AND SETUP
- **OpenClaw Approach**: Single `docker-compose up -d` for end-to-end.
- **RawClaw P0-P2 State**: Multi-repo setup, manual environment config, manual prisma push.
- **Gap Rating**: SIGNIFICANT
- **Gap Description**: Extremely high barrier to entry for new developers.
- **Recommendation**: **ADOPT**.
- **Rationale**: Setup is the first interaction; it must be flawless.
- **Action items**:
  1. [PHASE 2 FINAL] Create a root-level `setup.sh` that automates `npm install`, `.env` creation, and DB migration.

### DIMENSION 10 — PROVENANCE AND ARTIFACTS
- **OpenClaw Approach**: No first-class provenance; task logs are ephemeral.
- **RawClaw P0-P2 State**: First-class Task/Run/Step model planned for Phase 4.
- **Gap Rating**: **LEAD (NONE)**
- **Gap Description**: RawClaw's architecture is fundamentally more advanced in this area.
- **Recommendation**: **REJECT** (Keep our model).
- **Rationale**: This is why users will switch from OpenClaw to RawClaw.
- **Action items**:
  1. [PHASE 3] Prototype `ProvenanceTrace` during tool execution to seed the Phase 4 work.

---

## Final Review: The Moat
RawClaw wins by being the **Secure, Inspectable, Desktop-First** alternative. While OpenClaw owns the "Messaging/Automation" space, its security failures make it unusable for enterprise or sensitive local work. RawClaw must double-down on **Dimension 6 (Security)** and **Dimension 10 (Provenance)**.
