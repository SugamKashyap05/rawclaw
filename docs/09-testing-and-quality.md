# Testing And Quality

## Test pyramid

### Unit tests
- planners
- tool adapters
- API services
- UI utility logic

### Integration tests
- API to agent contracts
- task run persistence
- MCP connection lifecycle
- model routing and fallback

### End-to-end tests
- chat with tool use
- task run with artifacts
- Docker MCP flows

## Quality gates

- no root build breakage
- no root dev breakage
- no user-visible 500 for expected runtime failures
- typecheck and lint required
- focused smoke tests for:
  - chat
  - MCP
  - tasks
  - memory

## Stability testing

A dedicated stability script should validate:
- API health
- agent health
- MCP health
- key smoke flows
- task execution

## Required failure behavior

- invalid planner output must not crash the system
- model memory pressure should degrade gracefully
- search/tool failures should return bounded answers, not raw crashes

