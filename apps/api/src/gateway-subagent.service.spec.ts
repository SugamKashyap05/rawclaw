import { GatewaySubagentService } from './gateway-subagent.service';

describe('GatewaySubagentService', () => {
  let agentsService: any;
  let routingService: any;
  let gatewayEvents: any;
  let gatewayExecutionService: any;
  let chatService: any;
  let prisma: any;
  let service: GatewaySubagentService;

  beforeEach(() => {
    agentsService = {
      getOptional: jest.fn().mockResolvedValue({ id: 'helper', name: 'Helper', modelId: null }),
    };

    routingService = {
      markRunStarted: jest.fn().mockResolvedValue(undefined),
      markRunFinished: jest.fn().mockResolvedValue(undefined),
      heartbeat: jest.fn().mockResolvedValue(undefined),
      resolveBinding: jest.fn(),
    };

    gatewayEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    gatewayExecutionService = {
      fetchToolSchemas: jest.fn().mockResolvedValue([]),
      executeChatRun: jest.fn(),
    };

    chatService = {
      getMessages: jest.fn().mockResolvedValue([]),
      createMessage: jest.fn().mockResolvedValue(undefined),
    };

    prisma = {
      childRun: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        create: jest.fn(),
      },
      sessionBinding: {
        findUnique: jest.fn(),
      },
    };

    service = new GatewaySubagentService(
      agentsService,
      routingService,
      gatewayEvents,
      gatewayExecutionService,
      chatService,
      prisma,
    );
  });

  it('cancels a running child run and preserves parent linkage in the emitted event', async () => {
    prisma.childRun.findUnique.mockResolvedValue({
      id: 'child-run-1',
      bindingId: 'binding-child',
      childSessionId: 'session-child',
      parentSessionId: 'session-parent',
      parentRunId: 'parent-run-1',
      agentId: 'helper',
      status: 'running',
    });

    const result = await service.cancelRun('child-run-1');

    expect(prisma.childRun.update).toHaveBeenCalledWith({
      where: { id: 'child-run-1' },
      data: expect.objectContaining({
        status: 'cancelled',
        summary: 'Subagent cancelled by operator.',
        errorMessage: 'Cancelled by operator',
        finishedAt: expect.any(Date),
      }),
    });
    expect(gatewayEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subagent.cancelled',
        sessionId: 'session-child',
        bindingId: 'binding-child',
        runId: 'child-run-1',
        agentId: 'helper',
        parentSessionId: 'session-parent',
        parentRunId: 'parent-run-1',
        summary: 'Subagent child-run-1 cancelled by operator',
        payload: { cancelled: true },
      }),
    );
    expect(result).toEqual({
      success: true,
      message: 'Cancellation requested for child run child-run-1.',
    });
  });

  it('returns a stable success message when the child run is already terminal', async () => {
    prisma.childRun.findUnique.mockResolvedValue({
      id: 'child-run-2',
      status: 'completed',
    });

    const result = await service.cancelRun('child-run-2');

    expect(prisma.childRun.update).not.toHaveBeenCalled();
    expect(gatewayEvents.publish).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Child run child-run-2 is already completed.',
    });
  });
});
