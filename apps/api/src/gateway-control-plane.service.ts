import { Injectable, Logger } from '@nestjs/common';
import {
  AppBuilderQueueJob,
  AutomationQueueJob,
  GatewayExecutionMode,
  GatewayGuardianOutcome,
  GatewayQueueMetadata,
  GatewayRunKind,
  GatewayRunRecord,
  GatewayRunStatus,
  QueueJobSummary,
  SandboxJob,
  RoleTraceSnapshot,
  ShortTermMemoryEntry,
  ShortTermMemoryKind,
  SubagentJob,
  SubagentRole,
  WorkerLease,
  WorkerQueueType,
  WorkerRegistration,
  WorkerStatusSnapshot,
} from '@rawclaw/shared';
import { randomUUID } from 'crypto';
import { GatewayEventsService } from './gateway-events.service';
import { RedisService } from './redis.service';

type RunUpdateInput = {
  status?: GatewayRunStatus;
  executionMode?: GatewayExecutionMode;
  workerId?: string | null;
  queueType?: WorkerQueueType | null;
  jobId?: string | null;
  summary?: string | null;
  error?: string | null;
  guardianOutcome?: GatewayGuardianOutcome | null;
  queueMetadata?: GatewayQueueMetadata | null;
  terminalOutcome?: GatewayRunRecord['terminalOutcome'];
  startedAt?: string | null;
  heartbeatAt?: string | null;
  finishedAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

type RunCreateInput = {
  id?: string;
  kind: GatewayRunKind;
  status: GatewayRunStatus;
  executionMode?: GatewayExecutionMode;
  sessionId?: string | null;
  bindingId?: string | null;
  agentId?: string | null;
  parentSessionId?: string | null;
  parentRunId?: string | null;
  role?: SubagentRole | null;
  workerId?: string | null;
  queueType?: WorkerQueueType | null;
  jobId?: string | null;
  summary?: string | null;
  error?: string | null;
  guardianOutcome?: GatewayGuardianOutcome | null;
  queueMetadata?: GatewayQueueMetadata | null;
  terminalOutcome?: GatewayRunRecord['terminalOutcome'];
  metadata?: Record<string, unknown> | null;
};

const MAX_RECENT_RUNS = 200;
const MAX_RECENT_MEMORY = 200;
const MAX_RECENT_QUEUE_JOBS = 200;
const SUBAGENT_QUEUE_STREAM = 'gateway:queue:subagent';
const SUBAGENT_QUEUE_GROUP = 'gateway-subagent-workers';
const AUTOMATION_QUEUE_STREAM = 'gateway:queue:automation';
const AUTOMATION_QUEUE_GROUP = 'gateway-automation-workers';
const SANDBOX_QUEUE_STREAM = 'gateway:queue:sandbox';
const SANDBOX_QUEUE_GROUP = 'gateway-sandbox-workers';
const BUILDER_QUEUE_STREAM = 'gateway:queue:builder';
const BUILDER_QUEUE_GROUP = 'gateway-builder-workers';
const MAX_RECENT_WORKERS = 120;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class GatewayControlPlaneService {
  private readonly logger = new Logger(GatewayControlPlaneService.name);

  private coerceTrustedTurnId(candidate?: string | null): string {
    const normalized = String(candidate || '').trim();
    if (normalized && UUID_V4_PATTERN.test(normalized)) {
      return normalized;
    }
    if (normalized) {
      this.logger.warn(`Rejected non-UUID turn_id candidate at queue boundary: ${normalized}`);
    }
    return randomUUID();
  }
  private queueGroupsReady = false;
  private queueGroupBootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly gatewayEvents: GatewayEventsService,
  ) {}

  private runKey(runId: string): string {
    return `gateway:run:${runId}`;
  }

  private recentRunsKey(): string {
    return 'gateway:runs:recent';
  }

  private sessionRunsKey(sessionId: string): string {
    return `gateway:session:${sessionId}:runs`;
  }

  private roleTraceRunKey(runId: string): string {
    return `gateway:role-trace:run:${runId}`;
  }

  private roleTraceSessionKey(sessionId: string): string {
    return `gateway:role-trace:session:${sessionId}:latest`;
  }

  private shortTermMemoryKey(sessionId: string): string {
    return `gateway:memory:session:${sessionId}:recent`;
  }

  private shortTermMemoryRunKey(runId: string): string {
    return `gateway:memory:run:${runId}:recent`;
  }

  private subagentJobKey(jobId: string): string {
    return `gateway:subagent-job:${jobId}`;
  }

  private automationJobKey(jobId: string): string {
    return `gateway:automation-job:${jobId}`;
  }

  private recentWorkersKey(): string {
    return 'gateway:workers:recent';
  }

  private workerKey(workerId: string): string {
    return `gateway:worker:${workerId}`;
  }

  private workerLeaseKey(jobId: string): string {
    return `gateway:worker-lease:${jobId}`;
  }

  private recentQueueJobsKey(queueType: WorkerQueueType): string {
    return `gateway:queue:${queueType}:recent`;
  }

  private sandboxJobKey(jobId: string): string {
    return `gateway:sandbox-job:${jobId}`;
  }

  private builderJobKey(jobId: string): string {
    return `gateway:builder-job:${jobId}`;
  }

  async ensureQueueGroups(): Promise<void> {
    if (this.queueGroupsReady) {
      return;
    }
    await this.redis.xGroupCreate(SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP, '0');
    await this.redis.xGroupCreate(AUTOMATION_QUEUE_STREAM, AUTOMATION_QUEUE_GROUP, '0');
    await this.redis.xGroupCreate(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP, '0');
    await this.redis.xGroupCreate(BUILDER_QUEUE_STREAM, BUILDER_QUEUE_GROUP, '0');
    this.queueGroupsReady = true;
  }

  async bootstrapQueueGroups(): Promise<void> {
    if (this.queueGroupsReady) {
      return;
    }
    if (!this.queueGroupBootstrapPromise) {
      this.queueGroupBootstrapPromise = this.bootstrapQueueGroupsLoop();
    }
    await this.queueGroupBootstrapPromise;
  }

  private async bootstrapQueueGroupsLoop(): Promise<void> {
    let attempt = 0;
    while (!this.queueGroupsReady) {
      attempt += 1;
      try {
        const redisReady = await this.redis.waitUntilReady(1500, 250);
        if (!redisReady) {
          throw new Error('Redis is not ready yet.');
        }
        await this.ensureQueueGroups();
        this.logger.log('Gateway queue groups are ready.');
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Gateway queue bootstrap waiting for Redis (attempt=${attempt}): ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    }
  }

  private defaultExecutionMode(kind: GatewayRunKind): GatewayExecutionMode {
    return kind === 'foreground_chat' ? 'foreground' : 'queued';
  }

  private mergeQueueMetadata(
    existing: GatewayQueueMetadata | null | undefined,
    next: GatewayQueueMetadata | null | undefined,
    executionMode: GatewayExecutionMode,
  ): GatewayQueueMetadata {
    const mergedRoles = Array.from(new Set([...(existing?.queuedRoles || []), ...(next?.queuedRoles || [])]));
    const mergedWorkers = Array.from(new Set([...(existing?.workerAssignments || []), ...(next?.workerAssignments || [])].filter(Boolean)));
    return {
      executionMode: next?.executionMode || existing?.executionMode || executionMode,
      queuedRoles: mergedRoles,
      workerAssignments: mergedWorkers,
      queueFallbackUsed: Boolean(existing?.queueFallbackUsed || next?.queueFallbackUsed),
    };
  }

  private collectWorkerAssignments(roleTrace: Record<string, unknown>, workerId?: string | null): string[] {
    const assignments = new Set<string>();
    if (workerId) {
      assignments.add(workerId);
    }
    for (const role of ['strategist', 'scout', 'analyst', 'guardian']) {
      const entry = roleTrace[role];
      if (entry && typeof entry === 'object') {
        const nestedWorkerId = (entry as Record<string, unknown>).workerId;
        if (typeof nestedWorkerId === 'string' && nestedWorkerId.trim()) {
          assignments.add(nestedWorkerId.trim());
        }
      }
    }
    return [...assignments];
  }

  private deriveGuardianOutcome(snapshot: RoleTraceSnapshot): GatewayGuardianOutcome | null {
    const guardian = (snapshot.roleTrace?.['guardian'] || null) as Record<string, unknown> | null;
    if (!guardian || typeof guardian !== 'object') {
      return null;
    }
    const failClosed = guardian.failClosed === true;
    const approved = guardian.approved === true;
    const finalMode = String(guardian.finalMode || '');
    const status: GatewayGuardianOutcome['status'] =
      failClosed
        ? 'fail_closed'
        : !approved && finalMode.includes('refused')
          ? 'refused'
          : finalMode.includes('limited')
            ? 'limited'
            : 'approved';
    return {
      status,
      reviewer: typeof guardian.reviewer === 'string' ? guardian.reviewer : null,
      reason: typeof guardian.reason === 'string' ? guardian.reason : null,
      failClosed,
      updatedAt: snapshot.updatedAt,
    };
  }

  async createRun(input: RunCreateInput): Promise<GatewayRunRecord> {
    const now = new Date().toISOString();
    const executionMode = input.executionMode || this.defaultExecutionMode(input.kind);
    const record: GatewayRunRecord = {
      id: input.id || randomUUID(),
      kind: input.kind,
      status: input.status,
      executionMode,
      sessionId: input.sessionId ?? null,
      bindingId: input.bindingId ?? null,
      agentId: input.agentId ?? null,
      parentSessionId: input.parentSessionId ?? null,
      parentRunId: input.parentRunId ?? null,
      role: input.role ?? null,
      workerId: input.workerId ?? null,
      queueType: input.queueType ?? null,
      jobId: input.jobId ?? null,
      summary: input.summary ?? null,
      error: input.error ?? null,
      guardianOutcome: input.guardianOutcome ?? null,
      queueMetadata: this.mergeQueueMetadata(undefined, input.queueMetadata, executionMode),
      terminalOutcome: input.terminalOutcome ?? null,
      metadata: input.metadata ?? null,
      createdAt: now,
      startedAt: input.status === 'running' ? now : null,
      heartbeatAt: input.status === 'running' ? now : null,
      finishedAt: ['completed', 'failed', 'cancelled'].includes(input.status) ? now : null,
    };
    await this.persistRun(record);
    return record;
  }

  async getRun(runId: string): Promise<GatewayRunRecord | null> {
    return this.redis.getJson<GatewayRunRecord>(this.runKey(runId));
  }

  async listRecentRuns(limit = 50): Promise<GatewayRunRecord[]> {
    const bounded = Math.max(1, Math.min(limit, MAX_RECENT_RUNS));
    return this.redis.getJsonList<GatewayRunRecord>(this.recentRunsKey(), 0, bounded - 1);
  }

  async updateRun(runId: string, updates: RunUpdateInput): Promise<GatewayRunRecord | null> {
    const existing = await this.getRun(runId);
    if (!existing) {
      return null;
    }
    const executionMode = updates.executionMode || existing.executionMode || this.defaultExecutionMode(existing.kind);
    const next: GatewayRunRecord = {
      ...existing,
      status: updates.status || existing.status,
      executionMode,
      workerId: updates.workerId === undefined ? existing.workerId : updates.workerId,
      queueType: updates.queueType === undefined ? existing.queueType : updates.queueType,
      jobId: updates.jobId === undefined ? existing.jobId : updates.jobId,
      summary: updates.summary === undefined ? existing.summary : updates.summary,
      error: updates.error === undefined ? existing.error : updates.error,
      guardianOutcome: updates.guardianOutcome === undefined ? existing.guardianOutcome : updates.guardianOutcome,
      queueMetadata: updates.queueMetadata === undefined
        ? existing.queueMetadata
        : this.mergeQueueMetadata(existing.queueMetadata, updates.queueMetadata, executionMode),
      terminalOutcome: updates.terminalOutcome === undefined ? existing.terminalOutcome : updates.terminalOutcome,
      startedAt: updates.startedAt === undefined ? existing.startedAt : updates.startedAt,
      heartbeatAt: updates.heartbeatAt === undefined ? existing.heartbeatAt : updates.heartbeatAt,
      finishedAt: updates.finishedAt === undefined ? existing.finishedAt : updates.finishedAt,
      metadata: updates.metadata === undefined
        ? existing.metadata
        : {
            ...(existing.metadata || {}),
            ...(updates.metadata || {}),
          },
    };
    if (next.workerId) {
      next.queueMetadata = this.mergeQueueMetadata(
        next.queueMetadata,
        {
          executionMode: next.executionMode || this.defaultExecutionMode(next.kind),
          queuedRoles: next.role ? [next.role] : [],
          workerAssignments: [next.workerId],
          queueFallbackUsed: Boolean(next.queueMetadata?.queueFallbackUsed),
        },
        next.executionMode || this.defaultExecutionMode(next.kind),
      );
    }
    await this.persistRun(next);
    return next;
  }

  async markRunQueued(record: Omit<RunCreateInput, 'status'>): Promise<GatewayRunRecord> {
    const run = await this.createRun({ ...record, status: 'queued' });
    await this.gatewayEvents.publish({
      type: 'run.queued',
      sessionId: run.sessionId,
      bindingId: run.bindingId,
      runId: run.id,
      agentId: run.agentId,
      parentSessionId: run.parentSessionId,
      parentRunId: run.parentRunId,
      summary: run.summary || `Run ${run.id} queued`,
      payload: {
        kind: run.kind,
        role: run.role,
        executionMode: run.executionMode,
        queueMetadata: run.queueMetadata,
        metadata: run.metadata,
      },
    });
    return run;
  }

  async markRunStarted(
    runId: string,
    summary?: string | null,
    workerId?: string | null,
  ): Promise<GatewayRunRecord | null> {
    const run = await this.updateRun(runId, {
      status: 'running',
      workerId: workerId ?? undefined,
      summary: summary ?? undefined,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });
    if (run) {
      await this.gatewayEvents.publish({
        type: 'run.started',
        sessionId: run.sessionId,
        bindingId: run.bindingId,
        runId: run.id,
        agentId: run.agentId,
        parentSessionId: run.parentSessionId,
        parentRunId: run.parentRunId,
        summary: run.summary || `Run ${run.id} started`,
        payload: {
          kind: run.kind,
          role: run.role,
          executionMode: run.executionMode,
          workerId: run.workerId ?? null,
          queueType: run.queueType ?? null,
          jobId: run.jobId ?? null,
          queueMetadata: run.queueMetadata ?? null,
        },
      });
    }
    return run;
  }

  async markRunHeartbeat(runId: string, workerId?: string | null): Promise<GatewayRunRecord | null> {
    const run = await this.updateRun(runId, {
      workerId: workerId ?? undefined,
      heartbeatAt: new Date().toISOString(),
    });
    if (run) {
      await this.gatewayEvents.publish({
        type: 'run.heartbeat',
        sessionId: run.sessionId,
        bindingId: run.bindingId,
        runId: run.id,
        agentId: run.agentId,
        parentSessionId: run.parentSessionId,
        parentRunId: run.parentRunId,
        summary: run.summary || `Run ${run.id} heartbeat`,
        payload: {
          workerId: run.workerId ?? null,
          queueType: run.queueType ?? null,
          jobId: run.jobId ?? null,
          queueMetadata: run.queueMetadata ?? null,
        },
      });
    }
    return run;
  }

  async markRunTerminal(
    runId: string,
    status: Extract<GatewayRunStatus, 'completed' | 'failed' | 'cancelled'>,
    summary?: string | null,
    error?: string | null,
    workerId?: string | null,
  ): Promise<GatewayRunRecord | null> {
    const run = await this.updateRun(runId, {
      status,
      summary: summary ?? undefined,
      error: error ?? undefined,
      workerId: workerId ?? undefined,
      terminalOutcome: {
        status,
        summary: summary ?? undefined,
        error: error ?? undefined,
        completedAt: new Date().toISOString(),
      },
      finishedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });
    if (run) {
      await this.gatewayEvents.publish({
        type: status === 'completed' ? 'run.completed' : status === 'cancelled' ? 'run.cancelled' : 'run.failed',
        sessionId: run.sessionId,
        bindingId: run.bindingId,
        runId: run.id,
        agentId: run.agentId,
        parentSessionId: run.parentSessionId,
        parentRunId: run.parentRunId,
        summary: run.summary || `Run ${run.id} ${status}`,
        payload: {
          kind: run.kind,
          role: run.role,
          workerId: run.workerId ?? null,
          queueType: run.queueType ?? null,
          jobId: run.jobId ?? null,
          guardianOutcome: run.guardianOutcome ?? null,
          queueMetadata: run.queueMetadata ?? null,
          error: run.error ?? null,
        },
      });
    }
    return run;
  }

  async registerWorker(registration: WorkerRegistration): Promise<WorkerStatusSnapshot> {
    const now = new Date().toISOString();
    const snapshot: WorkerStatusSnapshot = {
      workerId: registration.workerId,
      workerType: registration.workerType,
      status: 'online',
      hostname: registration.hostname,
      pid: registration.pid,
      roles: registration.roles,
      queues: registration.queues,
      capabilities: registration.capabilities,
      currentJobId: null,
      currentRunId: null,
      registeredAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: null,
      metadata: registration.metadata ?? null,
    };
    await this.redis.setJson(this.workerKey(snapshot.workerId), snapshot);
    await this.redis.pushJsonList(this.recentWorkersKey(), snapshot, MAX_RECENT_WORKERS);
    await this.gatewayEvents.publish({
      type: 'worker.registered',
      agentId: snapshot.workerId,
      summary: `Worker ${snapshot.workerId} registered`,
      payload: {
        workerType: snapshot.workerType,
        roles: snapshot.roles,
        queues: snapshot.queues,
        capabilities: snapshot.capabilities,
        hostname: snapshot.hostname,
        pid: snapshot.pid,
      },
    });
    return snapshot;
  }

  async getWorker(workerId: string): Promise<WorkerStatusSnapshot | null> {
    return this.redis.getJson<WorkerStatusSnapshot>(this.workerKey(workerId));
  }

  async listWorkers(limit = 50): Promise<WorkerStatusSnapshot[]> {
    const bounded = Math.max(1, Math.min(limit, MAX_RECENT_WORKERS));
    const snapshots = await this.redis.getJsonList<WorkerStatusSnapshot>(this.recentWorkersKey(), 0, bounded * 3);
    const deduped = new Map<string, WorkerStatusSnapshot>();
    for (const snapshot of snapshots) {
      if (!snapshot?.workerId || deduped.has(snapshot.workerId)) {
        continue;
      }
      deduped.set(snapshot.workerId, snapshot);
    }
    return [...deduped.values()].slice(0, bounded);
  }

  async heartbeatWorker(params: {
    workerId: string;
    currentJobId?: string | null;
    currentRunId?: string | null;
    leaseExpiresAt?: string | null;
    status?: WorkerStatusSnapshot['status'];
  }): Promise<WorkerStatusSnapshot | null> {
    const existing = await this.getWorker(params.workerId);
    if (!existing) {
      return null;
    }
    const next: WorkerStatusSnapshot = {
      ...existing,
      status: params.status || existing.status,
      currentJobId: params.currentJobId === undefined ? existing.currentJobId : params.currentJobId,
      currentRunId: params.currentRunId === undefined ? existing.currentRunId : params.currentRunId,
      leaseExpiresAt: params.leaseExpiresAt === undefined ? existing.leaseExpiresAt : params.leaseExpiresAt,
      lastHeartbeatAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.workerKey(next.workerId), next);
    await this.redis.pushJsonList(this.recentWorkersKey(), next, MAX_RECENT_WORKERS);
    await this.gatewayEvents.publish({
      type: 'worker.heartbeat',
      agentId: next.workerId,
      runId: next.currentRunId ?? null,
      summary: `Worker ${next.workerId} heartbeat`,
      payload: {
        status: next.status,
        currentJobId: next.currentJobId,
        currentRunId: next.currentRunId,
        leaseExpiresAt: next.leaseExpiresAt,
      },
    });
    return next;
  }

  async markWorkerOffline(workerId: string, reason?: string | null): Promise<WorkerStatusSnapshot | null> {
    const existing = await this.getWorker(workerId);
    if (!existing) {
      return null;
    }
    const next: WorkerStatusSnapshot = {
      ...existing,
      status: 'offline',
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.workerKey(workerId), next);
    await this.redis.pushJsonList(this.recentWorkersKey(), next, MAX_RECENT_WORKERS);
    await this.gatewayEvents.publish({
      type: 'worker.offline',
      agentId: workerId,
      summary: `Worker ${workerId} went offline`,
      payload: {
        reason: reason ?? null,
      },
    });
    return next;
  }

  async putWorkerLease(lease: WorkerLease): Promise<void> {
    await this.redis.setJson(this.workerLeaseKey(lease.jobId), lease);
  }

  async getWorkerLease(jobId: string): Promise<WorkerLease | null> {
    return this.redis.getJson<WorkerLease>(this.workerLeaseKey(jobId));
  }

  async clearWorkerLease(jobId: string): Promise<void> {
    await this.redis.delete(this.workerLeaseKey(jobId));
  }

  async storeRoleTrace(snapshot: RoleTraceSnapshot): Promise<void> {
    await this.redis.setJson(this.roleTraceRunKey(snapshot.runId), snapshot);
    await this.redis.setJson(this.roleTraceSessionKey(snapshot.sessionId), snapshot);
    await this.gatewayEvents.publish({
      type: 'role_trace.updated',
      sessionId: snapshot.sessionId,
      bindingId: snapshot.bindingId ?? null,
      runId: snapshot.runId,
      agentId: snapshot.agentId ?? null,
      parentSessionId: snapshot.parentSessionId ?? null,
      parentRunId: snapshot.parentRunId ?? null,
      summary: `Role trace updated for run ${snapshot.runId}`,
      payload: {
        strategist: snapshot.roleTrace?.['strategist'] ?? null,
        scout: snapshot.roleTrace?.['scout'] ?? null,
        analyst: snapshot.roleTrace?.['analyst'] ?? null,
        guardian: snapshot.roleTrace?.['guardian'] ?? null,
        workerAssignments: snapshot.workerAssignments || [],
        updatedAt: snapshot.updatedAt,
      },
    });

    const guardian = (snapshot.roleTrace?.['guardian'] || null) as Record<string, unknown> | null;
    if (guardian && (guardian.approved === false || guardian.failClosed === true)) {
      await this.gatewayEvents.publish({
        type: 'guardian.refused',
        sessionId: snapshot.sessionId,
        bindingId: snapshot.bindingId ?? null,
        runId: snapshot.runId,
        agentId: snapshot.agentId ?? null,
        parentSessionId: snapshot.parentSessionId ?? null,
        parentRunId: snapshot.parentRunId ?? null,
        summary: `Guardian refused run ${snapshot.runId}`,
        payload: {
          finalMode: guardian.finalMode ?? null,
          reason: guardian.reason ?? null,
          failClosed: guardian.failClosed ?? false,
          reviewer: guardian.reviewer ?? null,
        },
      });
    }
  }

  async getRoleTraceByRun(runId: string): Promise<RoleTraceSnapshot | null> {
    return this.redis.getJson<RoleTraceSnapshot>(this.roleTraceRunKey(runId));
  }

  async getLatestRoleTraceForSession(sessionId: string): Promise<RoleTraceSnapshot | null> {
    return this.redis.getJson<RoleTraceSnapshot>(this.roleTraceSessionKey(sessionId));
  }

  async appendShortTermMemory(entry: Omit<ShortTermMemoryEntry, 'key' | 'createdAt' | 'updatedAt'>): Promise<ShortTermMemoryEntry> {
    const now = new Date().toISOString();
    const normalized: ShortTermMemoryEntry = {
      key: randomUUID(),
      sessionId: entry.sessionId,
      runId: entry.runId,
      subagentId: entry.subagentId ?? null,
      kind: entry.kind,
      value: entry.value,
      graphNodeIds: entry.graphNodeIds || [],
      createdAt: now,
      updatedAt: now,
    };
    await this.redis.pushJsonList(this.shortTermMemoryKey(normalized.sessionId), normalized, MAX_RECENT_MEMORY);
    await this.redis.pushJsonList(this.shortTermMemoryRunKey(normalized.runId), normalized, MAX_RECENT_MEMORY);
    return normalized;
  }

  async listShortTermMemory(sessionId: string, runId?: string, limit = 50): Promise<ShortTermMemoryEntry[]> {
    const bounded = Math.max(1, Math.min(limit, MAX_RECENT_MEMORY));
    if (runId) {
      return this.redis.getJsonList<ShortTermMemoryEntry>(this.shortTermMemoryRunKey(runId), 0, bounded - 1);
    }
    return this.redis.getJsonList<ShortTermMemoryEntry>(this.shortTermMemoryKey(sessionId), 0, bounded - 1);
  }

  async captureRoleTraceFromProvenance(params: {
    sessionId: string;
    runId: string;
    provenanceTrace: Record<string, unknown> | null;
    bindingId?: string | null;
    agentId?: string | null;
    parentSessionId?: string | null;
    parentRunId?: string | null;
    workerId?: string | null;
    source?: GatewayRunKind | 'foreground';
  }): Promise<RoleTraceSnapshot | null> {
    const provenance = params.provenanceTrace || null;
    const metadata = provenance && typeof provenance === 'object'
      ? ((provenance as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
      : undefined;
    const roleTrace = (metadata?.roleTrace || (provenance as Record<string, unknown> | null)?.['roleTrace']) as Record<string, unknown> | undefined;
    if (!roleTrace || typeof roleTrace !== 'object') {
      return null;
    }

    const snapshot: RoleTraceSnapshot = {
      sessionId: params.sessionId,
      runId: params.runId,
      bindingId: params.bindingId ?? null,
      agentId: params.agentId ?? null,
      parentSessionId: params.parentSessionId ?? null,
      parentRunId: params.parentRunId ?? null,
      workerId: params.workerId ?? null,
      workerAssignments: this.collectWorkerAssignments(roleTrace, params.workerId),
      roleTrace,
      provenanceTrace: provenance,
      source: params.source || 'foreground',
      updatedAt: new Date().toISOString(),
    };
    await this.storeRoleTrace(snapshot);
    const guardianOutcome = this.deriveGuardianOutcome(snapshot);
    const existingRun = await this.getRun(params.runId);
    if (existingRun) {
      const executionMode: GatewayExecutionMode =
        (existingRun.executionMode === 'foreground' && snapshot.workerAssignments?.length)
          ? 'mixed'
          : (existingRun.executionMode || this.defaultExecutionMode(existingRun.kind));
      await this.updateRun(params.runId, {
        executionMode,
        workerId: params.workerId ?? existingRun.workerId ?? undefined,
        guardianOutcome,
        queueMetadata: {
          executionMode,
          queuedRoles: existingRun.role ? [existingRun.role] : [],
          workerAssignments: snapshot.workerAssignments || [],
          queueFallbackUsed: Boolean(existingRun.queueMetadata?.queueFallbackUsed),
        },
        metadata: {
          ...(existingRun.metadata || {}),
          roleTraceUpdatedAt: snapshot.updatedAt,
        },
      });
    }
    await this.captureRoleTraceMemory(snapshot);
    return snapshot;
  }

  async enqueueSubagentJob(job: Omit<SubagentJob, 'id' | 'status' | 'createdAt'>): Promise<SubagentJob> {
    const requestedTurnId = this.coerceTrustedTurnId(job.turn_id);
    const normalized: SubagentJob = {
      ...job,
      turn_id: requestedTurnId,
      id: randomUUID(),
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.subagentJobKey(normalized.id), normalized);
    await this.redis.xAdd(
      SUBAGENT_QUEUE_STREAM,
      {
        jobId: normalized.id,
        recordId: normalized.recordId,
        runId: normalized.runId,
        sessionId: normalized.sessionId,
        turnId: normalized.turn_id || '',
        prompt: normalized.prompt,
        role: normalized.role,
      },
      MAX_RECENT_QUEUE_JOBS,
    );
    await this.redis.pushJsonList(this.recentQueueJobsKey('subagent'), normalized, MAX_RECENT_QUEUE_JOBS);
    await this.gatewayEvents.publish({
      type: 'subagent.job.queued',
      sessionId: normalized.sessionId,
      bindingId: normalized.bindingId,
      runId: normalized.runId,
      agentId: normalized.agentId ?? null,
      parentSessionId: normalized.parentSessionId,
      parentRunId: normalized.parentRunId,
      summary: `Queued ${normalized.role} subagent job for run ${normalized.runId}`,
      payload: {
        jobId: normalized.id,
        role: normalized.role,
        mode: normalized.mode,
        turnId: normalized.turn_id,
      },
    });
    return normalized;
  }

  async claimSubagentJobs(
    consumer: string,
    count = 1,
    blockMs = 50,
  ): Promise<Array<SubagentJob & { streamId: string }>> {
    const streams = await this.redis.xReadGroup(SUBAGENT_QUEUE_GROUP, consumer, SUBAGENT_QUEUE_STREAM, count, blockMs);
    const jobs: Array<SubagentJob & { streamId: string }> = [];
    for (const stream of streams) {
      for (const entry of stream.entries) {
        const jobId = entry.values.jobId;
        if (!jobId) {
          this.logger.warn(`Subagent stream entry ${entry.id} missing jobId`);
          await this.redis.xAck(SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP, entry.id);
          continue;
        }
        const job = await this.redis.getJson<SubagentJob>(this.subagentJobKey(jobId));
        if (!job) {
          await this.redis.xAck(SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP, entry.id);
          continue;
        }
        jobs.push({ ...job, streamId: entry.id });
      }
    }
    return jobs;
  }

  async acknowledgeSubagentJob(streamId: string): Promise<void> {
    await this.redis.xAck(SUBAGENT_QUEUE_STREAM, SUBAGENT_QUEUE_GROUP, streamId);
  }

  async updateSubagentJob(jobId: string, updates: Partial<SubagentJob>): Promise<SubagentJob | null> {
    const existing = await this.redis.getJson<SubagentJob>(this.subagentJobKey(jobId));
    if (!existing) {
      return null;
    }
    const next: SubagentJob = {
      ...existing,
      ...updates,
    };
    await this.redis.setJson(this.subagentJobKey(jobId), next);
    await this.redis.pushJsonList(this.recentQueueJobsKey('subagent'), next, MAX_RECENT_QUEUE_JOBS);
    return next;
  }

  async getSubagentJob(jobId: string): Promise<SubagentJob | null> {
    return this.redis.getJson<SubagentJob>(this.subagentJobKey(jobId));
  }

  async enqueueAutomationJob(payload: Omit<AutomationQueueJob, 'status' | 'createdAt'>): Promise<void> {
    const requestedTurnId = this.coerceTrustedTurnId(payload.turn_id);
    const normalized: AutomationQueueJob = {
      ...payload,
      turn_id: requestedTurnId,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.automationJobKey(payload.runId), normalized);
    await this.redis.xAdd(
      AUTOMATION_QUEUE_STREAM,
      {
        runId: payload.runId,
        jobId: payload.jobId,
        bindingId: payload.bindingId,
        sessionId: payload.sessionId,
        turnId: normalized.turn_id || '',
      },
      MAX_RECENT_QUEUE_JOBS,
    );
    await this.redis.pushJsonList(this.recentQueueJobsKey('automation'), normalized, MAX_RECENT_QUEUE_JOBS);
    await this.gatewayEvents.publish({
      type: 'automation.job.queued',
      sessionId: payload.sessionId,
      bindingId: payload.bindingId,
      runId: payload.runId,
      agentId: payload.agentId ?? null,
      summary: `Automation job queued for run ${payload.runId}`,
      payload: {
        jobId: payload.jobId,
        turnId: normalized.turn_id,
      },
    });
  }

  async claimAutomationJobs(
    consumer: string,
    count = 1,
    blockMs = 50,
  ): Promise<Array<{ runId: string; jobId: string; bindingId: string; sessionId: string; streamId: string }>> {
    const streams = await this.redis.xReadGroup(AUTOMATION_QUEUE_GROUP, consumer, AUTOMATION_QUEUE_STREAM, count, blockMs);
    const jobs: Array<{ runId: string; jobId: string; bindingId: string; sessionId: string; streamId: string }> = [];
    for (const stream of streams) {
      for (const entry of stream.entries) {
        const runId = entry.values.runId;
        const jobId = entry.values.jobId;
        const bindingId = entry.values.bindingId;
        const sessionId = entry.values.sessionId;
        if (!runId || !jobId || !bindingId || !sessionId) {
          await this.redis.xAck(AUTOMATION_QUEUE_STREAM, AUTOMATION_QUEUE_GROUP, entry.id);
          continue;
        }
        jobs.push({ runId, jobId, bindingId, sessionId, streamId: entry.id });
      }
    }
    return jobs;
  }

  async acknowledgeAutomationJob(streamId: string): Promise<void> {
    await this.redis.xAck(AUTOMATION_QUEUE_STREAM, AUTOMATION_QUEUE_GROUP, streamId);
  }

  async getAutomationJob(runId: string): Promise<AutomationQueueJob | null> {
    return this.redis.getJson<AutomationQueueJob>(this.automationJobKey(runId));
  }

  async updateAutomationJob(runId: string, updates: Partial<AutomationQueueJob>): Promise<AutomationQueueJob | null> {
    const existing = await this.getAutomationJob(runId);
    if (!existing) {
      return null;
    }
    const next: AutomationQueueJob = {
      ...existing,
      ...updates,
    };
    await this.redis.setJson(this.automationJobKey(runId), next);
    await this.redis.pushJsonList(this.recentQueueJobsKey('automation'), next, MAX_RECENT_QUEUE_JOBS);
    return next;
  }

  async enqueueSandboxJob(job: Omit<SandboxJob, 'id' | 'status' | 'createdAt' | 'startedAt' | 'finishedAt'>): Promise<SandboxJob> {
    const requestedTurnId = this.coerceTrustedTurnId(job.turn_id);
    const normalized: SandboxJob = {
      ...job,
      turn_id: requestedTurnId,
      id: randomUUID(),
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    await this.redis.setJson(this.sandboxJobKey(normalized.id), normalized);
    await this.redis.xAdd(
      SANDBOX_QUEUE_STREAM,
      {
        jobId: normalized.id,
        toolName: normalized.toolName,
        mode: normalized.mode,
        runId: normalized.runId || '',
        sessionId: normalized.sessionId || '',
        turnId: normalized.turn_id || '',
      },
      MAX_RECENT_QUEUE_JOBS,
    );
    await this.redis.pushJsonList(this.recentQueueJobsKey('sandbox'), normalized, MAX_RECENT_QUEUE_JOBS);
    await this.gatewayEvents.publish({
      type: 'sandbox.job.queued',
      sessionId: normalized.sessionId ?? null,
      runId: normalized.runId ?? null,
      summary: `Sandbox job queued for ${normalized.toolName}`,
      payload: {
        jobId: normalized.id,
        mode: normalized.mode,
        turnId: normalized.turn_id,
      },
    });
    return normalized;
  }

  async enqueueBuilderJob(job: Omit<AppBuilderQueueJob, 'id' | 'status' | 'createdAt'> & { gatewayRunId?: string | null }): Promise<AppBuilderQueueJob> {
    const requestedTurnId = this.coerceTrustedTurnId(job.turn_id);
    const normalized: AppBuilderQueueJob = {
      ...job,
      turn_id: requestedTurnId,
      id: randomUUID(),
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.builderJobKey(normalized.id), normalized);
    await this.redis.xAdd(
      BUILDER_QUEUE_STREAM,
      {
        jobId: normalized.id,
        runId: normalized.runId,
        projectId: normalized.projectId,
        phase: normalized.phase,
        turnId: normalized.turn_id || '',
      },
      MAX_RECENT_QUEUE_JOBS,
    );
    await this.redis.pushJsonList(this.recentQueueJobsKey('builder'), normalized, MAX_RECENT_QUEUE_JOBS);
    await this.gatewayEvents.publish({
      type: 'builder.job.queued',
      runId: normalized.gatewayRunId ?? normalized.runId,
      summary: `Builder job queued for ${normalized.phase}`,
      payload: {
        jobId: normalized.id,
        projectId: normalized.projectId,
        phase: normalized.phase,
        turnId: normalized.turn_id,
      },
    });
    return normalized;
  }

  async getBuilderJob(jobId: string): Promise<AppBuilderQueueJob | null> {
    return this.redis.getJson<AppBuilderQueueJob>(this.builderJobKey(jobId));
  }

  async updateBuilderJob(jobId: string, updates: Partial<AppBuilderQueueJob>): Promise<AppBuilderQueueJob | null> {
    const existing = await this.getBuilderJob(jobId);
    if (!existing) {
      return null;
    }
    const next: AppBuilderQueueJob = {
      ...existing,
      ...updates,
    };
    await this.redis.setJson(this.builderJobKey(jobId), next);
    await this.redis.pushJsonList(this.recentQueueJobsKey('builder'), next, MAX_RECENT_QUEUE_JOBS);
    return next;
  }

  async getSandboxJob(jobId: string): Promise<SandboxJob | null> {
    return this.redis.getJson<SandboxJob>(this.sandboxJobKey(jobId));
  }

  async updateSandboxJob(jobId: string, updates: Partial<SandboxJob>): Promise<SandboxJob | null> {
    const existing = await this.getSandboxJob(jobId);
    if (!existing) {
      return null;
    }
    const next: SandboxJob = {
      ...existing,
      ...updates,
    };
    await this.redis.setJson(this.sandboxJobKey(jobId), next);
    await this.redis.pushJsonList(this.recentQueueJobsKey('sandbox'), next, MAX_RECENT_QUEUE_JOBS);
    return next;
  }

  async claimSandboxJobs(
    consumer: string,
    count = 1,
    blockMs = 50,
  ): Promise<Array<SandboxJob & { streamId: string }>> {
    const streams = await this.redis.xReadGroup(SANDBOX_QUEUE_GROUP, consumer, SANDBOX_QUEUE_STREAM, count, blockMs);
    const jobs: Array<SandboxJob & { streamId: string }> = [];
    for (const stream of streams) {
      for (const entry of stream.entries) {
        const jobId = entry.values.jobId;
        if (!jobId) {
          await this.redis.xAck(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP, entry.id);
          continue;
        }
        const job = await this.getSandboxJob(jobId);
        if (!job) {
          await this.redis.xAck(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP, entry.id);
          continue;
        }
        jobs.push({ ...job, streamId: entry.id });
      }
    }
    return jobs;
  }

  async acknowledgeSandboxJob(streamId: string): Promise<void> {
    await this.redis.xAck(SANDBOX_QUEUE_STREAM, SANDBOX_QUEUE_GROUP, streamId);
  }

  async markSandboxJobStarted(jobId: string, workerId: string): Promise<SandboxJob | null> {
    const startedAt = new Date().toISOString();
    const job = await this.updateSandboxJob(jobId, {
      status: 'running',
      workerId,
      startedAt,
    });
    if (job) {
      await this.putWorkerLease({
        workerId,
        jobId,
        queueType: 'sandbox',
        runId: job.runId ?? null,
        sessionId: job.sessionId ?? null,
        lastHeartbeatAt: startedAt,
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      await this.heartbeatWorker({
        workerId,
        currentJobId: jobId,
        currentRunId: job.runId ?? null,
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'busy',
      });
      await this.gatewayEvents.publish({
        type: 'sandbox.job.started',
        sessionId: job.sessionId ?? null,
        runId: job.runId ?? null,
        summary: `Sandbox job ${job.id} started on worker ${workerId}`,
        payload: {
          jobId: job.id,
          toolName: job.toolName,
          workerId,
          mode: job.mode,
        },
      });
    }
    return job;
  }

  async markSandboxJobHeartbeat(jobId: string, workerId: string): Promise<SandboxJob | null> {
    const job = await this.getSandboxJob(jobId);
    if (!job) {
      return null;
    }
    const leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
    await this.putWorkerLease({
      workerId,
      jobId,
      queueType: 'sandbox',
      runId: job.runId ?? null,
      sessionId: job.sessionId ?? null,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt,
    });
    await this.heartbeatWorker({
      workerId,
      currentJobId: jobId,
      currentRunId: job.runId ?? null,
      leaseExpiresAt,
      status: 'busy',
    });
    return this.updateSandboxJob(jobId, { workerId });
  }

  async markSandboxJobCompleted(
    jobId: string,
    workerId: string,
    result: SandboxJob['result'],
  ): Promise<SandboxJob | null> {
    const finishedAt = new Date().toISOString();
    const job = await this.updateSandboxJob(jobId, {
      status: 'completed',
      workerId,
      result: result ?? null,
      finishedAt,
    });
    await this.clearWorkerLease(jobId);
    await this.heartbeatWorker({
      workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    if (job) {
      await this.gatewayEvents.publish({
        type: 'sandbox.job.completed',
        sessionId: job.sessionId ?? null,
        runId: job.runId ?? null,
        summary: `Sandbox job ${job.id} completed`,
        payload: {
          jobId: job.id,
          workerId,
          toolName: job.toolName,
          mode: job.mode,
          result: job.result ?? null,
        },
      });
    }
    return job;
  }

  async markSandboxJobFailed(
    jobId: string,
    workerId: string,
    error: string,
    partialResult?: SandboxJob['result'],
  ): Promise<SandboxJob | null> {
    const finishedAt = new Date().toISOString();
    const job = await this.updateSandboxJob(jobId, {
      status: 'failed',
      workerId,
      result: {
        ...(partialResult || {}),
        error,
      },
      finishedAt,
    });
    await this.clearWorkerLease(jobId);
    await this.heartbeatWorker({
      workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    if (job) {
      await this.gatewayEvents.publish({
        type: 'sandbox.job.failed',
        sessionId: job.sessionId ?? null,
        runId: job.runId ?? null,
        summary: `Sandbox job ${job.id} failed`,
        payload: {
          jobId: job.id,
          workerId,
          toolName: job.toolName,
          mode: job.mode,
          error,
        },
      });
    }
    return job;
  }

  async markBuilderJobStarted(jobId: string, workerId: string): Promise<AppBuilderQueueJob | null> {
    const startedAt = new Date().toISOString();
    const job = await this.updateBuilderJob(jobId, {
      status: 'running',
      workerId,
    });
    if (job) {
      await this.putWorkerLease({
        workerId,
        jobId,
        queueType: 'builder',
        runId: job.gatewayRunId ?? job.runId,
        sessionId: null,
        lastHeartbeatAt: startedAt,
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      await this.heartbeatWorker({
        workerId,
        currentJobId: jobId,
        currentRunId: job.gatewayRunId ?? job.runId,
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        status: 'busy',
      });
      await this.gatewayEvents.publish({
        type: 'builder.job.started',
        runId: job.gatewayRunId ?? job.runId,
        summary: `Builder job ${job.id} started on worker ${workerId}`,
        payload: {
          jobId: job.id,
          projectId: job.projectId,
          phase: job.phase,
          workerId,
        },
      });
    }
    return job;
  }

  async markBuilderJobHeartbeat(jobId: string, workerId: string): Promise<AppBuilderQueueJob | null> {
    const job = await this.getBuilderJob(jobId);
    if (!job) {
      return null;
    }
    const leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
    await this.putWorkerLease({
      workerId,
      jobId,
      queueType: 'builder',
      runId: job.gatewayRunId ?? job.runId,
      sessionId: null,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt,
    });
    await this.heartbeatWorker({
      workerId,
      currentJobId: jobId,
      currentRunId: job.gatewayRunId ?? job.runId,
      leaseExpiresAt,
      status: 'busy',
    });
    return this.updateBuilderJob(jobId, { workerId });
  }

  async markBuilderJobCompleted(
    jobId: string,
    workerId: string,
    summary: string,
    output?: Record<string, unknown> | null,
  ): Promise<AppBuilderQueueJob | null> {
    const job = await this.updateBuilderJob(jobId, {
      status: 'completed',
      workerId,
      requestPayload: {
        ...(await this.getBuilderJob(jobId))?.requestPayload,
        result: output ?? null,
      },
    });
    await this.clearWorkerLease(jobId);
    await this.heartbeatWorker({
      workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    if (job) {
      await this.gatewayEvents.publish({
        type: 'builder.job.completed',
        runId: job.gatewayRunId ?? job.runId,
        summary,
        payload: {
          jobId: job.id,
          projectId: job.projectId,
          phase: job.phase,
          workerId,
          output: output ?? null,
        },
      });
    }
    return job;
  }

  async markBuilderJobFailed(
    jobId: string,
    workerId: string,
    error: string,
    output?: Record<string, unknown> | null,
  ): Promise<AppBuilderQueueJob | null> {
    const job = await this.updateBuilderJob(jobId, {
      status: 'failed',
      workerId,
      requestPayload: {
        ...(await this.getBuilderJob(jobId))?.requestPayload,
        error,
        output: output ?? null,
      },
    });
    await this.clearWorkerLease(jobId);
    await this.heartbeatWorker({
      workerId,
      currentJobId: null,
      currentRunId: null,
      leaseExpiresAt: null,
      status: 'online',
    });
    if (job) {
      await this.gatewayEvents.publish({
        type: 'builder.job.failed',
        runId: job.gatewayRunId ?? job.runId,
        summary: `Builder job ${job.id} failed`,
        payload: {
          jobId: job.id,
          projectId: job.projectId,
          phase: job.phase,
          workerId,
          error,
          output: output ?? null,
        },
      });
    }
    return job;
  }

  async listRecentQueueJobs(queueType: WorkerQueueType, limit = 50): Promise<QueueJobSummary[]> {
    const bounded = Math.max(1, Math.min(limit, MAX_RECENT_QUEUE_JOBS));
    const jobs = await this.redis.getJsonList<any>(this.recentQueueJobsKey(queueType), 0, bounded - 1);
    return jobs.map((job: Record<string, unknown>) => this.toQueueJobSummary(queueType, job));
  }

  private toQueueJobSummary(queueType: WorkerQueueType, job: Record<string, unknown>): QueueJobSummary {
    const runId = typeof job.runId === 'string' ? job.runId : null;
    const sessionId = typeof job.sessionId === 'string' ? job.sessionId : null;
    const workerId = typeof job.workerId === 'string' ? job.workerId : null;
    const status = typeof job.status === 'string' ? job.status : 'queued';
    const id = typeof job.id === 'string'
      ? job.id
      : typeof job.jobId === 'string'
        ? job.jobId
        : runId || `${queueType}-job`;
    const title = queueType === 'sandbox'
      ? String(job.toolName || 'Sandbox job')
      : queueType === 'builder'
        ? `Builder ${String(job.phase || 'phase')}`
      : queueType === 'automation'
        ? `Automation ${String(job.jobId || runId || 'job')}`
        : `Subagent ${String(job.role || 'generic')}`;
    return {
      id,
      queueType,
      status: ['queued', 'running', 'completed', 'failed', 'cancelled', 'stale', 'requeued'].includes(status) ? status as QueueJobSummary['status'] : 'queued',
      runId,
      sessionId,
      workerId,
      title,
      summary: typeof job.summary === 'string' ? job.summary : null,
      createdAt: typeof job.createdAt === 'string' ? job.createdAt : new Date().toISOString(),
      updatedAt: typeof job.finishedAt === 'string'
        ? job.finishedAt
        : typeof job.startedAt === 'string'
          ? job.startedAt
          : typeof job.createdAt === 'string'
            ? job.createdAt
            : null,
      raw: job,
    };
  }

  private async persistRun(record: GatewayRunRecord): Promise<void> {
    await this.redis.setJson(this.runKey(record.id), record);
    await this.redis.pushJsonList(this.recentRunsKey(), record, MAX_RECENT_RUNS);
    if (record.sessionId) {
      await this.redis.pushJsonList(this.sessionRunsKey(record.sessionId), record, MAX_RECENT_RUNS);
    }
  }

  private async captureRoleTraceMemory(snapshot: RoleTraceSnapshot): Promise<void> {
    const roleTrace = snapshot.roleTrace || {};
    const strategist = roleTrace['strategist'];
    const scout = roleTrace['scout'];
    const analyst = roleTrace['analyst'];
    const guardian = roleTrace['guardian'];

    const append = async (kind: ShortTermMemoryKind, value: Record<string, unknown>) => {
      await this.appendShortTermMemory({
        sessionId: snapshot.sessionId,
        runId: snapshot.runId,
        subagentId: snapshot.runId,
        kind,
        value,
      });
    };

    if (strategist && typeof strategist === 'object') {
      await append('strategist_brief', strategist as Record<string, unknown>);
    }
    if (scout && typeof scout === 'object') {
      const scoutPayload = scout as Record<string, unknown>;
      await append('scout_evidence', scoutPayload);
      if (Array.isArray(scoutPayload.searchQueries) && scoutPayload.searchQueries.length) {
        await append('search_terms', { searchQueries: scoutPayload.searchQueries });
      }
      if (Array.isArray(scoutPayload.selectedUrls) && scoutPayload.selectedUrls.length) {
        await append('selected_urls', { selectedUrls: scoutPayload.selectedUrls });
      }
    }
    if (analyst && typeof analyst === 'object') {
      await append('analyst_verdict', analyst as Record<string, unknown>);
    }
    if (guardian && typeof guardian === 'object') {
      await append('guardian_verdict', guardian as Record<string, unknown>);
    }
  }
}
