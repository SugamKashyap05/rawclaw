import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AppBuilderConfigService } from './app-builder.config.service';
import { AppBuilderLockService } from './app-builder-lock.service';
import { AppBuilderWorkflowStateService } from './app-builder-workflow-state.service';
import { SecureWorkspacePathService } from './secure-workspace-path.service';
import { PrismaService } from '../prisma.service';
import { AppBuilderService } from './app-builder.service';

@Injectable()
export class AppBuilderHarnessJanitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppBuilderHarnessJanitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AppBuilderConfigService,
    private readonly locks: AppBuilderLockService,
    private readonly workflow: AppBuilderWorkflowStateService,
    private readonly securePaths: SecureWorkspacePathService,
    private readonly prisma: PrismaService,
    private readonly appBuilder: AppBuilderService,
  ) {}

  onModuleInit(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.config.values.janitorIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.appBuilder.ensureSchema();
      await this.cleanTempUploads();
      await this.processSmokeRestoreMetadata();
      await this.retrySuggestionVectorClears();
      await this.appBuilder.processCleanupTasks();
      await this.markStaleBuilderRunsInterrupted();
    } catch (error) {
      this.logger.warn(`App Builder janitor pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async processSmokeRestoreMetadata(): Promise<void> {
    const projects = await this.prisma.appBuilderProject.findMany({
      select: { id: true, metadataJson: true },
      take: 200,
    });
    for (const project of projects) {
      const metadata = this.parseJson<Record<string, unknown>>(project.metadataJson, {});
      if (!metadata.smokeRestorePending) continue;
      const lock = await this.locks.read(this.locks.controlTestKey(project.id));
      if (lock) {
        const expiresAt = Date.parse(lock.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
          continue;
        }
        await this.locks.release(lock).catch(() => false);
      }
      await this.appBuilder.handleSmokeRestorePending(project.id, 'janitor').catch((error) => {
        this.logger.warn(`Smoke restore janitor handling failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  private async retrySuggestionVectorClears(): Promise<void> {
    const projects = await this.prisma.appBuilderProject.findMany({
      select: { id: true, metadataJson: true },
      take: 200,
    });
    const retryAfterMs = 5 * 60 * 1000;
    for (const project of projects) {
      const metadata = this.parseJson<Record<string, unknown>>(project.metadataJson, {});
      if (!metadata.suggestionVectorClearPending || metadata.suggestionVectorClearFailed) continue;
      const lastAttemptAt = typeof metadata.suggestionVectorClearLastAttemptAt === 'string'
        ? Date.parse(metadata.suggestionVectorClearLastAttemptAt)
        : 0;
      if (Number.isFinite(lastAttemptAt) && Date.now() - lastAttemptAt < retryAfterMs) {
        continue;
      }
      await this.appBuilder.retrySuggestionVectorClear(project.id).catch((error) => {
        this.logger.warn(`Suggestion vector clear retry failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  private async markStaleBuilderRunsInterrupted(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.config.values.backgroundQueueTimeoutMs);
    const runs = await this.prisma.appBuilderRun.findMany({
      where: {
        status: { in: ['queued', 'generating', 'integrating', 'validating', 'deploying', 'registration_pending'] },
        updatedAt: { lt: staleBefore },
      },
      take: 20,
    });
    for (const run of runs) {
      const cleanupLock = await this.locks.acquire(this.locks.cleanupKey(run.projectId), `janitor:${process.pid}`, 30_000);
      if (!cleanupLock) continue;
      let heartbeatTimer: NodeJS.Timeout | null = null;
      try {
        await this.workflow.setRecoveryFreeze(run.projectId, `Recovering stale ${run.phase} run ${run.id}.`, this.config.values.recoveryFreezeTtlMs);
        heartbeatTimer = setInterval(() => {
          void this.workflow.setRecoveryFreeze(run.projectId, `Recovering stale ${run.phase} run ${run.id}.`, this.config.values.recoveryFreezeTtlMs)
            .catch((error) => this.logger.warn(`Failed to extend recovery freeze: ${error instanceof Error ? error.message : String(error)}`));
        }, this.config.values.recoveryFreezeHeartbeatMs);
        await this.workflow.markInterrupted(run.projectId, run.phase as any, `Run ${run.id} did not heartbeat before janitor timeout.`);
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        await this.workflow.clearRecoveryFreeze(run.projectId).catch(() => undefined);
        await this.locks.release(cleanupLock).catch(() => undefined);
      }
    }
  }

  private async cleanTempUploads(): Promise<void> {
    const projects = await this.prisma.appBuilderProject.findMany({
      where: { managedPath: { not: null } },
      select: { managedPath: true },
      take: 200,
    });
    const staleBefore = Date.now() - this.config.values.staleTempUploadMs;
    for (const project of projects) {
      if (!project.managedPath) continue;
      const tmpDir = this.securePaths.resolveInside(project.managedPath, path.join('.app-builder', 'uploads', '.tmp'));
      const entries = await fs.readdir(tmpDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const target = this.securePaths.resolveInside(tmpDir, entry.name);
        const stat = await fs.stat(target).catch(() => null);
        if (stat && stat.mtimeMs < staleBefore) {
          await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
  }

  private parseJson<T>(value?: string | null, fallback: T = {} as T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
