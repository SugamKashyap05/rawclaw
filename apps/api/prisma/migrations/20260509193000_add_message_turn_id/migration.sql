ALTER TABLE "messages" ADD COLUMN "turnId" TEXT;

UPDATE "messages"
SET "turnId" = json_extract("provenance", '$.turnId')
WHERE "turnId" IS NULL
  AND "provenance" IS NOT NULL
  AND json_extract("provenance", '$.turnId') IS NOT NULL;

CREATE INDEX "messages_turnId_idx" ON "messages"("turnId");
