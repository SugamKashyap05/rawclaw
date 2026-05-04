-- CreateTable
CREATE TABLE "app_builder_projects" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "appType" TEXT NOT NULL DEFAULT 'web_app',
  "sourceType" TEXT NOT NULL DEFAULT 'generated',
  "templateId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "controlMode" TEXT NOT NULL DEFAULT 'observe_only',
  "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
  "approvalGranted" BOOLEAN NOT NULL DEFAULT false,
  "requestedPermissionsJson" TEXT,
  "requestedCapabilitiesJson" TEXT,
  "sourcePath" TEXT,
  "managedPath" TEXT,
  "deployPath" TEXT,
  "exportPath" TEXT,
  "latestManifestId" TEXT,
  "latestRunId" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "app_builder_manifests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "manifestJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "app_builder_manifests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_builder_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "errorMessage" TEXT,
  "gatewayRunId" TEXT,
  "queueJobId" TEXT,
  "workerId" TEXT,
  "outputJson" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "app_builder_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_registry_records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "appId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "manifestJson" TEXT NOT NULL,
  "controlEndpoint" TEXT NOT NULL,
  "eventStreamEndpoint" TEXT NOT NULL,
  "deploymentLocation" TEXT,
  "healthStatus" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "app_registry_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_builder_projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "imported_project_adapters" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "adapterType" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "outputPath" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "warningsJson" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "imported_project_adapters_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "app_builder_projects_slug_key" ON "app_builder_projects"("slug");

-- CreateIndex
CREATE INDEX "app_builder_projects_workspaceId_status_idx" ON "app_builder_projects"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "app_builder_manifests_projectId_createdAt_idx" ON "app_builder_manifests"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "app_builder_runs_projectId_createdAt_idx" ON "app_builder_runs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "app_builder_runs_gatewayRunId_idx" ON "app_builder_runs"("gatewayRunId");

-- CreateIndex
CREATE INDEX "app_registry_records_projectId_createdAt_idx" ON "app_registry_records"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "app_registry_records_appId_status_idx" ON "app_registry_records"("appId", "status");

-- CreateIndex
CREATE INDEX "imported_project_adapters_projectId_createdAt_idx" ON "imported_project_adapters"("projectId", "createdAt");
