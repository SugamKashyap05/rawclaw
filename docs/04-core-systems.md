# Core Systems

## Chat system

The chat system should provide:
- normal conversational messaging
- surface flexibility across desktop, web, and future external channels
- tool use when appropriate
- verification-aware outputs
- source attribution
- graceful failure behavior

## Model routing

The model layer should support:
- local and cloud providers
- low/medium/high complexity routing
- previewable routing policy
- low-memory fallback for local models

## Gateway and session engine

RawClaw needs a first-class runtime control plane that owns:
- sessions
- routing
- presence
- heartbeat events
- health events
- automation events
- attached surfaces and future channel connectors

The session engine should support:
- isolation by sender, thread, workspace, or agent
- group safety rules and mention-based activation
- configurable reset and pruning behavior

## Configuration engine

The rebuilt system should include:
- one canonical local config file
- schema-backed validation
- interactive onboarding
- guided configuration in UI
- hot reload for safe runtime settings
- explicit restart boundaries for settings that cannot hot-apply

## Diagnostics and repair

RawClaw should expose:
- health
- status
- logs
- doctor/repair workflows
- startup validation errors with actionable fixes

## Tool execution

The tool layer should support:
- built-in tools
- MCP tools
- confirmation requirements where needed
- clear capability metadata
- runtime health checks

The tool system should also cover:
- plugin-style expansion
- search provider diversity
- media-capable tools
- browser and device-capability tools

## Output policy

Every answer should pass through a policy layer that determines:
- freshness sensitivity
- whether verification is required
- how results should be rendered
- how uncertainty should be communicated

## Media and multimodal support

RawClaw should plan for:
- images in and out
- audio in and out
- document handling
- voice transcription
- text to speech
- screenshots, recordings, and visual artifacts

## Artifacts

Task runs should produce:
- one primary final deliverable
- structured run summary
- diagnostics retained separately
- source and provenance links
