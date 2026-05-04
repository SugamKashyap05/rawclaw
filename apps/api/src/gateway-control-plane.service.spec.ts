import { GatewayControlPlaneService } from './gateway-control-plane.service';

class FakeRedisService {
  private readonly json = new Map<string, unknown>();
  private readonly lists = new Map<string, unknown[]>();
  private readonly streams = new Map<string, Array<{ id: string; values: Record<string, string> }>>();
  private readonly acked: Array<{ stream: string; group: string; id: string }> = [];
  private nextStreamId = 1;

  async setJson(key: string, value: unknown): Promise<void> {
    this.json.set(key, value);
  }

  async getJson<T>(key: string): Promise<T | null> {
    return (this.json.get(key) as T | undefined) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.json.delete(key);
  }

  async pushJsonList(key: string, value: unknown, maxLength?: number): Promise<void> {
    const existing = this.lists.get(key) || [];
    existing.unshift(value);
    if (maxLength && existing.length > maxLength) {
      existing.length = maxLength;
    }
    this.lists.set(key, existing);
  }

  async getJsonList<T>(key: string, start = 0, stop = -1): Promise<T[]> {
    const items = this.lists.get(key) || [];
    const normalizedStop = stop < 0 ? items.length : stop + 1;
    return items.slice(start, normalizedStop) as T[];
  }

  async xGroupCreate(): Promise<void> {
    return;
  }

  async xAdd(stream: string, values: Record<string, string>): Promise<string> {
    const id = `${this.nextStreamId++}-0`;
    const entries = this.streams.get(stream) || [];
    entries.push({ id, values });
    this.streams.set(stream, entries);
    return id;
  }

  async xReadGroup(_group: string, _consumer: string, stream: string): Promise<Array<{ stream: string; entries: Array<{ id: string; values: Record<string, string> }> }>> {
    const entries = this.streams.get(stream) || [];
    this.streams.set(stream, []);
    return entries.length ? [{ stream, entries }] : [];
  }

  async xAck(stream: string, group: string, ...ids: string[]): Promise<number> {
    ids.forEach((id) => this.acked.push({ stream, group, id }));
    return ids.length;
  }

  getAcked(): Array<{ stream: string; group: string; id: string }> {
    return [...this.acked];
  }
}

