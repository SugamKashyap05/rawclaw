import { GatewayAutomationService } from './gateway-automation.service';

describe('GatewayAutomationService', () => {
  let prisma: any;
  let routingService: any;
  let gatewayEvents: any;
  let gatewayExecutionService: any;
  let agentsService: any;
  let chatService: any;
  let redis: any;
  let service: GatewayAutomationService;

  beforeEach(() => {
    prisma = {
      gatewayAutomationRun: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      gatewayAutomationJob: {
        update: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn().mockResolvedValue([]),
      },
      sessionBinding: {
        findUnique: jest.fn(),
      },
    };

    routingService = {
      markRunStarted: jest.fn().mockResolvedValue(undefined),
      markRunFinished: jest.fn().mockResolvedValue(undefined),
      heartbeat: jest.fn().mockResolvedValue(undefined),
      resolveBinding: jest.fn(),
      toRoutingContext: jest.fn(),
    };

    gatewayEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    gatewayExecutionService = {
      fetchToolSchemas: jest.fn().mockResolvedValue([]),
      executeChatRun: jest.fn(),
    };

    agentsService = {
      getOptional: jest.fn().mockResolvedValue({ id: 'main', name: 'Main', modelId: null }),
    };

    chatService = {
      getMessages: jest.fn().mockResolvedValue([]),
      createMessage: jest.fn().mockResolvedValue(undefined),
    };

    redis = {
      setJsonIfAbsent: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    service = new GatewayAutomationService(
      prisma,
      routingService,
      gatewayEvents,
      gatewayExecutionService,
      agentsService,
      chatService,
      redis,
    );
  });

  it('cancels a running automation run and emits automation.run.cancelled', async () => {
    prisma.gatewayAutomationRun.findUnique.mockResolvedValue({
      id: 'auto-run-1',
      jobId: 'job-1',
      bindingId: 'binding-1',
      sessionId: 'session-1',
      agentId: 'main',
      status: 'running',
      job: { kind: 'recurring_research', name: 'Recurring research' },
    });

    const result = await service.cancelRun('auto-run-1');

    expect(prisma.gatewayAutomationRun.update).toHaveBeenCalledWith({
      where: { id: 'auto-run-1' },
      data: expect.objectContaining({
        status: 'cancelled',
        summary: 'Automation run cancelled by operator.',
        errorMessage: 'Cancelled by operator',
        finishedAt: expect.any(Date),
        heartbeatAt: expect.any(Date),
      }),
    });
    expect(gatewayEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'automation.run.cancelled',
        sessionId: 'session-1',
        bindingId: 'binding-1',
        runId: 'auto-run-1',
        agentId: 'main',
        summary: 'Automation run auto-run-1 cancelled by operator',
        payload: {
          jobId: 'job-1',
          kind: 'recurring_research',
          cancelled: true,
        },
      }),
    );
    expect(result).toEqual({
      success: true,
      message: 'Cancellation requested for automation run auto-run-1.',
    });
  });

  it('treats cancelled execution as a terminal state and does not schedule a retry', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    prisma.gatewayAutomationRun.findUnique.mockResolvedValue({
      id: 'auto-run-2',
      jobId: 'job-2',
      bindingId: 'binding-2',
      sessionId: 'session-2',
      agentId: 'main',
      status: 'queued',
      attempt: 1,
      job: {
        id: 'job-2',
        name: 'Heartbeat',
        kind: 'heartbeat',
        workspaceId: 'default',
        agentId: 'main',
        sessionId: 'session-2',
        bindingId: 'binding-2',
        senderIdentifier: 'gateway-automation',
        surfaceType: 'automation',
        threadKey: null,
        channelKey: null,
        toolIds: null,
        model: null,
        prompt: 'Keep heartbeat alive',
        contextForkMode: 'recent',
        timeoutSeconds: 120,
        maxRetries: 3,
        status: 'active',
        schedule: '0 * * * *',
      },
    });

    prisma.sessionBinding.findUnique.mockResolvedValue({
      id: 'binding-2',
      sessionId: 'session-2',
      workspaceId: 'default',
      senderIdentifier: 'gateway-automation',
      surfaceType: 'automation',
      threadKey: null,
      channelKey: null,
      agentId: 'main',
    });

    gatewayExecutionService.executeChatRun.mockRejectedValue(new Error('Cancelled by operator'));

    await (service as any).executeRun(
      {
        id: 'job-2',
        name: 'Heartbeat',
        kind: 'heartbeat',
        workspaceId: 'default',
        agentId: 'main',
        sessionId: 'session-2',
        senderIdentifier: 'gateway-automation',
        surfaceType: 'automation',
        threadKey: null,
        channelKey: null,
        toolIds: null,
        model: null,
        prompt: 'Keep heartbeat alive',
        contextForkMode: 'recent',
        timeoutSeconds: 120,
        maxRetries: 3,
        status: 'active',
        schedule: '0 * * * *',
      },
      'auto-run-2',
      'binding-2',
    );

    expect(prisma.gatewayAutomationRun.update).toHaveBeenCalledWith({
      where: { id: 'auto-run-2' },
      data: expect.objectContaining({
        status: 'cancelled',
        summary: 'Automation run cancelled by operator.',
        errorMessage: 'Cancelled by operator',
      }),
    });
    expect(gatewayEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'automation.run.cancelled',
        runId: 'auto-run-2',
        payload: expect.objectContaining({
          cancelled: true,
          error: 'Cancelled by operator',
        }),
      }),
    );
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 0);
    setTimeoutSpy.mockRestore();
  });
});
