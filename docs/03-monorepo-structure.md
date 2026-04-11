# Monorepo Structure

## Proposed structure

```text
apps/
  web/
  api/
  agent/
  desktop/
packages/
  shared/
  ui/
  skills-sdk/
  rawshell/
docs/
scripts/
```

## App responsibilities

### `apps/web`
- React + Vite UI
- route-level feature pages
- shared UI primitives and dashboard views

### `apps/api`
- NestJS platform services
- database access
- task orchestration metadata
- MCP server registry

### `apps/agent`
- FastAPI
- planning and execution loop
- tool registry
- model routing
- memory pipeline

### `apps/desktop`
- Tauri shell
- native commands
- updater and runtime health

## Shared packages

### `packages/shared`
- common types
- shared DTOs and enums

### `packages/ui`
- reusable UI components

### `packages/skills-sdk`
- skill packaging and runtime contracts

### `packages/rawshell`
- sandbox execution interface

## Repository rules

- temp/runtime files live outside source directories where possible
- every app has clear `dev`, `build`, `test`, and `check-types` commands
- root commands orchestrate all apps reliably

