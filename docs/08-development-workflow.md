# Development Workflow

## Principles

- remote git from the first commit
- branch-based work
- CI on every branch and pull request
- no temp/test cache folders inside critical source trees

## Root commands to restore

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test
npm run check-types
```

## Environment setup

1. Install Node.js 20+
2. Install Python 3.11+
3. Install Rust
4. Install Docker Desktop
5. Copy `.env.example` to `.env`
6. Start local services

## Config and schema workflow

RawClaw should eventually provide:
- a canonical local config file
- generated schema for editor support
- a config wizard
- schema-driven forms in the UI
- validation before runtime boot

## Standards

- TypeScript in strict mode
- Python lint + typecheck
- small files and focused modules
- absolute responsibility boundaries between apps

## Documentation standards

- architecture changes update `docs/`
- major decisions go into a decision log later
- onboarding should be possible from docs alone

## Runtime hygiene rules

- no temp, cache, or test artifacts in source folders
- no silent background mutation of config without validation
- remote access and trust flows must be documented before they ship
