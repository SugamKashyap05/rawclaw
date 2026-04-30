import { ConflictException } from '@nestjs/common';
import { GatewayRoutingService } from './gateway-routing.service';

function makeBindingRule(overrides: Partial<any> = {}) {
  return {
    id: 'rule-default',
    name: 'Thread rule',
    active: true,
    priority: 100,
    workspaceId: 'default',
    surfaceType: 'chat',
    senderIdentifier: null,
    threadKey: 'thread-1',
    channelKey: null,
    targetAgentId: 'rule-agent',
    affinityMode: 'thread',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function makeBindingRow(overrides: Partial<any> = {}) {
  return {
    id: 'binding-1',
    routingKey: 'default::chat::main::0::session::session:session-1',
    sessionId: 'session-1',
    workspaceId: 'default',
    senderIdentifier: 'alice',
    surfaceType: 'chat',
    threadKey: null,
    channelKey: null,
    agentId: 'main',
    affinityMode: 'session',
    resolutionSource: 'global_default',
    matchedRuleId: null,
    matchedRuleName: null,
    requestedSessionId: 'session-1',
    resolvedSessionId: 'session-1',
    reused: false,
    status: 'idle',
    parentSessionId: null,
    parentRunId: null,
    delegationDepth: 0,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('GatewayRoutingService', () => {
  let prisma: any;
  let redis: any;
  let gatewayEvents: any;
  let agentsService: any;
  let service: GatewayRoutingService;

  beforeEach(() => {
    prisma = {
      bindingRule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sessionBinding: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      session: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      gatewayAutomationJob: {
        count: jest.fn().mockResolvedValue(0),
      },
      gatewayAutomationRun: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      childRun: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
    };

    gatewayEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    agentsService = {
      getOptional: jest.fn(async (id?: string | null) => {
        if (!id) return null;
        return {
          id,
          name: id,
        };
      }),
      getDefaultOptional: jest.fn().mockResolvedValue({
        id: 'main',
        name: 'Main',
      }),
    };

    service = new GatewayRoutingService(
      prisma,
      redis,
      gatewayEvents,
      agentsService,
    );
  });

  it('prefers an explicit agent over a matched binding rule', async () => {
    prisma.bindingRule.findMany.mockResolvedValue([
      makeBindingRule({
        id: 'rule-1',
        name: 'Route to rule-agent',
        targetAgentId: 'rule-agent',
        threadKey: null,
      }),
    ]);

    prisma.sessionBinding.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.sessionId) return null;
      if (where.routingKey) return null;
      return null;
    });

    const createdRow = makeBindingRow({
      id: 'binding-explicit',
      sessionId: 'session-explicit',
      routingKey: 'default::chat::explicit-agent::0::session::session:session-explicit',
      agentId: 'explicit-agent',
      requestedSessionId: 'session-explicit',
      resolvedSessionId: 'session-explicit',
      resolutionSource: 'explicit_agent',
      affinityMode: 'session',
    });
    prisma.sessionBinding.create.mockResolvedValue(createdRow);

    const result = await service.resolveBinding({
      sessionId: 'session-explicit',
      workspaceId: 'default',
      senderIdentifier: 'alice',
      surfaceType: 'chat',
      threadKey: 'thread-1',
      agentId: 'explicit-agent',
    });

    expect(result.binding.agentId).toBe('explicit-agent');
    expect(result.binding.resolutionSource).toBe('explicit_agent');
    expect(result.routing.agentId).toBe('explicit-agent');
    expect(prisma.bindingRule.findMany).not.toHaveBeenCalled();
  });

  it('reuses an existing binding by thread affinity and overrides the advisory session id', async () => {
    prisma.bindingRule.findMany.mockResolvedValue([
      makeBindingRule({
        id: 'rule-thread',
        name: 'Thread affinity',
        targetAgentId: 'rule-agent',
        affinityMode: 'thread',
      }),
    ]);

    const existingThreadBinding = makeBindingRow({
      id: 'binding-thread',
      sessionId: 'stable-thread-session',
      routingKey: 'default::chat::rule-agent::0::thread::thread:thread-1',
      agentId: 'rule-agent',
      affinityMode: 'thread',
      resolutionSource: 'binding_rule',
      matchedRuleId: 'rule-thread',
      matchedRuleName: 'Thread affinity',
      requestedSessionId: 'old-advisory',
      resolvedSessionId: 'stable-thread-session',
      reused: false,
      threadKey: 'thread-1',
      senderIdentifier: 'alice',
    });

    prisma.sessionBinding.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.sessionId === 'new-advisory-session') return null;
      if (where.routingKey === 'default::chat::rule-agent::0::thread::thread:thread-1') {
        return existingThreadBinding;
      }
      return null;
    });

    const updatedBinding = {
      ...existingThreadBinding,
      requestedSessionId: 'new-advisory-session',
      reused: true,
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    };
    prisma.sessionBinding.update.mockResolvedValue(updatedBinding);

    const result = await service.resolveBinding({
      sessionId: 'new-advisory-session',
      workspaceId: 'default',
      senderIdentifier: 'alice',
      surfaceType: 'chat',
      threadKey: 'thread-1',
    });

    expect(result.reused).toBe(true);
    expect(result.binding.sessionId).toBe('stable-thread-session');
    expect(result.binding.requestedSessionId).toBe('new-advisory-session');
    expect(result.binding.resolvedSessionId).toBe('stable-thread-session');
    expect(result.binding.affinityMode).toBe('thread');
    expect(result.binding.matchedRuleId).toBe('rule-thread');
    expect(result.routing.sessionId).toBe('stable-thread-session');
    expect(result.routing.requestedSessionId).toBe('new-advisory-session');
    expect(result.routing.resolvedSessionId).toBe('stable-thread-session');
  });

  it('rejects conflicting session ownership and emits routing.conflict', async () => {
    const existingSessionBinding = makeBindingRow({
      id: 'binding-conflict',
      sessionId: 'session-conflict',
      routingKey: 'default::chat::main::0::session::session:session-conflict',
      workspaceId: 'default',
      senderIdentifier: 'alice',
      surfaceType: 'chat',
      agentId: 'main',
      affinityMode: 'session',
    });

    prisma.bindingRule.findMany.mockResolvedValue([
      makeBindingRule({
        id: 'rule-channel',
        name: 'Channel affinity',
        targetAgentId: 'rule-agent',
        affinityMode: 'channel',
        channelKey: 'channel-1',
        threadKey: null,
      }),
    ]);

    prisma.sessionBinding.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.sessionId === 'session-conflict') return existingSessionBinding;
      if (where.routingKey) return null;
      return null;
    });

    await expect(
      service.resolveBinding({
        sessionId: 'session-conflict',
        workspaceId: 'default',
        senderIdentifier: 'alice',
        surfaceType: 'chat',
        channelKey: 'channel-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(gatewayEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'routing.conflict',
        sessionId: 'session-conflict',
        bindingId: 'binding-conflict',
        payload: expect.objectContaining({
          existingRoutingKey: existingSessionBinding.routingKey,
          requestedSessionId: 'session-conflict',
          affinityMode: 'channel',
          matchedRuleId: 'rule-channel',
        }),
      }),
    );
    expect(prisma.sessionBinding.create).not.toHaveBeenCalled();
  });
});
