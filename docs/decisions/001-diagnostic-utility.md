# Architectural Decision: rawclaw doctor Diagnostic Utility

## Context
During Phase 2, a critical failure occurred where the database was initialized with 0 bytes (missing tables), but the system health endpoints reported "ok" because they only checked for service connectivity, not schema validity.

## Decision
We will implement a `rawclaw doctor` (or `npm run doctor`) command to provide structured environment verification for developers and operators.

## Specification

### 1. Environment Checks
- **Node.js**: Minimum v18+, check `.nvmrc`.
- **Python**: Minimum 3.11+.
- **Ports**: Verify availability of 3000 (Web), 3001 (API), 8000 (Agent), 5173 (Vite).
- **Environment**: Check for key fields in root `.env` and `apps/*/.env`.

### 2. Service Deep-Check
- **Redis**: Test PING and check memory usage.
- **SQLite**: 
  - Verify file exists at `DATABASE_URL`.
  - Execute `SELECT name FROM sqlite_master WHERE type='table';` to confirm migrations have run.
  - Alert if `sessions` or `messages` tables are missing.
- **Ollama**: Check if the service is running and if the default model (e.g., `llama3`) is pulled.

### 3. monorepo Integrity
- Check `node_modules` size and existence of `@rawclaw/shared` symlink.
- Verify `apps/desktop/src-tauri` cargo build cache.

## Implementation Details
- **Location**: `scripts/doctor.py` (cross-platform friendly).
- **UI**: Rich Console output (e.g., using `rich` library in Python or simple color-coded CLI).
- **Automation**: Should be callable by CI to ensure the runner environment matches production.

### Success Pattern
```text
[PASS] Node.js v20.10.0
[PASS] API Connectivity (3001)
[FAIL] Database schema invalid: tables 'sessions' not found.
       Run: npm run db:push
[WARN] Ollama model 'llama3' not found locally. Fallback to Anthropic will be used.
```

## Consequences
- **Positive**: Drastically reduced "ghost" bug reports where the system is misconfigured.
- **Negative**: Adds a small maintenance burden for the doctor script as dependencies change.
