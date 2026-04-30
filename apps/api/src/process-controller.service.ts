import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  CompleteHarnessProcessRequest,
  CompleteHarnessRunRequest,
  HarnessProcessRecord,
  HarnessRunRecord,
  StartHarnessProcessRequest,
  StartHarnessRunRequest,
} from '@rawclaw/shared';
import { GatewayEventsService } from './gateway-events.service';

type JsonObject = Record<string, unknown>;

@Injectable()
export class ProcessControllerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayEvents: GatewayEventsService,
  ) {}

  private parseJson<T>(value?: string | null, fallback: T = {} as T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private stringifyJson(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return JSON.stringify(value);
  }

  private mapProcess(record: any): HarnessProcessRecord {
    return {
      id: record.id,
      runId: record.runId,
      name: record.name,
      suiteKey: record.suiteKey || null,
      status: record.status,
      command: this.parseJson<string[]>(record.commandJson, []),
      pid: record.pid ?? null,
      outputLog: record.outputLog || null,
      metadata: this.parseJson<JsonObject | null>(record.metadataJson, null),
      summary: this.parseJson<JsonObject | null>(record.summaryJson, null),
      artifacts: this.parseJson<string[]>(record.artifactPaths, []),
      startedAt: record.startedAt.toISOString(),
      heartbeatAt: record.heartbeatAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
      durationSeconds: record.durationSeconds ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapRun(record: any, includeProcesses = false): HarnessRunRecord {
    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      status: record.status,
      modelId: record.modelId || null,
      workspace: record.workspace || null,
      metadata: this.parseJson<JsonObject | null>(record.metadataJson, null),
      summary: this.parseJson<JsonObject | null>(record.summaryJson, null),
      artifacts: this.parseJson<string[]>(record.artifactPaths, []),
      startedAt: record.startedAt.toISOString(),
      heartbeatAt: record.heartbeatAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      ...(includeProcesses
        ? { processes: (record.processes || []).map((process: any) => this.mapProcess(process)) }
        : {}),
    };
  }

  async startRun(input: StartHarnessRunRequest): Promise<HarnessRunRecord> {
    const run = await this.prisma.harnessRun.create({
      data: {
        name: input.name,
        kind: input.kind || 'regression-pack',
        status: 'running',
        modelId: input.modelId || null,
        workspace: input.workspace || null,
        metadataJson: this.stringifyJson(input.metadata || {}),
        heartbeatAt: new Date(),
      },
    });
    await this.gatewayEvents.publish({
      type: 'run.started',
      runId: run.id,
      summary: `Harness run ${run.name} started`,
      payload: { kind: run.kind, workspace: run.workspace || null },
    });
    return this.mapRun(run);
  }

  async heartbeatRun(id: string, metadata?: JsonObject): Promise<HarnessRunRecord> {
    const current = await this.prisma.harnessRun.findUnique({ where: { id } });
    const mergedMetadata = {
      ...(this.parseJson<JsonObject>(current?.metadataJson, {})),
      ...(metadata || {}),
    };
    const run = await this.prisma.harnessRun.update({
      where: { id },
      data: {
        heartbeatAt: new Date(),
        metadataJson: this.stringifyJson(mergedMetadata),
      },
    });
    await this.gatewayEvents.publish({
      type: 'run.heartbeat',
      runId: run.id,
      summary: `Harness run ${run.name} heartbeat`,
      payload: { kind: run.kind, metadata: metadata || {} },
    });
    return this.mapRun(run);
  }

  async completeRun(id: string, input: CompleteHarnessRunRequest): Promise<HarnessRunRecord> {
    const current = await this.prisma.harnessRun.findUnique({ where: { id } });
    const mergedMetadata = {
      ...(this.parseJson<JsonObject>(current?.metadataJson, {})),
      ...(input.metadata || {}),
    };
    const run = await this.prisma.harnessRun.update({
      where: { id },
      data: {
        status: input.status,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
        summaryJson: this.stringifyJson(input.summary || {}),
        artifactPaths: this.stringifyJson(input.artifacts || []),
        metadataJson: this.stringifyJson(mergedMetadata),
      },
    });
    await this.gatewayEvents.publish({
      type: input.status === 'failed' ? 'run.failed' : 'run.finished',
      runId: run.id,
      summary: `Harness run ${run.name} ${input.status}`,
      payload: { kind: run.kind, status: input.status, summary: input.summary || {} },
    });
    return this.mapRun(run);
  }

  async listRuns(limit = 20): Promise<HarnessRunRecord[]> {
    const runs = await this.prisma.harnessRun.findMany({
      take: Math.max(1, Math.min(limit, 100)),
      orderBy: { startedAt: 'desc' },
      include: {
        processes: {
          orderBy: { startedAt: 'asc' },
        },
      },
    });
    return runs.map((run) => this.mapRun(run, true));
  }

  async getRun(id: string): Promise<HarnessRunRecord | null> {
    const run = await this.prisma.harnessRun.findUnique({
      where: { id },
      include: {
        processes: {
          orderBy: { startedAt: 'asc' },
        },
      },
    });
    return run ? this.mapRun(run, true) : null;
  }

  async startProcess(runId: string, input: StartHarnessProcessRequest): Promise<HarnessProcessRecord> {
    const process = await this.prisma.harnessProcess.create({
      data: {
        runId,
        name: input.name,
        suiteKey: input.suiteKey || null,
        status: 'running',
        commandJson: this.stringifyJson(input.command) || '[]',
        pid: input.pid ?? null,
        metadataJson: this.stringifyJson(input.metadata || {}),
        heartbeatAt: new Date(),
      },
    });
    await this.prisma.harnessRun.update({
      where: { id: runId },
      data: { heartbeatAt: new Date() },
    });
    return this.mapProcess(process);
  }

  async updateProcess(id: string, input: Partial<CompleteHarnessProcessRequest> & { pid?: number }): Promise<HarnessProcessRecord> {
    const current = await this.prisma.harnessProcess.findUnique({ where: { id } });
    const mergedMetadata = {
      ...(this.parseJson<JsonObject>(current?.metadataJson, {})),
      ...((input.metadata as JsonObject) || {}),
    };
    const mergedSummary = {
      ...(this.parseJson<JsonObject>(current?.summaryJson, {})),
      ...((input.summary as JsonObject) || {}),
    };
    const mergedArtifacts = Array.from(
      new Set([
        ...this.parseJson<string[]>(current?.artifactPaths, []),
        ...((input.artifacts as string[]) || []),
      ]),
    );
    const process = await this.prisma.harnessProcess.update({
      where: { id },
      data: {
        status: input.status || current?.status || 'running',
        pid: input.pid ?? current?.pid ?? null,
        outputLog: input.outputLog ?? current?.outputLog ?? null,
        metadataJson: this.stringifyJson(mergedMetadata),
        summaryJson: this.stringifyJson(mergedSummary),
        artifactPaths: this.stringifyJson(mergedArtifacts),
        heartbeatAt: new Date(),
        finishedAt: input.status && input.status !== 'running' ? new Date() : current?.finishedAt ?? null,
        durationSeconds: input.durationSeconds ?? current?.durationSeconds ?? null,
      },
    });
    if (process.runId) {
      await this.prisma.harnessRun.update({
        where: { id: process.runId },
        data: { heartbeatAt: new Date() },
      });
    }
    return this.mapProcess(process);
  }
}
