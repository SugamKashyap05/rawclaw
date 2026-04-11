# MCP And Tools

## Tool strategy

RawClaw should prefer real tool execution over unsupported reasoning when a task depends on external facts or system interaction.

## Gap update from OpenClaw comparison

Compared with OpenClaw's published capabilities, RawClaw should explicitly add room for:
- multiple external channel surfaces beyond the built-in web/desktop UI
- a broader plugin story, not only MCP
- richer search provider selection
- media and device-capability tools
- config-driven tool enablement and sandbox policy

## MCP goals

- one-click Docker MCP Gateway connection
- profile discovery
- available servers and tools visible in the UI
- clean preference for MCP browser/search/fetch tools when present

## Plugin and extension direction

RawClaw should support two extension layers:
- MCP for external tool/runtime interoperability
- platform-native plugins for channels, providers, UI surfaces, or runtime features that do not fit MCP cleanly

## Tool families

- search
- fetch/read
- browser control
- filesystem
- shell/code
- time/date
- memory
- media
- device capabilities

## Runtime behavior

- tools advertise capabilities and confirmation requirements
- tool failures should be structured and inspectable
- the planner should prefer the strongest available tool path
- side-effecting operations should use idempotency and dedupe where possible

## Research workflow

For web research, the preferred path is:

1. search
2. fetch/read
3. browser inspection if needed
4. synthesis with sources

## MCP UX requirements

- show health
- show profile/server/tool groupings
- make manual configuration advanced-only

## Security and trust expectations

- remote and local clients should have explicit trust models
- risky tools should be gated by policy
- connector- and plugin-level configuration should be schema-validated
