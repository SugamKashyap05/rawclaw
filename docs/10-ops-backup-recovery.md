# Ops, Backup, And Recovery

## Non-negotiable protections

The rebuild must include protection against repository and runtime-data loss.

## Code protection

- create remote git immediately
- push the first scaffold commit immediately
- require frequent pushes
- use branches for risky work

## Local data protection

Back up regularly:
- SQLite database
- task artifacts
- exported memories
- environment templates
- important generated reports

## Backup strategy

### Daily
- code pushed to remote
- local data export

### Weekly
- zipped project snapshot outside working directory
- backup copied to another drive or sync service

## Recovery playbook

If the workspace is damaged:

1. stop writing to the folder
2. clone fresh from remote
3. restore local data from exports
4. restore environment files from templates/secrets manager
5. validate health and smoke tests

## Operations maturity targets

RawClaw should eventually include:
- a doctor command or equivalent guided diagnostics flow
- startup-time config validation
- repair paths for common bad local states
- secure remote access guidance such as VPN, tailnet, or SSH tunnel patterns
- clear health, status, and log surfaces from desktop and web

## Temp and cache rules

- no test or dev temp dirs in source roots if avoidable
- caches should live in OS temp or isolated cache directories
- cleanup scripts should be explicit and safe
