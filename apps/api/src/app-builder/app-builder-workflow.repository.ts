import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AppBuilderProjectStatus } from '@rawclaw/shared';
import { PrismaService } from '../prisma.service';
import { AppBuilderConfigService } from './app-builder.config.service';
import { AppBuilderLockService } from './app-builder-lock.service';

type JsonObject = Record<string, unknown>;

type WorkflowProjectWrite = {
  status: AppBuilderProjectStatus;
  runId?: string | null;
  metadataPatch?: JsonObject | null;
  approvalGranted?: boolean;
  validate?: (project: any) => void;
  extraData?: {
    controlMode?: string | null;
  };
};

@Injectable()
export class AppBuilderWorkflowRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: AppBuilderLockService,
    private readonly config: AppBuilderConfigService,
  ) {}

  async withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const timeoutMs = Math.max(1_000, Math.min(30_000, this.config.values.foregroundStartWindowMs));
    const key = this.locks.workflowKey(projectId);
    let handle = await this.locks.acquire(key, `workflow:${process.pid}`, timeoutMs);
    while (!handle && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      handle = await this.locks.acquire(key, `workflow:${process.pid}`, timeoutMs);
    }
    if (!handle) {
      throw new ServiceUnavailableException({
        code: 'workflow_locked',
        message: 'Another App Builder workflow transition is in progress.',
        retryAfterMs: 1000,
      });
    }
    try {
      return await operation();
    } finally {
      await this.locks.release(handle).catch(() => false);
    }
  }

  async getProject(projectId: string): Promise<any> {
    const project = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`App Builder project ${projectId} not found.`);
    }
    return project;
  }

  async updateStatus(projectId: string, write: WorkflowProjectWrite): Promise<void> {
    await this.withProjectLock(projectId, async () => {
      const project = await this.getProject(projectId);
      write.validate?.(project);
      const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
      await this.prisma.appBuilderProject.update({
        where: { id: projectId },
        data: {
          status: write.status,
          latestRunId: write.runId || project.latestRunId,
          approvalGranted: write.approvalGranted === undefined ? project.approvalGranted : write.approvalGranted,
          controlMode: write.extraData?.controlMode ?? undefined,
          metadataJson: JSON.stringify({
            ...metadata,
            ...(write.metadataPatch || {}),
            workflowUpdatedAt: new Date().toISOString(),
          }),
        },
      });
    });
  }

  async patchMetadata(projectId: string, patch: JsonObject): Promise<void> {
    await this.withProjectLock(projectId, async () => {
      const project = await this.getProject(projectId);
      const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
      await this.prisma.appBuilderProject.update({
        where: { id: projectId },
        data: {
          metadataJson: JSON.stringify({
            ...metadata,
            ...patch,
          }),
        },
      });
    });
  }

  async mutateMetadata(projectId: string, mutate: (metadata: JsonObject, project: any) => JsonObject | Promise<JsonObject>): Promise<JsonObject> {
    return await this.withProjectLock(projectId, async () => {
      const project = await this.getProject(projectId);
      const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
      const nextMetadata = await mutate({ ...metadata }, project);
      await this.prisma.appBuilderProject.update({
        where: { id: projectId },
        data: {
          metadataJson: JSON.stringify(nextMetadata),
        },
      });
      return nextMetadata;
    });
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
