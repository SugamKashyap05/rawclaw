-- AlterTable
ALTER TABLE "messages" ADD COLUMN "agentId" TEXT;
ALTER TABLE "messages" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "messages" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "messages" ADD COLUMN "errorType" TEXT;
ALTER TABLE "messages" ADD COLUMN "fallbacks" TEXT;
ALTER TABLE "messages" ADD COLUMN "isLocal" BOOLEAN;
ALTER TABLE "messages" ADD COLUMN "memoryRecall" BOOLEAN;
ALTER TABLE "messages" ADD COLUMN "modelId" TEXT;
ALTER TABLE "messages" ADD COLUMN "provenance" TEXT;
ALTER TABLE "messages" ADD COLUMN "toolResults" TEXT;

-- CreateTable
CREATE TABLE "agent_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "mcp_server_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "args" TEXT,
    "env" TEXT,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "memory_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "source" TEXT,
    "collection" TEXT NOT NULL DEFAULT 'default',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_profiles_name_key" ON "agent_profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_configs_name_key" ON "mcp_server_configs"("name");

-- CreateIndex
CREATE INDEX "memory_entries_collection_idx" ON "memory_entries"("collection");
