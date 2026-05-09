import { of } from 'rxjs';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  const createPrismaMock = () => ({
    taskDefinition: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    taskRun: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    runStep: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  });

  it('persists the final agent result and derived provenance steps for background task execution', async () => {
    const prisma = createPrismaMock();
    const httpService = {
      post: jest.fn().mockReturnValue(
        of({
          data: {
            run_id: 'run-1',
            status: 'done',
            provenance: {
              steps: [
                {
                  stepIndex: 0,
                  stepType: 'plan',
                  inputSummary: 'Starting task execution',
                  durationMs: 0,
                  sandboxed: false,
                  timestamp: '2026-05-08T00:00:00.000Z',
                },
              ],
            },
          },
        }),
      ),
    };
    const configService = { get: jest.fn().mockReturnValue('http://agent') };
    const service = new TasksService(prisma as any, httpService as any, configService as any);

    prisma.taskRun.findUnique
      .mockResolvedValueOnce({ id: 'run-1', status: 'queued', startedAt: null, finishedAt: null })
      .mockResolvedValueOnce({ id: 'run-1', status: 'running', startedAt: new Date('2026-05-08T00:00:00.000Z'), finishedAt: null });

    prisma.taskRun.update.mockImplementation(async ({ data }: any) => ({
      id: 'run-1',
      definitionId: 'task-1',
      status: data.status,
      startedAt: data.startedAt ?? new Date('2026-05-08T00:00:00.000Z'),
      finishedAt: data.finishedAt ?? null,
      lastActivityAt: data.lastActivityAt ?? new Date('2026-05-08T00:00:00.000Z'),
      selectedAgent: null,
      outputPath: data.outputPath ?? null,
      provenance: data.provenance ?? null,
      errorMessage: data.errorMessage ?? null,
      sessionId: null,
      resumedFromRunId: null,
      triggeredBy: 'api',
      createdAt: new Date('2026-05-08T00:00:00.000Z'),
      definition: null,
      steps: [],
    }));

    await (service as any).executeRunInBackground('run-1', {
      id: 'task-1',
      name: 'Nightly summary',
      description: 'Summarize the latest updates',
      toolIds: ['web_search'],
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'http://agent/execute/task',
      expect.objectContaining({
        run_id: 'run-1',
        definition: expect.objectContaining({ toolIds: ['web_search'] }),
      }),
    );
    expect(prisma.taskRun.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ status: 'running' }),
      }),
    );
    expect(prisma.taskRun.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ status: 'done' }),
      }),
    );
    expect(prisma.runStep.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            runId: 'run-1',
            stepType: 'plan',
            inputSummary: 'Starting task execution',
          }),
        ],
      }),
    );
  });

  it('persists cancelling before requesting agent-side cancellation', async () => {
    const prisma = createPrismaMock();
    const httpService = {
      post: jest.fn().mockReturnValue(of({ data: { accepted: true, run_id: 'run-2' } })),
    };
    const configService = { get: jest.fn().mockReturnValue('http://agent') };
    const service = new TasksService(prisma as any, httpService as any, configService as any);

    prisma.taskRun.findUnique
      .mockResolvedValueOnce({ id: 'run-2', status: 'running' })
      .mockResolvedValueOnce({ id: 'run-2', status: 'running', startedAt: null, finishedAt: null });
    prisma.taskRun.update.mockImplementation(async ({ data }: any) => ({
      id: 'run-2',
      definitionId: 'task-1',
      status: data.status,
      lastActivityAt: data.lastActivityAt ?? new Date(),
      startedAt: data.startedAt ?? null,
      finishedAt: data.finishedAt ?? null,
      triggeredBy: 'manual',
      createdAt: new Date('2026-05-08T00:00:00.000Z'),
      definition: null,
      steps: [],
    }));

    const result = await service.cancelRun('run-2');

    expect(prisma.taskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-2' },
        data: expect.objectContaining({ status: 'cancelling' }),
      }),
    );
    expect(httpService.post).toHaveBeenCalledWith('http://agent/execute/task/run-2/cancel', {});
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'cancelling',
        message: 'Cancellation requested for task run run-2.',
      }),
    );
  });

  it('stores run provenance fields when enqueueing and resuming runs', async () => {
    const prisma = createPrismaMock();
    const httpService = { post: jest.fn().mockReturnValue(of({ data: { accepted: true } })) };
    const configService = { get: jest.fn().mockReturnValue('http://agent') };
    const service = new TasksService(prisma as any, httpService as any, configService as any);
    (service as any).executeRunInBackground = jest.fn().mockResolvedValue(undefined);

    prisma.taskDefinition.findUnique.mockResolvedValue({
      id: 'task-1',
      name: 'Example task',
      description: 'desc',
      toolIds: '["web_search"]',
      agentId: 'research_agent',
    });
    prisma.taskRun.create
      .mockResolvedValueOnce({
        id: 'run-enqueue',
        definitionId: 'task-1',
        status: 'queued',
        triggeredBy: 'chat',
        lastActivityAt: new Date('2026-05-08T00:00:00.000Z'),
        createdAt: new Date('2026-05-08T00:00:00.000Z'),
        selectedAgent: 'research_agent',
        sessionId: 'session-1',
        resumedFromRunId: null,
        definition: {
          id: 'task-1',
          name: 'Example task',
          description: 'desc',
          toolIds: '["web_search"]',
          enabled: true,
          createdAt: new Date('2026-05-08T00:00:00.000Z'),
          updatedAt: new Date('2026-05-08T00:00:00.000Z'),
        },
      })
      .mockResolvedValueOnce({
        id: 'run-resume',
        definitionId: 'task-1',
        status: 'queued',
        triggeredBy: 'manual',
        lastActivityAt: new Date('2026-05-08T00:01:00.000Z'),
        createdAt: new Date('2026-05-08T00:01:00.000Z'),
        selectedAgent: 'research_agent',
        sessionId: 'session-2',
        resumedFromRunId: 'run-enqueue',
        definition: {
          id: 'task-1',
          name: 'Example task',
          description: 'desc',
          toolIds: '["web_search"]',
          enabled: true,
          createdAt: new Date('2026-05-08T00:00:00.000Z'),
          updatedAt: new Date('2026-05-08T00:00:00.000Z'),
        },
      });
    prisma.taskRun.findUnique.mockResolvedValue({
      id: 'run-enqueue',
      definitionId: 'task-1',
      selectedAgent: 'research_agent',
      definition: {
        id: 'task-1',
        name: 'Example task',
        description: 'desc',
        toolIds: '["web_search"]',
        agentId: 'research_agent',
      },
    });

    const enqueueResult = await service.enqueueRun('task-1', {
      triggeredBy: 'chat',
      sessionId: 'session-1',
    });
    const resumeResult = await service.resumeRun('run-enqueue', 'session-2', 'manual');

    expect(prisma.taskRun.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredBy: 'chat',
          sessionId: 'session-1',
        }),
      }),
    );
    expect(prisma.taskRun.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredBy: 'manual',
          resumedFromRunId: 'run-enqueue',
          sessionId: 'session-2',
        }),
      }),
    );
    expect(enqueueResult.triggeredBy).toBe('chat');
    expect(resumeResult.triggeredBy).toBe('manual');
  });

  it('records heartbeats for active runs', async () => {
    const prisma = createPrismaMock();
    const httpService = { post: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue('http://agent') };
    const service = new TasksService(prisma as any, httpService as any, configService as any);

    prisma.taskRun.findUnique.mockResolvedValue({ id: 'run-3', status: 'running' });
    prisma.taskRun.update.mockResolvedValue({ id: 'run-3' });

    const result = await service.heartbeatRun('run-3');

    expect(prisma.taskRun.update).toHaveBeenCalledWith({
      where: { id: 'run-3' },
      data: { lastActivityAt: expect.any(Date) },
    });
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'running',
      }),
    );
  });

  it('reaps only truly stale active runs', async () => {
    const prisma = createPrismaMock();
    const httpService = { post: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue('http://agent') };
    const service = new TasksService(prisma as any, httpService as any, configService as any);
    const now = new Date('2026-05-08T12:31:00.000Z');

    prisma.taskRun.findMany.mockResolvedValue([
      {
        id: 'run-stale',
        status: 'running',
        finishedAt: null,
        errorMessage: null,
        lastActivityAt: new Date('2026-05-08T11:50:00.000Z'),
      },
    ]);
    prisma.taskRun.update.mockResolvedValue({ id: 'run-stale' });

    const result = await service.reapStaleRuns({ now });

    expect(prisma.taskRun.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['queued', 'running', 'cancelling'] },
        lastActivityAt: { lt: new Date('2026-05-08T12:01:00.000Z') },
      },
    });
    expect(prisma.taskRun.update).toHaveBeenCalledWith({
      where: { id: 'run-stale' },
      data: expect.objectContaining({
        status: 'failed',
        lastActivityAt: now,
      }),
    });
    expect(result).toEqual({
      reaped: 1,
      runIds: ['run-stale'],
      cutoff: '2026-05-08T12:01:00.000Z',
    });
  });

  it('skips pre-startup runs during the first-cycle reaper grace window', async () => {
    const prisma = createPrismaMock();
    const httpService = { post: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue('http://agent') };
    const service = new TasksService(prisma as any, httpService as any, configService as any);
    const now = new Date('2026-05-08T12:31:00.000Z');
    const startupSkipBefore = new Date('2026-05-08T12:25:00.000Z');

    prisma.taskRun.findMany.mockResolvedValue([]);

    const result = await service.reapStaleRuns({ now, startupSkipBefore });

    expect(prisma.taskRun.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['queued', 'running', 'cancelling'] },
        lastActivityAt: { lt: new Date('2026-05-08T12:01:00.000Z') },
        AND: [{ lastActivityAt: { gte: startupSkipBefore } }],
      },
    });
    expect(result).toEqual({
      reaped: 0,
      runIds: [],
      cutoff: '2026-05-08T12:01:00.000Z',
    });
  });

  it('counts active runs from raw task-run statuses instead of paginated list results', async () => {
    const prisma = createPrismaMock();
    const httpService = { post: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue('http://agent') };
    const service = new TasksService(prisma as any, httpService as any, configService as any);

    prisma.taskRun.count.mockResolvedValue(7);

    const result = await service.countActiveRuns();

    expect(prisma.taskRun.count).toHaveBeenCalledWith({
      where: {
        status: { in: ['queued', 'running', 'pending', 'cancelling'] },
      },
    });
    expect(result).toBe(7);
  });
});
