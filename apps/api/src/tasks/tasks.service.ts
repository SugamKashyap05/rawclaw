import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskRunDto } from './dto/update-task-run.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ProvenanceTrace, RunStep, Task, TaskRun, TaskRunListResponse, TaskRunStatus, TaskRunTrigger } from '@rawclaw/shared';

type TaskRunDetail = TaskRun & {
  definition?: Task;
  provenance?: ProvenanceTrace | null;
  steps: RunStep[];
};

type RunListFilters = {
  page?: number;
  limit?: number;
  status?: string;
  agentId?: string;
  sessionId?: string;
};

type AgentTaskExecutionResponse = {
  run_id: string;
  status: string;
  output_path?: string | null;
  error_message?: string | null;
  provenance?: Record<string, unknown> | null;
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly MAX_RUNS_PAGE_SIZE = 100;
  private readonly ACTIVE_RUN_STATUSES = ['queued', 'running', 'pending', 'cancelling'] as const;
  private readonly STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async createDefinition(dto: CreateTaskDto) {
    const task = await this.prisma.taskDefinition.create({
      data: this.buildCreateDefinitionData(dto),
    });
    return this.mapDefinition(task);
  }

  async updateDefinition(id: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.taskDefinition.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Task definition not found');
    }

    const task = await this.prisma.taskDefinition.update({
      where: { id },
      data: this.buildUpdateDefinitionData(dto),
    });
    return this.mapDefinition(task);
  }

  async listDefinitions() {
    const definitions = await this.prisma.taskDefinition.findMany({
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return definitions.map((definition) =>
      this.mapDefinition(definition, definition.runs[0]?.status || undefined),
    );
  }

  async getDefinition(id: string) {
    const definition = await this.prisma.taskDefinition.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!definition) {
      throw new NotFoundException('Task definition not found');
    }

    return this.mapDefinition(definition, definition.runs[0]?.status || undefined);
  }

  async deleteDefinition(id: string) {
    return this.prisma.taskDefinition.delete({ where: { id } });
  }

  async enqueueRun(
    definitionId: string,
    options: { triggeredBy?: TaskRunTrigger; sessionId?: string } = {},
  ) {
    const definition = await this.prisma.taskDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!definition) {
      throw new NotFoundException('Task definition not found');
    }

    const run = await this.prisma.taskRun.create({
      data: {
        definitionId,
        status: 'queued',
        triggeredBy: this.normalizeTriggeredBy(options.triggeredBy),
        lastActivityAt: new Date(),
        sessionId: options.sessionId || null,
        selectedAgent: definition.agentId || null,
      } as any,
      include: { definition: true },
    });

    void this.executeRunInBackground(run.id, this.buildAgentDefinitionPayload(definition));

    return this.mapRun(run);
  }

  async listRuns(filters: RunListFilters = {}): Promise<TaskRunListResponse> {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(this.MAX_RUNS_PAGE_SIZE, Math.max(1, Number(filters.limit) || 25));
    const status = filters.status ? this.normalizeRunStatus(filters.status) : undefined;
    const agentId = filters.agentId?.trim() || undefined;
    const sessionId = filters.sessionId?.trim() || undefined;

    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (agentId) {
      where.definition = { is: { agentId } };
    }
    if (sessionId) {
      where.sessionId = { contains: sessionId };
    }

    const [items, total] = await Promise.all([
      this.prisma.taskRun.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { definition: true },
      }),
      this.prisma.taskRun.count({ where }),
    ]);

    return {
      items: items.map((run) => this.mapRun(run)),
      page,
      limit,
      total,
      totalPages: total === 0 ? 1 : Math.ceil(total / limit),
    };
  }

  /**
   * List recent runs, optionally filtered by sessionId.
   * When sessionId is provided, returns runs linked to that session.
   * Otherwise returns the 20 most recent runs across all sessions.
   */
  async listRecentRuns(sessionId?: string) {
    const where = sessionId ? { sessionId } : {};
    const runs = await this.prisma.taskRun.findMany({
      where,
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { definition: true },
    });
    return runs.map((run) => this.mapRun(run));
  }

  async countActiveRuns(): Promise<number> {
    return this.prisma.taskRun.count({
      where: {
        status: { in: [...this.ACTIVE_RUN_STATUSES] },
      },
    });
  }

  async getRunDetail(runId: string): Promise<TaskRunDetail> {
    const run = await this.prisma.taskRun.findUnique({
      where: { id: runId },
      include: {
        definition: true,
        steps: { orderBy: { stepIndex: 'asc' } },
      },
    });

    if (!run) {
      throw new NotFoundException('Task run not found');
    }

    return this.mapRun(run, true);
  }

  async updateRun(runId: string, dto: UpdateTaskRunDto) {
    const existing = await this.prisma.taskRun.findUnique({ where: { id: runId } });
    if (!existing) {
      throw new NotFoundException('Task run not found');
    }

    const normalizedStatus = this.normalizeRunStatus(dto.status);
    const data: any = { status: normalizedStatus, lastActivityAt: new Date() };

    if (dto.outputPath !== undefined) {
      data.outputPath = dto.outputPath || null;
    }
    if (dto.errorMessage !== undefined) {
      data.errorMessage = dto.errorMessage || null;
    }
    if (dto.provenance !== undefined) {
      data.provenance = dto.provenance ? JSON.stringify(dto.provenance) : null;
    }
    if (normalizedStatus === 'running' && !existing.startedAt) {
      data.startedAt = new Date();
    }
    if (['done', 'failed', 'cancelled'].includes(normalizedStatus)) {
      data.finishedAt = existing.finishedAt || new Date();
    }

    const run = await this.prisma.taskRun.update({
      where: { id: runId },
      data,
      include: {
        definition: true,
        steps: { orderBy: { stepIndex: 'asc' } },
      },
    });

    if (dto.steps && dto.steps.length > 0) {
      await this.prisma.$transaction([
        this.prisma.runStep.deleteMany({ where: { runId } }),
        this.prisma.runStep.createMany({
          data: dto.steps.map((step) => ({
            id: step.id,
            runId,
            stepIndex: step.stepIndex,
            stepType: step.stepType,
            toolName: step.toolName || null,
            inputSummary: step.inputSummary || null,
            outputSummary: step.outputSummary || null,
            sourceUrl: step.sourceUrl || null,
            durationMs: step.durationMs ?? null,
            sandboxed: Boolean(step.sandboxed),
            timestamp: new Date(step.timestamp),
          })),
        }),
      ]);
    }

    return this.mapRun(run, true);
  }

  async cancelRun(runId: string) {
    const run = await this.prisma.taskRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    const normalizedStatus = this.normalizeRunStatus(run.status);
    if (['done', 'failed', 'cancelled'].includes(normalizedStatus)) {
      return {
        accepted: false,
        status: normalizedStatus,
        message: `Run ${runId} is already ${normalizedStatus}.`,
      };
    }

    const agentUrl = this.configService.get<string>('agentUrl');
    await this.updateRun(runId, { status: 'cancelling' });
    try {
      await firstValueFrom(this.httpService.post(`${agentUrl}/execute/task/${runId}/cancel`, {}));
    } catch (error) {
      await this.updateRun(runId, { status: normalizedStatus });
      throw error;
    }

    return {
      accepted: true,
      status: 'cancelling' as TaskRunStatus,
      message: `Cancellation requested for task run ${runId}.`,
    };
  }

  async heartbeatRun(runId: string) {
    const run = await this.prisma.taskRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    const normalizedStatus = this.normalizeRunStatus(run.status);
    if (!['queued', 'running', 'cancelling'].includes(normalizedStatus)) {
      return {
        accepted: false,
        status: normalizedStatus,
        message: `Run ${runId} is already ${normalizedStatus}.`,
      };
    }

    await this.prisma.taskRun.update({
      where: { id: runId },
      data: { lastActivityAt: new Date() } as any,
    });

    return {
      accepted: true,
      status: normalizedStatus,
      message: `Heartbeat recorded for task run ${runId}.`,
    };
  }

  async deleteRun(runId: string) {
    return this.prisma.taskRun.delete({ where: { id: runId } });
  }

  async resumeRun(runId: string, sessionId?: string, triggeredBy: TaskRunTrigger = 'manual') {
    const previousRun = await this.prisma.taskRun.findUnique({
      where: { id: runId },
      include: { definition: true },
    });

    if (!previousRun) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    const newRun = await this.prisma.taskRun.create({
      data: {
        definitionId: previousRun.definitionId,
        status: 'queued',
        resumedFromRunId: runId,
        sessionId,
        triggeredBy: this.normalizeTriggeredBy(triggeredBy),
        lastActivityAt: new Date(),
        selectedAgent: previousRun.selectedAgent || previousRun.definition.agentId || null,
      } as any,
      include: { definition: true },
    });

    void this.executeRunInBackground(
      newRun.id,
      this.buildAgentDefinitionPayload(previousRun.definition),
      { resumed_from: runId },
    );

    return this.mapRun(newRun);
  }

  private async executeRunInBackground(
    runId: string,
    definition: { id: string; name: string; description: string; toolIds: string[]; agentId?: string | null },
    context?: Record<string, unknown>,
  ) {
    const agentUrl = this.configService.get<string>('agentUrl');
    await this.updateRun(runId, { status: 'running' });

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${agentUrl}/execute/task`, {
          run_id: runId,
          definition,
          context,
        }),
      );

      const result = response.data as AgentTaskExecutionResponse;
      const provenance = (result?.provenance || null) as ProvenanceTrace | null;
      const steps = this.extractStepsFromProvenance(runId, provenance);

      await this.updateRun(runId, {
        status: this.normalizeRunStatus(result?.status),
        outputPath: result?.output_path || undefined,
        errorMessage: result?.error_message || undefined,
        provenance: provenance || undefined,
        steps,
      });
    } catch (error: any) {
      const agentMessage =
        error?.response?.data?.message
        || error?.response?.data?.detail
        || error?.message
        || 'Unknown agent execution error';

      await this.updateRun(runId, {
        status: 'failed',
        errorMessage: `Failed to execute task: ${agentMessage}`,
      });
    }
  }

  private buildCreateDefinitionData(dto: CreateTaskDto) {
    return {
      name: dto.name,
      description: dto.description,
      agentId: dto.agentId || null,
      toolIds: JSON.stringify(dto.toolIds || []),
      schedule: dto.schedule || null,
      enabled: dto.enabled ?? true,
      workspaceId: dto.workspaceId || 'default',
    };
  }

  private buildUpdateDefinitionData(dto: UpdateTaskDto) {
    return {
      name: dto.name,
      description: dto.description,
      agentId: dto.agentId === undefined ? undefined : (dto.agentId || null),
      toolIds: dto.toolIds === undefined ? undefined : JSON.stringify(dto.toolIds),
      schedule: dto.schedule === undefined ? undefined : (dto.schedule || null),
      enabled: dto.enabled === undefined ? undefined : Boolean(dto.enabled),
      workspaceId: dto.workspaceId === undefined ? undefined : (dto.workspaceId || 'default'),
    };
  }

  private parseToolIds(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }

  private mapDefinition(definition: any, lastRunStatus?: string): Task {
    return {
      ...definition,
      toolIds: this.parseToolIds(definition.toolIds),
      enabled: definition.enabled ?? true,
      lastRunStatus: lastRunStatus ? this.normalizeRunStatus(lastRunStatus) : undefined,
    };
  }

  private mapRun(run: any, includeProvenance = false): TaskRunDetail {
    const task = run.definition ? this.mapDefinition(run.definition) : run.task ? this.mapDefinition(run.task) : undefined;
    const parsedProvenance = includeProvenance
      ? (typeof run.provenance === 'string' && run.provenance
          ? JSON.parse(run.provenance)
          : run.provenance || null)
      : undefined;

    return {
      ...run,
      taskId: run.taskId || run.definitionId,
      status: this.normalizeRunStatus(run.status),
      triggeredBy: run.triggeredBy ? this.normalizeTriggeredBy(run.triggeredBy) : undefined,
      lastActivityAt: run.lastActivityAt ? new Date(run.lastActivityAt).toISOString() : undefined,
      provenance: parsedProvenance,
      steps: Array.isArray(run.steps) ? run.steps : [],
      task,
      definition: task,
    };
  }

  async reapStaleRuns(options: { now?: Date; thresholdMs?: number; startupSkipBefore?: Date } = {}) {
    const now = options.now || new Date();
    const thresholdMs = options.thresholdMs ?? this.STALE_RUN_THRESHOLD_MS;
    const cutoff = new Date(now.getTime() - thresholdMs);
    const startupSkipBefore = options.startupSkipBefore;
    const where: Record<string, unknown> = {
      status: { in: ['queued', 'running', 'cancelling'] },
      lastActivityAt: { lt: cutoff },
    };

    if (startupSkipBefore) {
      where.AND = [{ lastActivityAt: { gte: startupSkipBefore } }];
    }

    const staleRuns = await this.prisma.taskRun.findMany({
      where: where as any,
    });

    for (const run of staleRuns) {
      await this.prisma.taskRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: run.finishedAt || now,
          lastActivityAt: now,
          errorMessage: run.errorMessage || 'Task run was marked stale after 30 minutes without executor heartbeat.',
        } as any,
      });
    }

    if (staleRuns.length > 0) {
      this.logger.warn(`Reaped ${staleRuns.length} stale task run(s): ${staleRuns.map((run) => run.id).join(', ')}`);
    }

    return {
      reaped: staleRuns.length,
      runIds: staleRuns.map((run) => run.id),
      cutoff: cutoff.toISOString(),
    };
  }

  private normalizeRunStatus(status?: string | null): TaskRunStatus {
    switch ((status || '').toLowerCase()) {
      case 'pending':
        return 'queued';
      case 'completed':
        return 'done';
      case 'cancelling':
        return 'cancelling';
      case 'queued':
      case 'running':
      case 'done':
      case 'failed':
      case 'cancelled':
        return status as TaskRunStatus;
      default:
        return 'queued';
    }
  }

  private normalizeTriggeredBy(triggeredBy?: string | null): TaskRunTrigger {
    switch ((triggeredBy || '').toLowerCase()) {
      case 'manual':
      case 'chat':
      case 'cron':
        return triggeredBy as TaskRunTrigger;
      case 'webhook':
      case 'api':
      default:
        return 'api';
    }
  }

  private buildAgentDefinitionPayload(definition: any) {
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      toolIds: this.parseToolIds(definition.toolIds),
      agentId: definition.agentId || undefined,
    };
  }

  private extractStepsFromProvenance(runId: string, provenance?: ProvenanceTrace | null): RunStep[] {
    const steps = Array.isArray(provenance?.steps) ? provenance.steps : [];

    return steps.map((step: any, index: number) => ({
      id: `${runId}-step-${index}`,
      runId,
      stepIndex: typeof step?.stepIndex === 'number' ? step.stepIndex : index,
      stepType: this.normalizeStepType(step?.stepType),
      toolName: step?.toolName || undefined,
      inputSummary: step?.inputSummary || undefined,
      outputSummary: step?.outputSummary || undefined,
      sourceUrl: step?.sourceUrl || undefined,
      durationMs: typeof step?.durationMs === 'number' ? step.durationMs : 0,
      sandboxed: Boolean(step?.sandboxed),
      timestamp: typeof step?.timestamp === 'string' ? step.timestamp : new Date().toISOString(),
    }));
  }

  private normalizeStepType(stepType: unknown): RunStep['stepType'] {
    switch (stepType) {
      case 'plan':
      case 'tool_call':
      case 'tool_result':
      case 'synthesis':
      case 'error':
      case 'review':
        return stepType;
      default:
        return 'plan';
    }
  }
}
