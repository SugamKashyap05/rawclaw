PRAGMA foreign_keys=OFF;

CREATE TABLE "new_task_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "definitionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "triggeredBy" TEXT NOT NULL DEFAULT 'api',
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "selectedAgent" TEXT,
  "outputPath" TEXT,
  "provenance" TEXT,
  "errorMessage" TEXT,
  "resumedFromRunId" TEXT,
  "sessionId" TEXT,
  "promptPackId" TEXT,
  "promptVersionHash" TEXT,
  "reviewerPromptVersionHash" TEXT,
  "workflowPromptIds" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_runs_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "task_definitions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_task_runs" (
  "id",
  "definitionId",
  "status",
  "triggeredBy",
  "startedAt",
  "finishedAt",
  "lastActivityAt",
  "selectedAgent",
  "outputPath",
  "provenance",
  "errorMessage",
  "resumedFromRunId",
  "sessionId",
  "promptPackId",
  "promptVersionHash",
  "reviewerPromptVersionHash",
  "workflowPromptIds",
  "createdAt"
)
SELECT
  "id",
  "definitionId",
  "status",
  'api',
  "startedAt",
  "finishedAt",
  COALESCE("finishedAt", "startedAt", "createdAt", CURRENT_TIMESTAMP),
  "selectedAgent",
  "outputPath",
  "provenance",
  "errorMessage",
  "resumedFromRunId",
  "sessionId",
  "promptPackId",
  "promptVersionHash",
  "reviewerPromptVersionHash",
  "workflowPromptIds",
  "createdAt"
FROM "task_runs";

DROP TABLE "task_runs";
ALTER TABLE "new_task_runs" RENAME TO "task_runs";

PRAGMA foreign_keys=ON;