describe('GatewayControlPlaneService', () => {
  let redis: FakeRedisService;
  let gatewayEvents: { publish: jest.Mock };
  let service: GatewayControlPlaneService;

  beforeEach(() => {
    redis = new FakeRedisService();
    gatewayEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    service = new GatewayControlPlaneService(redis as any, gatewayEvents as any);
  });

  it('stores durable run records and keeps recent runs recoverable', async () => {
    await service.createRun({
      id: 'run-1',
      kind: 'foreground_chat',
      status: 'running',
      sessionId: 'session-1',
      bindingId: 'binding-1',
      agentId: 'main',
      summary: 'Foreground run started',
    });

    await service.markRunTerminal('run-1', 'completed', 'Foreground run completed', null);

    const run = await service.getRun('run-1');
    const recent = await service.listRecentRuns(5);

    expect(run).toEqual(
      expect.objectContaining({
        id: 'run-1',
        kind: 'foreground_chat',
        status: 'completed',
        sessionId: 'session-1',
        bindingId: 'binding-1',
        summary: 'Foreground run completed',
      }),
    );
    expect(recent[0]).toEqual(expect.objectContaining({ id: 'run-1', status: 'completed' }));
  });

  it('captures role traces from provenance, persists memory, and emits guardian refusal events', async () => {
    const provenanceTrace = {
      metadata: {
        roleTrace: {
          strategist: { lane: 'research', freshnessMatters: true },
          scout: { selectedUrls: ['https://www.iplt20.com/matches/points-table'], searchQueries: ['IPL 2026 CSK points table wins losses'] },
          analyst: { mode: 'limited_answer', summary: 'Partial evidence available' },
          guardian: { approved: false, finalMode: 'refused_answer', reason: 'weak evidence', failClosed: true, reviewer: 'local_guardian' },
        },
      },
    };

    const snapshot = await service.captureRoleTraceFromProvenance({
      sessionId: 'session-2',
      runId: 'run-2',
      provenanceTrace,
      bindingId: 'binding-2',
      agentId: 'main',
      source: 'foreground',
    });

    const roleTrace = await service.getRoleTraceByRun('run-2');
    const memory = await service.listShortTermMemory('session-2', 'run-2', 10);

    expect(snapshot).toEqual(expect.objectContaining({ runId: 'run-2', sessionId: 'session-2' }));
    expect(roleTrace?.roleTrace).toEqual((provenanceTrace.metadata as any).roleTrace);
    expect(memory.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['strategist_brief', 'scout_evidence', 'search_terms', 'selected_urls', 'analyst_verdict', 'guardian_verdict']),
    );
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'role_trace.updated', runId: 'run-2' }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'guardian.refused', runId: 'run-2' }));
  });

  it('queues subagent jobs through Redis streams and acknowledges them after processing', async () => {
    const queued = await service.enqueueSubagentJob({
      recordId: 'child-run-1',
      runId: 'child-run-1',
      sessionId: 'session-3',
      bindingId: 'binding-3',
      parentSessionId: 'parent-session',
      parentRunId: 'parent-run',
      prompt: 'Gather official IPL evidence',
      agentId: 'helper',
      role: 'scout',
      mode: 'background',
      contextForkMode: 'recent',
      announceBackMode: 'summary',
      allowedTools: ['web_extract'],
      timeoutSeconds: 180,
    });

    const claimed = await service.claimSubagentJobs('worker-1', 2, 0);
    await service.acknowledgeSubagentJob(claimed[0].streamId);

    expect(queued.role).toBe('scout');
    expect(claimed[0]).toEqual(expect.objectContaining({ id: queued.id, prompt: 'Gather official IPL evidence', streamId: expect.any(String) }));
    expect(redis.getAcked()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stream: 'gateway:queue:subagent', id: claimed[0].streamId }),
      ]),
    );
  });

  it('tracks worker registration and sandbox job lifecycle durably', async () => {
    const worker = await service.registerWorker({
      workerId: 'worker-1',
      workerType: 'python_swarm_worker',
      hostname: 'localhost',
      pid: 1234,
      roles: ['scout', 'analyst'],
      queues: ['sandbox'],
      capabilities: ['sandbox_pool'],
      metadata: { zone: 'local' },
    });

    const sandboxJob = await service.enqueueSandboxJob({
      sessionId: 'session-sandbox',
      runId: 'run-sandbox',
      toolName: 'shell_execute',
      mode: 'shell',
      payload: {
        command: 'echo hello',
        timeoutSeconds: 10,
        image: 'python:3.11-slim',
        memoryLimit: '256m',
        networkDisabled: true,
      },
    });

    await service.markSandboxJobStarted(sandboxJob.id, worker.workerId);
    await service.markSandboxJobCompleted(sandboxJob.id, worker.workerId, {
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      outputFiles: {},
      error: null,
      durationMs: 42,
    });

    const storedWorker = await service.getWorker(worker.workerId);
    const storedJob = await service.getSandboxJob(sandboxJob.id);

    expect(storedWorker).toEqual(expect.objectContaining({
      workerId: 'worker-1',
      status: 'online',
      currentJobId: null,
    }));
    expect(storedJob).toEqual(expect.objectContaining({
      id: sandboxJob.id,
      status: 'completed',
      workerId: 'worker-1',
      result: expect.objectContaining({ stdout: 'hello', exitCode: 0 }),
    }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'worker.registered' }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'sandbox.job.started' }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'sandbox.job.completed' }));
  });

  it('queues and completes builder jobs through the dedicated builder queue', async () => {
    const worker = await service.registerWorker({
      workerId: 'builder-worker-1',
      workerType: 'python_swarm_worker',
      hostname: 'localhost',
      pid: 5678,
      roles: ['scout'],
      queues: ['builder'],
      capabilities: ['app_builder_executor'],
      metadata: { zone: 'local' },
    });

    const job = await service.enqueueBuilderJob({
      runId: 'builder-run-1',
      gatewayRunId: 'gateway-run-builder-1',
      projectId: 'project-1',
      phase: 'generate',
      requestPayload: {
        templateId: 'web-dashboard',
      },
    });

    await service.markBuilderJobStarted(job.id, worker.workerId);
    await service.markBuilderJobCompleted(job.id, worker.workerId, 'Managed project generated.', {
      managedPath: 'data/app-builder/projects/project-1/current',
    });

    const storedJob = await service.getBuilderJob(job.id);
    const recent = await service.listRecentQueueJobs('builder', 5);

    expect(storedJob).toEqual(expect.objectContaining({
      id: job.id,
      status: 'completed',
      workerId: worker.workerId,
      phase: 'generate',
      requestPayload: expect.objectContaining({
        templateId: 'web-dashboard',
        result: expect.objectContaining({
          managedPath: 'data/app-builder/projects/project-1/current',
        }),
      }),
    }));
    expect(recent[0]).toEqual(expect.objectContaining({
      id: job.id,
      queueType: 'builder',
      title: 'Builder generate',
      status: 'completed',
      workerId: worker.workerId,
    }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'builder.job.queued' }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'builder.job.started' }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'builder.job.completed' }));
  });
});
