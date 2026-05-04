import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AgentProfile, AnnounceBackMode, ChatMessage, ChatRequest, ContextForkMode, GatewayAgentProfileSnapshot, SubagentInvocation, SubagentMode, SubagentResult, SubagentRole } from '@rawclaw/shared';
import { randomUUID } from 'crypto';
import { AgentsService } from './agents.service';
import { ChatService } from './chat.service';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewayEventsService } from './gateway-events.service';
import { GatewayExecutionService } from './gateway-execution.service';
import { GatewayRoutingService } from './gateway-routing.service';
import { PrismaService } from './prisma.service';

const MAX_DELEGATION_DEPTH = 3;

@Injectable()
export class GatewaySubagentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewaySubagentService.name);

  constructor(
    private readonly agentsService: AgentsService,
    private readonly routingService: GatewayRoutingService,
    private readonly gatewayEvents: GatewayEventsService,
    private readonly controlPlane: GatewayControlPlaneService,
    private readonly gatewayExecutionService: GatewayExecutionService,
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    void this.controlPlane.bootstrapQueueGroups();
  }

  onModuleDestroy() {}

  private async resolveAgent(agentId?: string): Promise<AgentProfile | null> {
    return this.agentsService.getOptional(agentId || null);
  }

  private normalizeMode(mode?: SubagentMode): SubagentMode {
    return mode === 'blocking' ? 'blocking' : 'background';
  }

  private normalizeForkMode(mode?: ContextForkMode): ContextForkMode {
    return mode === 'none' || mode === 'compact_summary' ? mode : 'recent';
  }

  private normalizeAnnounceBackMode(mode?: AnnounceBackMode): AnnounceBackMode {
    if (mode === 'full_output' || mode === 'artifact_reference') {
      return mode;
    }
    return 'summary';
  }

  private normalizeRole(role?: SubagentRole): SubagentRole {
    if (role === 'strategist' || role === 'scout' || role === 'analyst' || role === 'guardian') {
      return role;
    }
    return 'generic';
  }

  private summarizeContent(content: string, fallback: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return fallback;
    }
    return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
  }

  private async buildForkedMessages(parentSessionId: string, prompt: string, forkMode: ContextForkMode): Promise<ChatMessage[]> {
    if (forkMode === 'none') {
      return [{ role: 'user', content: prompt }];
    }

    const parentMessages = await this.chatService.getMessages(parentSessionId);
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
        { role: 'system', content: `Parent context summary:\n${compact}` },
        { role: 'user', content: prompt },
      ];
    }

    const recentMessages = parentMessages
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content,
        name: message.name,
      })) as ChatMessage[];

    return [
      ...recentMessages,
      { role: 'user', content: `Delegated task:\n${prompt}` },
    ];
  }

  private buildAgentSnapshot(
    selectedAgent: AgentProfile | null,
    workspaceId: string,
    allowedTools: string[],
    model?: string,
  ): GatewayAgentProfileSnapshot {
    return {
      id: selectedAgent?.id || 'main',
      name: selectedAgent?.name || 'Main',
      workspace_id: workspaceId,
      workspace_path: process.cwd(),
      default_model: selectedAgent?.modelId || model || undefined,
      allowed_tools: allowedTools,
      memory_scope: 'workspace',
      prompt_files: [],
      research_defaults: {},
      active: true,
    };
  }

  private async createChildRunRecord(params: {
    bindingId: string;
    parentBindingId?: string | null;
    parentSessionId: string;
    parentRunId: string;
    childSessionId: string;
    agentId?: string | null;
    workspaceId: string;
    mode: SubagentMode;
    contextForkMode: ContextForkMode;
    announceBackMode: AnnounceBackMode;
    timeoutSeconds: number;
  }) {
    return this.prisma.childRun.create({
      data: {
        bindingId: params.bindingId,
        parentBindingId: params.parentBindingId || null,
        parentSessionId: params.parentSessionId,
        parentRunId: params.parentRunId,
        childSessionId: params.childSessionId,
        agentId: params.agentId || null,
        workspaceId: params.workspaceId,
        status: 'queued',
        mode: params.mode,
        contextForkMode: params.contextForkMode,
        announceBackMode: params.announceBackMode,
        timeoutSeconds: params.timeoutSeconds,
      },
    });
  }

  private async buildExecutionRequest(params: {
    selectedAgent: AgentProfile | null;
    resolvedBinding: { binding: any; routing: any };
    invocation: SubagentInvocation;
    allowedTools: string[];
    contextForkMode: ContextForkMode;
  }): Promise<ChatRequest> {
    const { selectedAgent, resolvedBinding, invocation, allowedTools, contextForkMode } = params;
    const tools = await this.gatewayExecutionService.fetchToolSchemas(allowedTools);
    const messages = await this.buildForkedMessages(invocation.parentSessionId, invocation.prompt, contextForkMode);

    return {
      session_id: resolvedBinding.binding.sessionId,
      messages,
      model: invocation.model || selectedAgent?.modelId || undefined,
      workspace_id: resolvedBinding.binding.workspaceId,
      sender_identifier: resolvedBinding.binding.senderIdentifier,
      agent_id: resolvedBinding.binding.agentId || undefined,
      surfaceType: resolvedBinding.binding.surfaceType,
      threadKey: resolvedBinding.binding.threadKey || undefined,
      channelKey: resolvedBinding.binding.channelKey || undefined,
      tools,
      gateway_context: {
        workspace_path: process.cwd(),
        memory_scope: 'workspace',
        resolved_agent_profile: this.buildAgentSnapshot(selectedAgent, resolvedBinding.binding.workspaceId, allowedTools, invocation.model),
        routing_binding: resolvedBinding.routing,
      },
    };
  }

  private async announceBackResult(record: any): Promise<void> {
    const mode = this.normalizeAnnounceBackMode(record.announceBackMode as AnnounceBackMode);
    const summary = record.summary || (record.status === 'failed' ? `Subagent failed: ${record.errorMessage || 'Unknown error'}` : 'Subagent completed.');
    const fullOutput = record.fullOutput || '';
    const messageContent =
      mode === 'full_output'
        ? fullOutput || summary
        : mode === 'artifact_reference'
          ? `${summary}\n\nReference: child run ${record.id}, child session ${record.childSessionId}.`
          : `${summary}\n\nChild run ${record.id} is attached to session ${record.childSessionId}.`;

    await this.chatService.createMessage(record.parentSessionId, 'assistant', messageContent, {
      agentId: record.agentId || undefined,
      runIds: [record.id],
    });

    await this.gatewayEvents.publish({
      type: 'subagent.announced_back',
      sessionId: record.parentSessionId,
      bindingId: record.parentBindingId || null,
      runId: record.id,
      agentId: record.agentId || null,
      parentSessionId: record.parentSessionId,
      parentRunId: record.parentRunId,
      summary: `Subagent announced back to parent session ${record.parentSessionId}`,
      payload: {
        childSessionId: record.childSessionId,
        announceBackMode: mode,
        status: record.status,
        summary,
      },
    });
  }

  private async executeChildRun(params: {
    recordId: string;
    selectedAgent: AgentProfile | null;
    resolvedBinding: { binding: any; routing: any };
    invocation: SubagentInvocation;
    timeoutSeconds: number;
    contextForkMode: ContextForkMode;
    announceBackMode: AnnounceBackMode;
    allowedTools: string[];
    role: SubagentRole;
    queuedJobId?: string | null;
    preparedRequest?: ChatRequest | null;
  }): Promise<SubagentResult> {
    const { recordId, resolvedBinding, invocation, timeoutSeconds, contextForkMode, announceBackMode, allowedTools, role, queuedJobId, preparedRequest } = params;
    let selectedAgent = params.selectedAgent;

    if (!selectedAgent || selectedAgent.id !== (resolvedBinding.binding.agentId || 'main')) {
      selectedAgent = await this.resolveAgent(resolvedBinding.binding.agentId || undefined);
    }

    await this.prisma.childRun.update({
      where: { id: recordId },
      data: {
        status: 'running',
        startedAt: new Date(),
        agentId: selectedAgent?.id || resolvedBinding.binding.agentId || null,
      },
    });

    await this.gatewayEvents.publish({
      type: 'subagent.started',
      sessionId: resolvedBinding.binding.sessionId,
      bindingId: resolvedBinding.binding.id,
      runId: recordId,
      agentId: resolvedBinding.binding.agentId,
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      summary: `Subagent ${recordId} started`,
      payload: {
        role,
        mode: this.normalizeMode(invocation.mode),
      },
    });

    await this.gatewayEvents.publish({
      type: 'subagent.spawned',
      sessionId: resolvedBinding.binding.sessionId,
      bindingId: resolvedBinding.binding.id,
      runId: recordId,
      agentId: resolvedBinding.binding.agentId,
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      summary: `Subagent execution started for session ${invocation.parentSessionId}`,
      payload: {
        mode: this.normalizeMode(invocation.mode),
        contextForkMode,
        announceBackMode,
      },
    });

    await this.routingService.markRunStarted(resolvedBinding.binding.id, recordId);
    await this.controlPlane.markRunStarted(recordId, `Subagent ${role} started`);
    if (queuedJobId) {
      await this.controlPlane.updateSubagentJob(queuedJobId, { status: 'running' });
      await this.gatewayEvents.publish({
        type: 'subagent.job.started',
        sessionId: resolvedBinding.binding.sessionId,
        bindingId: resolvedBinding.binding.id,
        runId: recordId,
        agentId: resolvedBinding.binding.agentId,
        parentSessionId: invocation.parentSessionId,
        parentRunId: invocation.parentRunId,
        summary: `Subagent job ${queuedJobId} started`,
        payload: {
          jobId: queuedJobId,
          role,
        },
      });
    }

    try {
      const request = preparedRequest || await this.buildExecutionRequest({
        selectedAgent,
        resolvedBinding,
        invocation,
        allowedTools,
        contextForkMode,
      });

      const result = await this.gatewayExecutionService.executeChatRun(
        request,
        timeoutSeconds * 1000,
        async () => {
          await this.routingService.heartbeat(resolvedBinding.binding.id, recordId);
          await this.controlPlane.markRunHeartbeat(recordId);
        },
        async () => {
          const current = await this.prisma.childRun.findUnique({ where: { id: recordId } });
          return current?.status === 'cancelled';
        },
      );

      const summary = this.summarizeContent(result.content, 'Subagent completed.');
      const updated = await this.prisma.childRun.update({
        where: { id: recordId },
        data: {
          status: 'completed',
          summary,
          fullOutput: result.content,
          sourcesJson: JSON.stringify(result.sources || []),
          toolCallsJson: JSON.stringify(result.toolCalls || []),
          provenanceJson: result.provenanceTrace ? JSON.stringify(result.provenanceTrace) : null,
          finishedAt: new Date(),
        },
      });

      await this.controlPlane.captureRoleTraceFromProvenance({
        sessionId: resolvedBinding.binding.sessionId,
        runId: recordId,
        provenanceTrace: result.provenanceTrace,
        bindingId: resolvedBinding.binding.id,
        agentId: resolvedBinding.binding.agentId,
        parentSessionId: invocation.parentSessionId,
        parentRunId: invocation.parentRunId,
        source: 'subagent',
      });
      await this.routingService.markRunFinished(resolvedBinding.binding.id, recordId, 'completed');
      await this.controlPlane.markRunTerminal(recordId, 'completed', summary, null);
      await this.gatewayEvents.publish({
        type: 'subagent.completed',
        sessionId: resolvedBinding.binding.sessionId,
        bindingId: resolvedBinding.binding.id,
        runId: recordId,
        agentId: resolvedBinding.binding.agentId,
        parentSessionId: invocation.parentSessionId,
        parentRunId: invocation.parentRunId,
        summary: `Subagent completed for ${invocation.parentSessionId}`,
        payload: { summary, sources: result.sources || [] },
      });
      if (queuedJobId) {
        await this.controlPlane.updateSubagentJob(queuedJobId, { status: 'completed' });
        await this.gatewayEvents.publish({
          type: 'subagent.job.completed',
          sessionId: resolvedBinding.binding.sessionId,
          bindingId: resolvedBinding.binding.id,
          runId: recordId,
          agentId: resolvedBinding.binding.agentId,
          parentSessionId: invocation.parentSessionId,
          parentRunId: invocation.parentRunId,
          summary: `Subagent job ${queuedJobId} completed`,
          payload: {
            jobId: queuedJobId,
            role,
            summary,
          },
        });
      }
      await this.announceBackResult(updated);

      return {
        childSessionId: resolvedBinding.binding.sessionId,
        childRunId: recordId,
        parentSessionId: invocation.parentSessionId,
        parentRunId: invocation.parentRunId,
        delegationDepth: resolvedBinding.binding.delegationDepth,
        mode: this.normalizeMode(invocation.mode),
        announceBackMode,
        status: 'completed',
        summary,
        output: result.content,
        sources: result.sources,
        toolCalls: result.toolCalls,
        provenanceTrace: result.provenanceTrace,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = message === 'Cancelled by operator';
      this.logger.error(`Subagent execution failed: ${message}`);
      const updated = await this.prisma.childRun.update({
        where: { id: recordId },
        data: {
          status: cancelled ? 'cancelled' : 'failed',
          summary: cancelled ? 'Subagent cancelled by operator.' : `Subagent failed: ${message}`,
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      await this.routingService.markRunFinished(resolvedBinding.binding.id, recordId, 'failed', message);
      await this.controlPlane.markRunTerminal(
        recordId,
        cancelled ? 'cancelled' : 'failed',
        cancelled ? 'Subagent cancelled by operator.' : `Subagent failed: ${message}`,
        message,
      );
      await this.gatewayEvents.publish({
        type: cancelled ? 'subagent.cancelled' : 'subagent.failed',
        sessionId: resolvedBinding.binding.sessionId,
        bindingId: resolvedBinding.binding.id,
        runId: recordId,
        agentId: resolvedBinding.binding.agentId,
        parentSessionId: invocation.parentSessionId,
        parentRunId: invocation.parentRunId,
        summary: cancelled ? `Subagent cancelled for ${invocation.parentSessionId}` : `Subagent failed for ${invocation.parentSessionId}`,
        payload: { error: message, cancelled },
      });
      if (queuedJobId) {
        await this.controlPlane.updateSubagentJob(queuedJobId, {
          status: cancelled ? 'cancelled' : 'failed',
        });
        await this.gatewayEvents.publish({
          type: 'subagent.job.failed',
          sessionId: resolvedBinding.binding.sessionId,
          bindingId: resolvedBinding.binding.id,
          runId: recordId,
          agentId: resolvedBinding.binding.agentId,
          parentSessionId: invocation.parentSessionId,
          parentRunId: invocation.parentRunId,
          summary: `Subagent job ${queuedJobId} failed`,
          payload: {
            jobId: queuedJobId,
            role,
            cancelled,
            error: message,
          },
        });
      }
      await this.announceBackResult(updated);

      return {
        childSessionId: resolvedBinding.binding.sessionId,
        childRunId: recordId,
        parentSessionId: invocation.parentSessionId,
        parentRunId: invocation.parentRunId,
        delegationDepth: resolvedBinding.binding.delegationDepth,
        mode: this.normalizeMode(invocation.mode),
        announceBackMode,
        status: cancelled ? 'failed' : 'failed',
        summary: cancelled ? 'Subagent cancelled by operator.' : `Subagent failed: ${message}`,
        output: '',
        sources: [],
        toolCalls: [],
        provenanceTrace: null,
        error: message,
      };
    }
  }

  async spawn(invocation: SubagentInvocation): Promise<SubagentResult> {
    let selectedAgent = await this.resolveAgent(invocation.agentId);
    if (invocation.agentId && !selectedAgent) {
      throw new NotFoundException(`Unknown agent profile '${invocation.agentId}'.`);
    }

    const childSessionId = invocation.childSessionId || randomUUID();
    const nextDepth = Math.max(0, invocation.delegationDepth ?? 0) + 1;
    if (nextDepth > MAX_DELEGATION_DEPTH) {
      throw new Error(`Subagent delegation depth exceeded the limit of ${MAX_DELEGATION_DEPTH}.`);
    }

    const mode = this.normalizeMode(invocation.mode);
    const contextForkMode = this.normalizeForkMode(invocation.contextForkMode);
    const announceBackMode = this.normalizeAnnounceBackMode(invocation.announceBackMode);
    const role = this.normalizeRole(invocation.role);
    const timeoutSeconds = Math.max(30, invocation.timeoutSeconds || 180);
    const allowedTools = invocation.allowedTools || [];
    const parentBinding = await this.prisma.sessionBinding.findUnique({
      where: { sessionId: invocation.parentSessionId },
    });

    const resolved = await this.routingService.resolveBinding({
      sessionId: childSessionId,
      workspaceId: invocation.workspaceId || parentBinding?.workspaceId || 'default',
      senderIdentifier: invocation.senderIdentifier || parentBinding?.senderIdentifier || 'gateway-subagent',
      surfaceType: invocation.surfaceType || 'subagent',
      threadKey: invocation.threadKey || parentBinding?.threadKey || null,
      channelKey: invocation.channelKey || parentBinding?.channelKey || null,
      agentId: selectedAgent?.id || invocation.agentId || parentBinding?.agentId || 'main',
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      delegationDepth: nextDepth,
      allowedTools,
    });

    const record = await this.createChildRunRecord({
      bindingId: resolved.binding.id,
      parentBindingId: parentBinding?.id || null,
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      childSessionId: resolved.binding.sessionId,
      agentId: resolved.binding.agentId || null,
      workspaceId: resolved.binding.workspaceId,
      mode,
      contextForkMode,
      announceBackMode,
      timeoutSeconds,
    });

    await this.gatewayEvents.publish({
      type: 'subagent.queued',
      sessionId: resolved.binding.sessionId,
      bindingId: resolved.binding.id,
      runId: record.id,
      agentId: resolved.binding.agentId,
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      summary: `Subagent queued for parent session ${invocation.parentSessionId}`,
      payload: {
        mode,
        contextForkMode,
        announceBackMode,
        timeoutSeconds,
      },
    });
    await this.controlPlane.markRunQueued({
      id: record.id,
      kind: 'subagent',
      sessionId: resolved.binding.sessionId,
      bindingId: resolved.binding.id,
      agentId: resolved.binding.agentId,
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      role,
      queueType: mode === 'blocking' ? null : 'subagent',
      summary: `Subagent ${role} queued for parent session ${invocation.parentSessionId}`,
      metadata: {
        mode,
        contextForkMode,
        announceBackMode,
        timeoutSeconds,
      },
    });
    await this.controlPlane.appendShortTermMemory({
      sessionId: resolved.binding.sessionId,
      runId: record.id,
      subagentId: record.id,
      kind: 'handoff_context',
      value: {
        role,
        prompt: invocation.prompt,
        allowedTools,
        mode,
        contextForkMode,
        announceBackMode,
      },
    });

    if (mode === 'blocking') {
      return this.executeChildRun({
        recordId: record.id,
        selectedAgent,
        resolvedBinding: resolved,
        invocation,
        timeoutSeconds,
        contextForkMode,
        announceBackMode,
        allowedTools,
        role,
      });
    }

    const preparedRequest = await this.buildExecutionRequest({
      selectedAgent,
      resolvedBinding: resolved,
      invocation,
      allowedTools,
      contextForkMode,
    });

    const queuedJob = await this.controlPlane.enqueueSubagentJob({
      recordId: record.id,
      runId: record.id,
      sessionId: resolved.binding.sessionId,
      bindingId: resolved.binding.id,
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      prompt: invocation.prompt,
      agentId: resolved.binding.agentId,
      role,
      mode,
      contextForkMode,
      announceBackMode,
      allowedTools,
      timeoutSeconds,
      requestPayload: preparedRequest as unknown as Record<string, unknown>,
      workerId: null,
    });
    await this.controlPlane.updateRun(record.id, {
      queueType: 'subagent',
      jobId: queuedJob.id,
    });

    return {
      childSessionId: resolved.binding.sessionId,
      childRunId: record.id,
      parentSessionId: invocation.parentSessionId,
      parentRunId: invocation.parentRunId,
      delegationDepth: resolved.binding.delegationDepth,
      mode,
      announceBackMode,
      status: 'queued',
      summary: `Subagent ${role} queued for parent session ${invocation.parentSessionId}.`,
      output: '',
      sources: [],
      toolCalls: [],
      provenanceTrace: null,
      error: null,
    };
  }

  private async getQueuedExecutionContext(jobId: string): Promise<{
    job: any;
    record: any;
    binding: any;
  }> {
    const job = await this.controlPlane.getSubagentJob(jobId);
    if (!job) {
      throw new NotFoundException(`Queued subagent job '${jobId}' not found.`);
    }
    const record = await this.prisma.childRun.findUnique({ where: { id: job.recordId } });
    if (!record) {
      throw new NotFoundException(`Child run '${job.recordId}' not found for job '${jobId}'.`);
    }
    const binding = await this.prisma.sessionBinding.findUnique({ where: { id: job.bindingId } });
    if (!binding) {
      throw new NotFoundException(`Binding '${job.bindingId}' not found for job '${jobId}'.`);
    }
    return { job, record, binding };
  }

  async markQueuedJobStarted(jobId: string, workerId: string): Promise<void> {
    const { job, record, binding } = await this.getQueuedExecutionContext(jobId);
    await this.prisma.childRun.update({
      where: { id: record.id },
      data: {
        status: 'running',
        startedAt: new Date(),
        agentId: record.agentId || binding.agentId || null,
      },
    });
    await this.controlPlane.updateSubagentJob(jobId, {
      status: 'running',
      workerId,
    });
    await this.controlPlane.putWorkerLease({
      workerId,
      jobId,
      queueType: 'subagent',
      runId: job.runId,
      sessionId: job.sessionId,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await this.controlPlane.heartbeatWorker({
      workerId,
      currentJobId: jobId,
      currentRunId: job.runId,
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      status: 'busy',
    });
    await this.routingService.markRunStarted(binding.id, record.id);
    await this.controlPlane.markRunStarted(record.id, `Subagent ${job.role} started`, workerId);
    await this.gatewayEvents.publish({
      type: 'subagent.job.started',
      sessionId: job.sessionId,
      bindingId: job.bindingId,
      runId: job.runId,
      agentId: job.agentId ?? null,
      parentSessionId: job.parentSessionId,
      parentRunId: job.parentRunId,
      summary: `Subagent job ${jobId} started on worker ${workerId}`,
      payload: {
        jobId,
        role: job.role,
        workerId,
      },
    });
  }

  async markQueuedJobHeartbeat(jobId: string, workerId: string): Promise<void> {
    const { job, binding, record } = await this.getQueuedExecutionContext(jobId);
    const leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
    await this.controlPlane.putWorkerLease({
      workerId,
      jobId,
      queueType: 'subagent',
      runId: job.runId,
      sessionId: job.sessionId,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt,
    });
    await this.controlPlane.heartbeatWorker({
      workerId,
      currentJobId: jobId,
      currentRunId: job.runId,
      leaseExpiresAt,
      status: 'busy',
    });
    await this.routingService.heartbeat(binding.id, record.id);
    await this.controlPlane.markRunHeartbeat(record.id, workerId);
  }

  async completeQueuedJob(params: {
    jobId: string;
    workerId: string;
    output: string;
    sources?: string[];
    toolCalls?: Record<string, unknown>[];
    provenanceTrace?: Record<string, unknown> | null;
  }): Promise<void> {
    const { job, record, binding } = await this.getQueuedExecutionContext(params.jobId);
    const summary = this.summarizeContent(params.output, 'Subagent completed.');
    const updated = await this.prisma.childRun.update({
      where: { id: record.id },
      data: {
        status: 'completed',
        summary,
        fullOutput: params.output,
        sourcesJson: JSON.stringify(params.sources || []),
        toolCallsJson: JSON.stringify(params.toolCalls || []),
        provenanceJson: params.provenanceTrace ? JSON.stringify(params.provenanceTrace) : null,
        finishedAt: new Date(),
      },
    });
    await this.controlPlane.captureRoleTraceFromProvenance({
      sessionId: binding.sessionId,
      runId: record.id,
      provenanceTrace: params.provenanceTrace || null,
      bindingId: binding.id,
      agentId: binding.agentId,
      parentSessionId: job.parentSessionId,
      parentRunId: job.parentRunId,
      workerId: params.workerId,
      source: 'subagent',
    });
    await this.routingService.markRunFinished(binding.id, record.id, 'completed');
    await this.controlPlane.markRunTerminal(record.id, 'completed', summary, null, params.workerId);
    await this.controlPlane.updateSubagentJob(params.jobId, {
      status: 'completed',
      workerId: params.workerId,
    });
    await this.controlPlane.clearWorkerLease(params.jobId);
    await this.controlPlane.heartbeatWorker({
      workerId: params.workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    await this.gatewayEvents.publish({
      type: 'subagent.completed',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId: record.id,
      agentId: binding.agentId,
      parentSessionId: job.parentSessionId,
      parentRunId: job.parentRunId,
      summary: `Subagent completed for ${job.parentSessionId}`,
      payload: { summary, sources: params.sources || [], workerId: params.workerId },
    });
    await this.gatewayEvents.publish({
      type: 'subagent.job.completed',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId: record.id,
      agentId: binding.agentId,
      parentSessionId: job.parentSessionId,
      parentRunId: job.parentRunId,
      summary: `Subagent job ${params.jobId} completed`,
      payload: {
        jobId: params.jobId,
        role: job.role,
        workerId: params.workerId,
        summary,
      },
    });
    await this.announceBackResult(updated);
  }

  async failQueuedJob(params: {
    jobId: string;
    workerId: string;
    error: string;
    cancelled?: boolean;
  }): Promise<void> {
    const { job, record, binding } = await this.getQueuedExecutionContext(params.jobId);
    const cancelled = params.cancelled || params.error === 'Cancelled by operator';
    const updated = await this.prisma.childRun.update({
      where: { id: record.id },
      data: {
        status: cancelled ? 'cancelled' : 'failed',
        summary: cancelled ? 'Subagent cancelled by operator.' : `Subagent failed: ${params.error}`,
        errorMessage: params.error,
        finishedAt: new Date(),
      },
    });
    await this.routingService.markRunFinished(binding.id, record.id, 'failed', params.error);
    await this.controlPlane.markRunTerminal(
      record.id,
      cancelled ? 'cancelled' : 'failed',
      cancelled ? 'Subagent cancelled by operator.' : `Subagent failed: ${params.error}`,
      params.error,
      params.workerId,
    );
    await this.controlPlane.updateSubagentJob(params.jobId, {
      status: cancelled ? 'cancelled' : 'failed',
      workerId: params.workerId,
    });
    await this.controlPlane.clearWorkerLease(params.jobId);
    await this.controlPlane.heartbeatWorker({
      workerId: params.workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    await this.gatewayEvents.publish({
      type: cancelled ? 'subagent.cancelled' : 'subagent.failed',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId: record.id,
      agentId: binding.agentId,
      parentSessionId: job.parentSessionId,
      parentRunId: job.parentRunId,
      summary: cancelled ? `Subagent cancelled for ${job.parentSessionId}` : `Subagent failed for ${job.parentSessionId}`,
      payload: { error: params.error, cancelled, workerId: params.workerId },
    });
    await this.gatewayEvents.publish({
      type: 'subagent.job.failed',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId: record.id,
      agentId: binding.agentId,
      parentSessionId: job.parentSessionId,
      parentRunId: job.parentRunId,
      summary: `Subagent job ${params.jobId} failed`,
      payload: {
        jobId: params.jobId,
        role: job.role,
        workerId: params.workerId,
        cancelled,
        error: params.error,
      },
    });
    await this.announceBackResult(updated);
  }

  async cancelRun(runId: string): Promise<{ success: true; message: string }> {
    const record = await this.prisma.childRun.findUnique({ where: { id: runId } });
    if (!record) {
      throw new NotFoundException(`Child run '${runId}' not found.`);
    }

    if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled') {
      return {
        success: true,
        message: `Child run ${runId} is already ${record.status}.`,
      };
    }

    await this.prisma.childRun.update({
      where: { id: runId },
      data: {
        status: 'cancelled',
        summary: 'Subagent cancelled by operator.',
        errorMessage: 'Cancelled by operator',
        finishedAt: new Date(),
      },
    });

    await this.gatewayEvents.publish({
      type: 'subagent.cancelled',
      sessionId: record.childSessionId,
      bindingId: record.bindingId,
      runId,
      agentId: record.agentId,
      parentSessionId: record.parentSessionId,
      parentRunId: record.parentRunId,
      summary: `Subagent ${runId} cancelled by operator`,
      payload: { cancelled: true },
    });

    return {
      success: true,
      message: `Cancellation requested for child run ${runId}.`,
    };
  }
}
