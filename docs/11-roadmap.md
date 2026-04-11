# Roadmap

## Phase 0: Safety and foundation

- recreate repo scaffold
- restore root scripts
- remote git and CI
- environment templates
- backup/export scripts
- `.gitignore` and temp isolation

## Phase 1: Monorepo skeleton

- `apps/web`
- `apps/api`
- `apps/agent`
- `apps/desktop`
- shared packages
- stable ports and health endpoints
- basic control-plane contracts
- canonical config file location and schema plan

## Phase 2: Chat MVP

- chat UI
- API/agent bridge
- planner and executor baseline
- model selection
- clean final answers

## Phase 3: Tools and MCP

- tool registry
- Docker MCP Gateway support
- search/fetch/browser tools
- tool confirmation and health states
- extension and plugin strategy
- multiple search providers

## Phase 4: Tasks

- task definitions
- task runs
- final outputs
- provenance
- recurring schedule model
- session and sender-aware routing model

## Phase 5: Memory

- short-term memory
- long-term memory
- Memory page integration
- explainable retrieval

## Phase 6: Specialists and delegation

- saved specialist agents
- worker orchestration
- merged final outputs

## Phase 7: Reliability hardening

- graceful fallbacks
- no-500 guarantees
- stability checks
- scheduler resilience

## Phase 8: Product polish

- dashboard
- onboarding
- desktop release flow
- diagnostics and operator UX
- control-plane config UI
- doctor and repair workflows

## Cross-cutting gaps found from OpenClaw comparison

The comparison highlighted several capabilities to account for during rebuild:
- local control-plane or gateway ownership of sessions and routing
- schema-driven configuration, onboarding, and hot reload
- secure remote access and trust/pairing flows
- broader channel and surface strategy
- mobile or node-style capability expansion
- media, voice, and multimodal planning
- diagnostics and repair tooling as first-class product features


## Definition of done

RawClaw is healthy when:
- local dev is reliable
- current/fresh answers are verified or clearly bounded
- tasks produce polished deliverables
- memory is unified
- MCP is simple to connect
- backups and recovery are routine, not emergency work
