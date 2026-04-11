# Contributing to RawClaw

We are in Phase 0 (Rebuild). Follow these required practices:

## Branch Naming Convention
Use the following prefixes for all branches:
- `feat/`: New features
- `fix/`: Bug fixes
- `chore/`: Maintenance, config changes, minor dependency bumps
- `docs/`: Documentation updates

## Workflow Requirements
- **Push every working session**: Do not leave code marooned locally.
- **Never commit directly to main**: Always use a PR.
- **Architecture Updates**: Whenever architecture changes, you **MUST** update the `docs/` and log in `docs/decisions/`.

## Quality
- Type checking is mandatory (`check-types`).
- Ensure no `.env` files with secrets are committed (pre-commit hook should block this).
