# App Builder MVP Migration Rollout

This migration is intentionally **not** bundled into the task/chat sprint deployment.

## Deployment policy

- apply this migration in its own window
- run `prisma migrate status` first and confirm this is the only pending migration in scope
- do not combine it with unrelated chat/task schema changes

## Rollout checks

- confirm no partial or failed Prisma migration state
- confirm API startup succeeds with the new tables present
- confirm App Builder endpoints can create/read project records after deploy

## Rollback

- use [rollback.sql](./rollback.sql) if the migration must be reverted after code rollback
- rollback drops the App Builder tables created by this migration

## Notes

- this migration creates new tables only; it does not backfill or mutate existing chat/task data
- because it has its own rollback surface now, it can be reviewed and scheduled separately from the task/chat sprint
