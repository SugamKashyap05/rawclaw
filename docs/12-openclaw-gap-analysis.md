# OpenClaw Gap Analysis

## Purpose

This document captures the major gaps we found by comparing the current RawClaw rebuild foundation to OpenClaw's published architecture, features, and configuration model.

It is not a copy target. It is a reality check so RawClaw's rebuild plan accounts for capability areas that mature local-first agent systems already expose.

## Sources reviewed

- OpenClaw overview and docs hubs
- OpenClaw gateway architecture
- OpenClaw feature list
- OpenClaw configuration model

## Major gaps

### 1. Control-plane / gateway model

OpenClaw explicitly treats a single host gateway as the source of truth for:
- sessions
- routing
- channel connections
- live events
- automation

RawClaw currently documents separate web, API, agent, and desktop apps well, but was under-specifying the long-lived control-plane model that ties everything together.

### 2. Channel and surface breadth

OpenClaw is designed around many communication surfaces:
- WebChat
- Telegram
- Discord
- Slack
- Signal
- WhatsApp
- more via plugins

RawClaw's foundation was still centered on its own desktop/web surfaces. The rebuild docs needed to explicitly leave room for channel connectors and multi-surface session routing.

### 3. Configuration engine maturity

OpenClaw has:
- an onboarding wizard
- config CLI
- Control UI forms generated from schema
- strict config validation
- hot reload for many runtime settings

RawClaw's rebuild docs mentioned settings and environment setup, but they did not yet define a canonical config system with schema-driven tooling and runtime-safe reload behavior.

### 4. Diagnostics and repair

OpenClaw documents diagnostic commands and repair flows such as doctor, logs, health, and status when config is broken.

RawClaw's docs talked about reliability, but they did not yet elevate guided diagnostics and repair workflows to first-class product features.

### 5. Security, trust, and pairing

OpenClaw documents:
- device identity
- pairing approval
- trust tokens
- local vs remote trust rules
- tunnel and tailnet access

RawClaw's current foundation did not yet explicitly define trust/pairing flows for future desktop, web, remote, or node clients.

### 6. Typed runtime protocol

OpenClaw publishes a typed WebSocket contract with request/response/event semantics and generated schema/code models.

RawClaw's rebuild docs need a stronger commitment to typed live runtime contracts so desktop, web, API, agent, and future remote clients stay coherent.

### 7. Mobile and node capabilities

OpenClaw includes node/device concepts with capabilities like:
- camera
- screen recording
- location
- voice
- canvas

RawClaw does not need to build all of that immediately, but the foundation should acknowledge future node-capability surfaces so the architecture does not close that door.

### 8. Media and voice breadth

OpenClaw publicly lists:
- images
- audio
- video
- documents
- transcription
- text-to-speech

RawClaw's docs already mention artifacts and browser evidence, but they needed broader multimodal planning.

### 9. Session sophistication

OpenClaw explicitly separates session scope by sender, thread, workspace, and surface.

RawClaw's rebuild docs needed to state session-scope design more clearly, especially once chat expands beyond one local UI.

### 10. Operations ergonomics

OpenClaw highlights:
- onboarding
- control UI
- hot reload
- troubleshooting
- remote access

RawClaw's rebuild foundation needed more operator-focused guidance, not just developer architecture.

## What RawClaw should adopt

RawClaw should explicitly adopt these directions:

1. A local control-plane or gateway model
2. A canonical config file plus schema tooling
3. Guided onboarding and diagnostics
4. Typed live protocol contracts
5. Session routing by sender, thread, workspace, and agent
6. A broader surface strategy beyond only desktop/web
7. Trust and pairing flows for future remote access
8. Multimodal planning for media and voice

## What RawClaw should not copy blindly

RawClaw should stay focused on its own strengths:
- stronger task provenance
- explicit artifact model
- task-first operator UX
- MCP-first tool orchestration
- local desktop command-center experience

The goal is not to become OpenClaw. The goal is to ensure the RawClaw rebuild does not miss important architectural categories that OpenClaw already proves matter in practice.

## Recommended incorporation order

### Near-term
- control-plane model
- schema-driven config plan
- diagnostics/doctor plan
- session-scope model

### Mid-term
- broader surfaces/channels
- remote trust and pairing
- typed live event protocol

### Long-term
- node/device capabilities
- multimodal and voice expansion

