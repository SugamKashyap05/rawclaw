import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AgentProfile, AutomationJob, AutomationQueueJob, AutomationRun, AutomationRunStatus, ChatMessage, ChatRequest, ContextForkMode, CreateAutomationJobRequest, UpdateAutomationJobRequest } from '@rawclaw/shared';
import { randomUUID } from 'crypto';
import { AgentsService } from './agents.service';
import { ChatService } from './chat.service';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewayEventsService } from './gateway-events.service';
import { GatewayExecutionService } from './gateway-execution.service';
import { GatewayRoutingService } from './gateway-routing.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

interface CronParser {
  parse(expression: string): { next(): { toDate(): Date } };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const parser = require('cron-parser') as CronParser;

@Injectable()
export class GatewayAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routingService: GatewayRoutingService,
    private readonly gatewayEvents: GatewayEventsService,
    private readonly controlPlane: GatewayControlPlaneService,
    private readonly gatewayExecutionService: GatewayExecutionService,
    private readonly agentsService: AgentsService,
    private readonly chatService: ChatService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    void this.controlPlane.bootstrapQueueGroups();
    await this.reconcileNextRuns();
  }

  onModuleDestroy() {}

  private normalizeNullable(value?: string | null): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
  }

  private getNextRun(schedule: string): Date | null {
    try {
      const interval = parser.parse(schedule);
      return interval.next().toDate();
    } catch {
      return null;
    }
  }

  private mapAutomationJob(record: any): AutomationJob {
    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      status: record.status,
      schedule: record.schedule,
      prompt: record.prompt,
      workspaceId: record.workspaceId,
      agentId: record.agentId || null,
      sessionId: record.sessionId || null,
      bindingId: record.bindingId || null,
      surfaceType: record.surfaceType || null,
      senderIdentifier: record.senderIdentifier || null,
      threadKey: record.threadKey || null,
      channelKey: record.channelKey || null,
      toolIds: record.toolIds ? JSON.parse(record.toolIds) : [],
      model: record.model || null,
      contextForkMode: record.contextForkMode,
      maxConcurrency: record.maxConcurrency,
      timeoutSeconds: record.timeoutSeconds,
      maxRetries: record.maxRetries,
      nextRunAt: record.nextRunAt?.toISOString() || null,
      lastRunAt: record.lastRunAt?.toISOString() || null,
      metadata: record.metadataJson ? JSON.parse(record.metadataJson) : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapAutomationRun(record: any): AutomationRun {
    return {
      id: record.id,
      jobId: record.jobId,
      bindingId: record.bindingId || null,
      sessionId: record.sessionId || null,
      agentId: record.agentId || null,
      status: record.status as AutomationRunStatus,
      attempt: record.attempt,
      summary: record.summary || null,
      output: record.output || null,
      sources: record.sourcesJson ? JSON.parse(record.sourcesJson) : [],
      toolCalls: record.toolCallsJson ? JSON.parse(record.toolCallsJson) : [],
      provenanceTrace: record.provenanceJson ? JSON.parse(record.provenanceJson) : null,
      error: record.errorMessage || null,
      startedAt: record.startedAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
      heartbeatAt: record.heartbeatAt?.toISOString() || null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private async resolveAgent(agentId?: string | null): Promise<AgentProfile | null> {
    return this.agentsService.getOptional(agentId || null);
  }

  private async reconcileNextRuns(): Promise<void> {
    const jobs = await this.prisma.gatewayAutomationJob.findMany({
      where: { status: { in: ['active', 'paused'] } },
    });

    for (const job of jobs) {
      if (!job.nextRunAt && job.status === 'active') {
        await this.prisma.gatewayAutomationJob.update({
          where: { id: job.id },
          data: { nextRunAt: this.getNextRun(job.schedule) },
        });
      }
    }
  }

  async listJobs(): Promise<AutomationJob[]> {
    const jobs = await this.prisma.gatewayAutomationJob.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return jobs.map((job) => this.mapAutomationJob(job));
  }

  async getJob(id: string): Promise<AutomationJob> {
    const job = await this.prisma.gatewayAutomationJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Automation job '${id}' not found.`);
    }
    return this.mapAutomationJob(job);
  }

  async listRuns(limit = 25, jobId?: string): Promise<AutomationRun[]> {
    const runs = await this.prisma.gatewayAutomationRun.findMany({
      where: jobId ? { jobId } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.max(1, Math.min(limit, 100)),
    });
    return runs.map((run) => this.mapAutomationRun(run));
  }

  private async validateAgent(agentId?: string | null): Promise<void> {
    if (!agentId) {
      return;
    }
    const agent = await this.resolveAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Unknown agent profile '${agentId}'.`);
    }
  }

  async createJob(payload: CreateAutomationJobRequest): Promise<AutomationJob> {
    await this.validateAgent(payload.agentId);
    const job = await this.prisma.gatewayAutomationJob.create({
      data: {
        name: payload.name.trim(),
        kind: payload.kind,
        status: payload.status || 'active',
        schedule: payload.schedule.trim(),
        prompt: payload.prompt,
        workspaceId: payload.workspaceId || 'default',
        agentId: this.normalizeNullable(payload.agentId),
        sessionId: this.normalizeNullable(payload.sessionId),
        bindingId: this.normalizeNullable(payload.bindingId),
        surfaceType: this.normalizeNullable(payload.surfaceType) || 'automation',
        senderIdentifier: this.normalizeNullable(payload.senderIdentifier) || 'gateway-automation',
        threadKey: this.normalizeNullable(payload.threadKey),
        channelKey: this.normalizeNullable(payload.channelKey),
        toolIds: payload.toolIds?.length ? JSON.stringify(payload.toolIds) : null,
        model: this.normalizeNullable(payload.model),
        contextForkMode: payload.contextForkMode || 'recent',
        maxConcurrency: Math.max(1, payload.maxConcurrency || 1),
        timeoutSeconds: Math.max(30, payload.timeoutSeconds || 600),
        maxRetries: Math.max(0, payload.maxRetries || 1),
        metadataJson: payload.metadata ? JSON.stringify(payload.metadata) : null,
        nextRunAt: (payload.status || 'active') === 'active' ? this.getNextRun(payload.schedule.trim()) : null,
      },
    });

    await this.gatewayEvents.publish({
      type: 'automation.job.lifecycle',
      summary: `Automation job ${job.name} created`,
      agentId: job.agentId,
      sessionId: job.sessionId,
      bindingId: job.bindingId,
      payload: { action: 'created', kind: job.kind, status: job.status },
    });

    return this.mapAutomationJob(job);
  }

  async updateJob(id: string, payload: UpdateAutomationJobRequest): Promise<AutomationJob> {
    await this.getJob(id);
    if (payload.agentId !== undefined) {
      await this.validateAgent(payload.agentId);
    }

    const updated = await this.prisma.gatewayAutomationJob.update({
      where: { id },
      data: {
        name: payload.name?.trim(),
        kind: payload.kind,
        status: payload.status,
        schedule: payload.schedule?.trim(),
        prompt: payload.prompt,
        workspaceId: payload.workspaceId,
        agentId: payload.agentId === undefined ? undefined : this.normalizeNullable(payload.agentId),
        sessionId: payload.sessionId === undefined ? undefined : this.normalizeNullable(payload.sessionId),
        bindingId: payload.bindingId === undefined ? undefined : this.normalizeNullable(payload.bindingId),
        surfaceType: payload.surfaceType === undefined ? undefined : this.normalizeNullable(payload.surfaceType),
        senderIdentifier: payload.senderIdentifier === undefined ? undefined : this.normalizeNullable(payload.senderIdentifier),
        threadKey: payload.threadKey === undefined ? undefined : this.normalizeNullable(payload.threadKey),
        channelKey: payload.channelKey === undefined ? undefined : this.normalizeNullable(payload.channelKey),
        toolIds: payload.toolIds === undefined ? undefined : (payload.toolIds.length ? JSON.stringify(payload.toolIds) : null),
        model: payload.model === undefined ? undefined : this.normalizeNullable(payload.model),
        contextForkMode: payload.contextForkMode,
        maxConcurrency: payload.maxConcurrency === undefined ? undefined : Math.max(1, payload.maxConcurrency),
        timeoutSeconds: payload.timeoutSeconds === undefined ? undefined : Math.max(30, payload.timeoutSeconds),
        maxRetries: payload.maxRetries === undefined ? undefined : Math.max(0, payload.maxRetries),
        metadataJson: payload.metadata === undefined ? undefined : (payload.metadata ? JSON.stringify(payload.metadata) : null),
        nextRunAt: payload.status === 'paused' || payload.status === 'disabled'
          ? null
          : payload.schedule
            ? this.getNextRun(payload.schedule.trim())
            : undefined,
      },
    });

    await this.gatewayEvents.publish({
      type: 'automation.job.lifecycle',
      summary: `Automation job ${updated.name} updated`,
      agentId: updated.agentId,
      sessionId: updated.sessionId,
      bindingId: updated.bindingId,
      payload: { action: 'updated', kind: updated.kind, status: updated.status },
    });

    return this.mapAutomationJob(updated);
  }

  async deleteJob(id: string): Promise<{ success: true }> {
    const job = await this.prisma.gatewayAutomationJob.findUnique({ where: { id } });
    if (job) {
      await this.prisma.gatewayAutomationJob.delete({ where: { id } });
      await this.gatewayEvents.publish({
        type: 'automation.job.lifecycle',
        summary: `Automation job ${job.name} deleted`,
        agentId: job.agentId,
        sessionId: job.sessionId,
        bindingId: job.bindingId,
        payload: { action: 'deleted', kind: job.kind, status: job.status },
      });
    }
    return { success: true };
  }

  private summarizeOutput(content: string, fallback: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return fallback;
    }
    return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
  }

  private async buildMessages(sessionId: string | null, prompt: string, forkMode: ContextForkMode): Promise<ChatMessage[]> {
    if (!sessionId || forkMode === 'none') {
      return [{ role: 'user', content: prompt }];
    }

    const parentMessages = await this.chatService.getMessages(sessionId);
    if (!parentMessages.length) {
      return [{ role: 'user', content: prompt }];
    }

    if (forkMode === 'compact_summary') {
      const compact = parentMessages
        .slice(-6)
        .map((message) => `${message.role}: ${message.content}`.replace(/\s+/g, ' ').trim())
        .join('\n')
        .slice(0, 1600);
      return [
        { role: 'system', content: `Existing session context summary:\n${compact}` },
        { role: 'user', content: prompt },
      ];
    }

    return [
      ...parentMessages.slice(-8).map((message) => ({
        role: message.role,
        content: message.content,
        name: message.name,
      })) as ChatMessage[],
      { role: 'user', content: prompt },
    ];
  }

  private async buildRequest(job: any, selectedAgent: AgentProfile | null, binding: any): Promise<ChatRequest> {
    const tools = await this.gatewayExecutionService.fetchToolSchemas(job.toolIds ? JSON.parse(job.toolIds) : []);
    const messages = await this.buildMessages(binding.sessionId || job.sessionId || null, job.prompt, job.contextForkMode as ContextForkMode);

    return {
      session_id: binding.sessionId,
      messages,
      model: job.model || selectedAgent?.modelId || undefined,
      workspace_id: binding.workspaceId,
      sender_identifier: binding.senderIdentifier,
      agent_id: binding.agentId || undefined,
      surfaceType: binding.surfaceType,
      threadKey: binding.threadKey || undefined,
      channelKey: binding.channelKey || undefined,
      tools,
      gateway_context: {
        workspace_path: process.cwd(),
        memory_scope: 'workspace',
        resolved_agent_profile: {
          id: selectedAgent?.id || binding.agentId || 'main',
          name: selectedAgent?.name || binding.agentId || 'Main',
          workspace_id: binding.workspaceId,
          workspace_path: process.cwd(),
          default_model: selectedAgent?.modelId || job.model || undefined,
          allowed_tools: job.toolIds ? JSON.parse(job.toolIds) : [],
          memory_scope: 'workspace',
          prompt_files: [],
          research_defaults: {},
          active: true,
        },
        routing_binding: this.routingService.toRoutingContext(binding, job.toolIds ? JSON.parse(job.toolIds) : []),
      },
    };
  }

  private async canLaunch(job: any): Promise<boolean> {
    const activeCount = await this.prisma.gatewayAutomationRun.count({
      where: {
        status: 'running',
        job: {
          workspaceId: job.workspaceId,
          agentId: job.agentId || null,
        },
      },
    });
    return activeCount < job.maxConcurrency;
  }

  private lockKey(jobId: string): string {
    return `gateway:automation:job:${jobId}:lock`;
  }

  private async launchJob(job: any, attempt = 1): Promise<AutomationRun | null> {
    const lockAcquired = await this.redis.setJsonIfAbsent(this.lockKey(job.id), { jobId: job.id, attempt }, Math.max(30, job.timeoutSeconds));
    if (!lockAcquired) {
      return null;
    }

    try {
      if (!(await this.canLaunch(job))) {
        return null;
      }

      const boundRoute = job.bindingId
        ? await this.prisma.sessionBinding.findUnique({ where: { id: job.bindingId } })
        : null;

      const requestedSessionId = job.sessionId || boundRoute?.sessionId || randomUUID();
      const resolved = await this.routingService.resolveBinding({
        sessionId: requestedSessionId,
        workspaceId: job.workspaceId,
        senderIdentifier: job.senderIdentifier || boundRoute?.senderIdentifier || 'gateway-automation',
        surfaceType: job.surfaceType || boundRoute?.surfaceType || 'automation',
        threadKey: job.threadKey || boundRoute?.threadKey || null,
        channelKey: job.channelKey || boundRoute?.channelKey || null,
        agentId: job.agentId || boundRoute?.agentId || 'main',
        delegationDepth: 0,
        allowedTools: job.toolIds ? JSON.parse(job.toolIds) : [],
      });

      const run = await this.prisma.gatewayAutomationRun.create({
        data: {
          jobId: job.id,
          bindingId: resolved.binding.id,
          sessionId: resolved.binding.sessionId,
          agentId: resolved.binding.agentId || null,
          status: 'queued',
          attempt,
        },
      });
      await this.prisma.gatewayAutomationJob.update({
        where: { id: job.id },
        data: {
          nextRunAt: job.status === 'active' ? this.getNextRun(job.schedule) : null,
        },
      });
      const selectedAgent = await this.resolveAgent(resolved.binding.agentId || job.agentId || null);
      const requestPayload = await this.buildRequest(job, selectedAgent, resolved.binding as any);

      await this.gatewayEvents.publish({
        type: 'automation.run.queued',
        sessionId: resolved.binding.sessionId,
        bindingId: resolved.binding.id,
        runId: run.id,
        agentId: resolved.binding.agentId,
        summary: `Automation run queued for ${job.name}`,
        payload: { jobId: job.id, kind: job.kind, attempt },
      });
      await this.controlPlane.markRunQueued({
        id: run.id,
        kind: 'automation',
        sessionId: resolved.binding.sessionId,
        bindingId: resolved.binding.id,
        agentId: resolved.binding.agentId,
        queueType: 'automation',
        jobId: run.id,
        summary: `Automation run queued for ${job.name}`,
        metadata: {
          jobId: job.id,
          kind: job.kind,
          attempt,
        },
      });
      await this.controlPlane.enqueueAutomationJob({
        runId: run.id,
        jobId: job.id,
        bindingId: resolved.binding.id,
        sessionId: resolved.binding.sessionId,
        agentId: resolved.binding.agentId,
        requestPayload: requestPayload as unknown as Record<string, unknown>,
        workerId: null,
      });
      await this.controlPlane.appendShortTermMemory({
        sessionId: resolved.binding.sessionId,
        runId: run.id,
        subagentId: null,
        kind: 'handoff_context',
        value: {
          jobId: job.id,
          jobName: job.name,
          prompt: job.prompt,
          kind: job.kind,
          toolIds: job.toolIds ? JSON.parse(job.toolIds) : [],
        },
      });
      return this.mapAutomationRun(run);
    } finally {
      await this.redis.delete(this.lockKey(job.id));
    }
  }

  private async executeRun(job: any, runId: string, bindingId: string): Promise<'completed' | 'failed' | 'cancelled'> {
    const run = await this.prisma.gatewayAutomationRun.findUnique({ where: { id: runId } });
    if (!run) {
      return 'failed';
    }

    const binding = await this.prisma.sessionBinding.findUnique({ where: { id: bindingId } });
    if (!binding) {
      await this.prisma.gatewayAutomationRun.update({
        where: { id: runId },
        data: { status: 'failed', errorMessage: 'Binding disappeared before execution.', finishedAt: new Date() },
      });
      await this.controlPlane.markRunTerminal(runId, 'failed', 'Binding disappeared before execution.', 'Binding disappeared before execution.');
      return 'failed';
    }

    let selectedAgent = await this.resolveAgent(binding.agentId || job.agentId || null);
    const request = await this.buildRequest(job, selectedAgent, binding);

    await this.prisma.gatewayAutomationRun.update({
      where: { id: runId },
      data: { status: 'running', startedAt: new Date(), heartbeatAt: new Date() },
    });
    await this.routingService.markRunStarted(binding.id, runId);
    await this.controlPlane.markRunStarted(runId, `Automation run started for ${job.name}`);
    await this.gatewayEvents.publish({
      type: 'automation.run.started',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId,
      agentId: binding.agentId,
      summary: `Automation run started for ${job.name}`,
      payload: { jobId: job.id, kind: job.kind, attempt: run.attempt },
    });

    try {
      const result = await this.gatewayExecutionService.executeChatRun(
        request,
        job.timeoutSeconds * 1000,
        async () => {
          await this.prisma.gatewayAutomationRun.update({
            where: { id: runId },
            data: { heartbeatAt: new Date() },
          });
          await this.routingService.heartbeat(binding.id, runId);
          await this.controlPlane.markRunHeartbeat(runId);
          await this.gatewayEvents.publish({
            type: 'automation.run.heartbeat',
            sessionId: binding.sessionId,
            bindingId: binding.id,
            runId,
            agentId: binding.agentId,
            summary: `Automation run heartbeat for ${job.name}`,
            payload: { jobId: job.id, kind: job.kind },
          });
        },
        async () => {
          const current = await this.prisma.gatewayAutomationRun.findUnique({ where: { id: runId } });
          return current?.status === 'cancelled';
        },
      );

      const summary = this.summarizeOutput(result.content, `${job.name} completed.`);
      await this.prisma.gatewayAutomationRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          summary,
          output: result.content,
          sourcesJson: JSON.stringify(result.sources || []),
          toolCallsJson: JSON.stringify(result.toolCalls || []),
          provenanceJson: result.provenanceTrace ? JSON.stringify(result.provenanceTrace) : null,
          finishedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });
      await this.controlPlane.captureRoleTraceFromProvenance({
        sessionId: binding.sessionId,
        runId,
        provenanceTrace: result.provenanceTrace,
        bindingId: binding.id,
        agentId: binding.agentId,
        source: 'automation',
      });
      await this.prisma.gatewayAutomationJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: job.status === 'active' ? this.getNextRun(job.schedule) : null,
        },
      });
      await this.routingService.markRunFinished(binding.id, runId, 'completed');
      await this.controlPlane.markRunTerminal(runId, 'completed', summary, null);
      await this.gatewayEvents.publish({
        type: 'automation.run.completed',
        sessionId: binding.sessionId,
        bindingId: binding.id,
        runId,
        agentId: binding.agentId,
        summary: `Automation run completed for ${job.name}`,
        payload: { jobId: job.id, kind: job.kind, summary },
      });

      await this.chatService.createMessage(binding.sessionId, 'assistant', summary, {
        agentId: binding.agentId || undefined,
        runIds: [runId],
      });
      return 'completed';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = message === 'Cancelled by operator';
      await this.prisma.gatewayAutomationRun.update({
        where: { id: runId },
        data: {
          status: cancelled ? 'cancelled' : 'failed',
          summary: cancelled ? 'Automation run cancelled by operator.' : `Automation run failed: ${message}`,
          errorMessage: message,
          finishedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });
      await this.routingService.markRunFinished(binding.id, runId, 'failed', message);
      await this.controlPlane.markRunTerminal(
        runId,
        cancelled ? 'cancelled' : 'failed',
        cancelled ? 'Automation run cancelled by operator.' : `Automation run failed: ${message}`,
        message,
      );
      await this.gatewayEvents.publish({
        type: cancelled ? 'automation.run.cancelled' : 'automation.run.failed',
        sessionId: binding.sessionId,
        bindingId: binding.id,
        runId,
        agentId: binding.agentId,
        summary: cancelled ? `Automation run cancelled for ${job.name}` : `Automation run failed for ${job.name}`,
        payload: { jobId: job.id, kind: job.kind, error: message, cancelled },
      });

      if (!cancelled && run.attempt <= job.maxRetries) {
        const nextAttempt = run.attempt + 1;
        this.logger.warn(`Retrying automation job ${job.name} (attempt ${nextAttempt}/${job.maxRetries + 1})`);
        setTimeout(() => {
          void this.launchJob(job, nextAttempt);
        }, 0);
      } else {
        await this.prisma.gatewayAutomationJob.update({
          where: { id: job.id },
          data: {
            lastRunAt: new Date(),
            nextRunAt: job.status === 'active' ? this.getNextRun(job.schedule) : null,
          },
        });
      }
      return cancelled ? 'cancelled' : 'failed';
    }
  }

  private async getQueuedRunContext(runId: string): Promise<{
    queueJob: AutomationQueueJob;
    run: any;
    job: any;
    binding: any;
  }> {
    const queueJob = await this.controlPlane.getAutomationJob(runId);
    if (!queueJob) {
      throw new NotFoundException(`Queued automation job for run '${runId}' not found.`);
    }
    const run = await this.prisma.gatewayAutomationRun.findUnique({
      where: { id: runId },
      include: { job: true },
    });
    if (!run) {
      throw new NotFoundException(`Automation run '${runId}' not found.`);
    }
    const binding = await this.prisma.sessionBinding.findUnique({ where: { id: queueJob.bindingId } });
    if (!binding) {
      throw new NotFoundException(`Binding '${queueJob.bindingId}' not found for automation run '${runId}'.`);
    }
    return { queueJob, run, job: run.job, binding };
  }

  async markQueuedRunStarted(runId: string, workerId: string): Promise<void> {
    const { queueJob, run, job, binding } = await this.getQueuedRunContext(runId);
    await this.prisma.gatewayAutomationRun.update({
      where: { id: runId },
      data: { status: 'running', startedAt: new Date(), heartbeatAt: new Date() },
    });
    await this.controlPlane.updateAutomationJob(runId, {
      status: 'running',
      workerId,
    });
    await this.controlPlane.putWorkerLease({
      workerId,
      jobId: runId,
      queueType: 'automation',
      runId,
      sessionId: queueJob.sessionId,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await this.controlPlane.heartbeatWorker({
      workerId,
      currentJobId: runId,
      currentRunId: runId,
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      status: 'busy',
    });
    await this.routingService.markRunStarted(binding.id, runId);
    await this.controlPlane.markRunStarted(runId, `Automation run started for ${job.name}`, workerId);
    await this.gatewayEvents.publish({
      type: 'automation.job.started',
      sessionId: queueJob.sessionId,
      bindingId: queueJob.bindingId,
      runId,
      agentId: queueJob.agentId ?? null,
      summary: `Automation job started on worker ${workerId}`,
      payload: { jobId: job.id, workerId },
    });
  }

  async markQueuedRunHeartbeat(runId: string, workerId: string): Promise<void> {
    const { queueJob, binding } = await this.getQueuedRunContext(runId);
    const leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
    await this.prisma.gatewayAutomationRun.update({
      where: { id: runId },
      data: { heartbeatAt: new Date() },
    });
    await this.controlPlane.updateAutomationJob(runId, {
      workerId,
    });
    await this.controlPlane.putWorkerLease({
      workerId,
      jobId: runId,
      queueType: 'automation',
      runId,
      sessionId: queueJob.sessionId,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt,
    });
    await this.controlPlane.heartbeatWorker({
      workerId,
      currentJobId: runId,
      currentRunId: runId,
      leaseExpiresAt,
      status: 'busy',
    });
    await this.routingService.heartbeat(binding.id, runId);
    await this.controlPlane.markRunHeartbeat(runId, workerId);
  }

  async completeQueuedRun(params: {
    runId: string;
    workerId: string;
    output: string;
    sources?: string[];
    toolCalls?: Record<string, unknown>[];
    provenanceTrace?: Record<string, unknown> | null;
  }): Promise<void> {
    const { queueJob, job, binding } = await this.getQueuedRunContext(params.runId);
    const summary = this.summarizeOutput(params.output, `${job.name} completed.`);
    await this.prisma.gatewayAutomationRun.update({
      where: { id: params.runId },
      data: {
        status: 'completed',
        summary,
        output: params.output,
        sourcesJson: JSON.stringify(params.sources || []),
        toolCallsJson: JSON.stringify(params.toolCalls || []),
        provenanceJson: params.provenanceTrace ? JSON.stringify(params.provenanceTrace) : null,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    await this.controlPlane.captureRoleTraceFromProvenance({
      sessionId: binding.sessionId,
      runId: params.runId,
      provenanceTrace: params.provenanceTrace || null,
      bindingId: binding.id,
      agentId: binding.agentId,
      workerId: params.workerId,
      source: 'automation',
    });
    await this.prisma.gatewayAutomationJob.update({
      where: { id: job.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: job.status === 'active' ? this.getNextRun(job.schedule) : null,
      },
    });
    await this.routingService.markRunFinished(binding.id, params.runId, 'completed');
    await this.controlPlane.markRunTerminal(params.runId, 'completed', summary, null, params.workerId);
    await this.controlPlane.updateAutomationJob(params.runId, {
      status: 'completed',
      workerId: params.workerId,
    });
    await this.controlPlane.clearWorkerLease(params.runId);
    await this.controlPlane.heartbeatWorker({
      workerId: params.workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    await this.gatewayEvents.publish({
      type: 'automation.run.completed',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId: params.runId,
      agentId: binding.agentId,
      summary: `Automation run completed for ${job.name}`,
      payload: { jobId: job.id, kind: job.kind, summary, workerId: params.workerId },
    });
    await this.gatewayEvents.publish({
      type: 'automation.job.completed',
      sessionId: queueJob.sessionId,
      bindingId: queueJob.bindingId,
      runId: params.runId,
      agentId: queueJob.agentId ?? null,
      summary: `Automation queue worker completed run ${params.runId}`,
      payload: { jobId: queueJob.jobId, workerId: params.workerId, status: 'completed' },
    });
    await this.chatService.createMessage(binding.sessionId, 'assistant', summary, {
      agentId: binding.agentId || undefined,
      runIds: [params.runId],
    });
  }

  async failQueuedRun(params: {
    runId: string;
    workerId: string;
    error: string;
    cancelled?: boolean;
  }): Promise<void> {
    const { queueJob, job, binding, run } = await this.getQueuedRunContext(params.runId);
    const cancelled = params.cancelled || params.error === 'Cancelled by operator';
    await this.prisma.gatewayAutomationRun.update({
      where: { id: params.runId },
      data: {
        status: cancelled ? 'cancelled' : 'failed',
        summary: cancelled ? 'Automation run cancelled by operator.' : `Automation run failed: ${params.error}`,
        errorMessage: params.error,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    await this.routingService.markRunFinished(binding.id, params.runId, 'failed', params.error);
    await this.controlPlane.markRunTerminal(
      params.runId,
      cancelled ? 'cancelled' : 'failed',
      cancelled ? 'Automation run cancelled by operator.' : `Automation run failed: ${params.error}`,
      params.error,
      params.workerId,
    );
    await this.controlPlane.updateAutomationJob(params.runId, {
      status: cancelled ? 'cancelled' : 'failed',
      workerId: params.workerId,
    });
    await this.controlPlane.clearWorkerLease(params.runId);
    await this.controlPlane.heartbeatWorker({
      workerId: params.workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    await this.gatewayEvents.publish({
      type: cancelled ? 'automation.run.cancelled' : 'automation.run.failed',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId: params.runId,
      agentId: binding.agentId,
      summary: cancelled ? `Automation run cancelled for ${job.name}` : `Automation run failed for ${job.name}`,
      payload: { jobId: job.id, kind: job.kind, error: params.error, cancelled, workerId: params.workerId },
    });
    await this.gatewayEvents.publish({
      type: 'automation.job.failed',
      sessionId: queueJob.sessionId,
      bindingId: queueJob.bindingId,
      runId: params.runId,
      agentId: queueJob.agentId ?? null,
      summary: `Automation queue worker failed run ${params.runId}`,
      payload: { jobId: queueJob.jobId, workerId: params.workerId, cancelled, error: params.error },
    });
    if (!cancelled && run.attempt <= job.maxRetries) {
      const nextAttempt = run.attempt + 1;
      setTimeout(() => {
        void this.launchJob(job, nextAttempt);
      }, 0);
    } else {
      await this.prisma.gatewayAutomationJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: job.status === 'active' ? this.getNextRun(job.schedule) : null,
        },
      });
    }
  }

  async cancelRun(runId: string): Promise<{ success: true; message: string }> {
    const run = await this.prisma.gatewayAutomationRun.findUnique({
      where: { id: runId },
      include: { job: true },
    });
    if (!run) {
      throw new NotFoundException(`Automation run '${runId}' not found.`);
    }

    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      return {
        success: true,
        message: `Automation run ${runId} is already ${run.status}.`,
      };
    }

    await this.prisma.gatewayAutomationRun.update({
      where: { id: runId },
      data: {
        status: 'cancelled',
        summary: 'Automation run cancelled by operator.',
        errorMessage: 'Cancelled by operator',
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });

    await this.gatewayEvents.publish({
      type: 'automation.run.cancelled',
      sessionId: run.sessionId,
      bindingId: run.bindingId,
      runId,
      agentId: run.agentId,
      summary: `Automation run ${runId} cancelled by operator`,
      payload: { jobId: run.jobId, kind: run.job.kind, cancelled: true },
    });

    return {
      success: true,
      message: `Cancellation requested for automation run ${runId}.`,
    };
  }

  async retryRun(runId: string): Promise<AutomationRun> {
    const previous = await this.prisma.gatewayAutomationRun.findUnique({
      where: { id: runId },
      include: { job: true },
    });
    if (!previous) {
      throw new NotFoundException(`Automation run '${runId}' not found.`);
    }

    const launched = await this.launchJob(previous.job, Math.max(1, previous.attempt + 1));
    if (!launched) {
      throw new Error(`Automation run ${runId} could not be retried right now.`);
    }
    return launched;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleAutomationTick() {
    await this.failStaleRuns();

    const now = new Date();
    const dueJobs = await this.prisma.gatewayAutomationJob.findMany({
      where: {
        status: 'active',
        nextRunAt: { lte: now },
      },
      orderBy: [{ nextRunAt: 'asc' }],
    });

    for (const job of dueJobs) {
      await this.launchJob(job, 1);
    }
  }

  private async failStaleRuns(): Promise<void> {
    const runningRuns = await this.prisma.gatewayAutomationRun.findMany({
      where: { status: 'running' },
      include: { job: true },
    });

    const now = Date.now();
    for (const run of runningRuns) {
      const heartbeatAt = run.heartbeatAt?.getTime() || run.startedAt?.getTime() || run.createdAt.getTime();
      const staleAfterMs = Math.max(30000, run.job.timeoutSeconds * 1000);
      if (now - heartbeatAt <= staleAfterMs) {
        continue;
      }

      await this.prisma.gatewayAutomationRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          summary: 'Automation run timed out due to stale heartbeat.',
          errorMessage: 'Stale heartbeat timeout',
          finishedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });
      if (run.bindingId) {
        await this.routingService.markRunFinished(run.bindingId, run.id, 'failed', 'Stale heartbeat timeout');
      }
      await this.gatewayEvents.publish({
        type: 'automation.run.failed',
        sessionId: run.sessionId,
        bindingId: run.bindingId,
        runId: run.id,
        agentId: run.agentId,
        summary: `Automation run timed out for job ${run.job.name}`,
        payload: { jobId: run.jobId, kind: run.job.kind, error: 'Stale heartbeat timeout' },
      });
    }
  }

}
