ALTER TABLE "messages" ADD COLUMN "streamStatus" TEXT NOT NULL DEFAULT 'completed';

UPDATE "messages"
SET "streamStatus" = COALESCE(NULLIF("streamStatus", ''), 'completed');
