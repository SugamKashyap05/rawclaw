import { OperatorService } from './operator.service';

function makeRoute(overrides: Partial<any> = {}) {
  return {
    id: 'binding-main',
    routingKey: 'default::chat::main::0::session::session:session-main',
    sessionId: 'session-main',
    workspaceId: 'default',
    senderIdentifier: 'web-user',
    surfaceType: 'chat',
    threadKey: null,
    channelKey: null,
    agentId: 'main',
    affinityMode: 'session',
    resolutionSource: 'global_default',
    matchedRuleId: null,
    matchedRuleName: null,
    requestedSessionId: 'session-main',
    resolvedSessionId: 'session-main',
    reused: false,
    status: 'running',
    parentSessionId: null,
    parentRunId: null,
    delegationDepth: 0,
    lastRunStartedAt: '2026-04-27T09:00:00.000Z',
    lastRunFinishedAt: null,
    lastHeartbeatAt: '2026-04-27T09:01:00.000Z',
    lastError: null,
    createdAt: '2026-04-27T08:55:00.000Z',
    updatedAt: '2026-04-27T09:01:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<any> = {}) {
  return {
    id: 'session-main',
    title: 'Main session',
    workspaceId: 'default',
    senderIdentifier: 'web-user',
    createdAt: new Date('2026-04-27T08:55:00.000Z'),
    updatedAt: new Date('2026-04-27T09:02:00.000Z'),
    messages: [],
    ...overrides,
  };
}

function makeAssistantMessage(overrides: Partial<any> = {}) {
  return {
    id: 'message-1',
    role: 'assistant',
    content: 'Grounded answer',
    tool_calls: [{ tool_name: 'web_extract', input: { url: 'https://example.com' } }],
    provenanceTrace: {
      metadata: {
        internalResearchStages: {
          'answerability-gate': {
            mode: 'partial',
          },
        },
      },
    },
    workflowState: {
      promptPackId: 'rawclaw-default',
      assistantLane: 'research',
      confidenceState: 'limited',
    },
    promptPackId: 'rawclaw-default',
    workflowPromptIds: ['jarvis-briefing'],
    reviewEvents: [{ approved: true, feedback: 'Looks good.' }],
    memoryEvents: [{ layer: 'session', action: 'captured', summary: 'Captured new runtime fact.' }],
    agentId: 'main',
    runIds: ['route-run-1'],
    createdAt: '2026-04-27T09:02:00.000Z',
    ...overrides,
  };
}

describe('OperatorService', () => {
  let agentsService: any;
  let chatService: any;
  let gatewayRoutingService: any;
  let gatewayControlPlaneService: any;
  let gatewayEventsService: any;
  let gatewayAutomationService: any;
  let gatewaySubagentService: any;
  let tasksService: any;
  let prisma: any;
  let appBuilderService: any;
  let service: OperatorService;

  beforeEach(() => {
    agentsService = {
      list: jest.fn().mockResolvedValue([
        {
          id: 'main',
          name: 'Main',
          status: 'running',
          isDefault: true,
        },
        {
          id: 'helper',
          name: 'Helper',
          status: 'paused',
          isDefault: false,
        },
      ]),
      get: jest.fn(async (id: string) => ({
        id,
        name: id === 'main' ? 'Main' : 'Helper',
        status: id === 'main' ? 'running' : 'paused',
        isDefault: id === 'main',
      })),
      update: jest.fn().mockResolvedValue(undefined),
    };

    chatService = {
      listSessions: jest.fn().mockResolvedValue([
        makeSession({
          messages: [
            makeAssistantMessage(),
          ],
        }),
        makeSession({
          id: 'session-child',
          title: 'Child session',
          updatedAt: new Date('2026-04-27T09:03:00.000Z'),
          messages: [
            makeAssistantMessage({
              id: 'message-child',
              content: 'Child answer',
              agentId: 'helper',
              tool_calls: [],
              promptPackId: 'subagent-pack',
              workflowState: {
                promptPackId: 'subagent-pack',
                assistantLane: 'tasking',
                confidenceState: 'grounded',
              },
              reviewEvents: [{ approved: false, feedback: 'Needs revision.' }],
              memoryEvents: [{ layer: 'operator', action: 'updated', summary: 'Operator memory updated.' }],
              createdAt: '2026-04-27T09:03:00.000Z',
            }),
          ],
        }),
      ]),
    };

    gatewayRoutingService = {
      listBindingsWithSummary: jest.fn().mockResolvedValue({
        routes: [
          makeRoute(),
          makeRoute({
            id: 'binding-child',
            routingKey: 'default::subagent::helper::1::session::session:session-child',
            sessionId: 'session-child',
            agentId: 'helper',
            surfaceType: 'subagent',
            status: 'idle',
            parentSessionId: 'session-main',
            parentRunId: 'route-run-1',
            delegationDepth: 1,
          }),
        ],
        summary: {
          activeSessions: 2,
          activeRoutes: 2,
          inflightRuns: 1,
          degradedRoutes: 0,
          activeSubagents: 1,
        },
      }),
    };

    gatewayControlPlaneService = {
      listRecentRuns: jest.fn().mockResolvedValue([
        {
          id: 'route-run-1',
          kind: 'foreground_chat',
          status: 'running',
          executionMode: 'foreground',
          workerId: 'worker-main',
          queueType: null,
          guardianOutcome: {
            status: 'approved',
            reviewer: 'guardian',
            reason: 'grounded answer',
          },
          queueMetadata: {
            executionMode: 'foreground',
            queuedRoles: [],
            workerAssignments: ['worker-main'],
            queueFallbackUsed: false,
          },
        },
      ]),
    };

    gatewayEventsService = {
      listRecent: jest.fn().mockResolvedValue([
        {
          id: 'event-tool',
          type: 'tool.activity',
          timestamp: '2026-04-27T09:04:00.000Z',
          sessionId: 'session-main',
          bindingId: 'binding-main',
          runId: 'route-run-1',
          agentId: 'main',
          summary: 'web_extract result',
          payload: { toolName: 'web_extract', phase: 'result' },
        },
        {
          id: 'event-run',
          type: 'run.started',
          timestamp: '2026-04-27T09:03:30.000Z',
          sessionId: 'session-main',
          bindingId: 'binding-main',
          runId: 'route-run-1',
          agentId: 'main',
          summary: 'Route run started',
          payload: { lane: 'research' },
        },
        {
          id: 'event-subagent',
          type: 'subagent.completed',
          timestamp: '2026-04-27T09:03:45.000Z',
          sessionId: 'session-child',
          bindingId: 'binding-child',
          runId: 'child-run-1',
          agentId: 'helper',
          parentSessionId: 'session-main',
          parentRunId: 'route-run-1',
          summary: 'Subagent completed',
          payload: { summary: 'Child run complete.' },
        },
      ]),
      publish: jest.fn().mockResolvedValue(undefined),
    };

    gatewayAutomationService = {
      cancelRun: jest.fn(),
      retryRun: jest.fn(),
    };

    gatewaySubagentService = {
      cancelRun: jest.fn(),
    };

    tasksService = {
      listRecentRuns: jest.fn().mockResolvedValue([
        {
          id: 'task-run-1',
          status: 'running',
          definition: { name: 'Operator follow-up', agentId: 'main' },
          selectedAgent: 'main',
          sessionId: 'session-main',
          startedAt: '2026-04-27T09:00:30.000Z',
          finishedAt: null,
          errorMessage: null,
        },
      ]),
      getRunDetail: jest.fn(),
      updateRun: jest.fn(),
      resumeRun: jest.fn(),
    };

    appBuilderService = {
      queueProjectPhase: jest.fn(),
    };

    prisma = {
      childRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'child-run-1',
            bindingId: 'binding-child',
            childSessionId: 'session-child',
            parentSessionId: 'session-main',
            parentRunId: 'route-run-1',
            agentId: 'helper',
            status: 'completed',
            summary: 'Child run complete.',
            errorMessage: null,
            startedAt: new Date('2026-04-27T09:01:00.000Z'),
            finishedAt: new Date('2026-04-27T09:02:00.000Z'),
            createdAt: new Date('2026-04-27T09:00:45.000Z'),
          },
          {
            id: 'child-run-2',
            bindingId: 'binding-grandchild',
            childSessionId: 'session-grandchild',
            parentSessionId: 'session-child',
            parentRunId: 'child-run-1',
            agentId: 'helper',
            status: 'queued',
            summary: 'Grandchild queued.',
            errorMessage: null,
            startedAt: null,
            finishedAt: null,
            createdAt: new Date('2026-04-27T09:02:30.000Z'),
          },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      gatewayAutomationRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'auto-run-1',
            jobId: 'job-1',
            job: { name: 'Recurring research' },
            bindingId: 'binding-main',
            sessionId: 'session-main',
            agentId: 'main',
            status: 'running',
            summary: 'Automation running.',
            errorMessage: null,
            startedAt: new Date('2026-04-27T09:01:30.000Z'),
            finishedAt: null,
            heartbeatAt: new Date('2026-04-27T09:04:10.000Z'),
          },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      appBuilderRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'builder-run-1',
            projectId: 'project-1',
            phase: 'generate',
            status: 'deployment_ready',
            title: 'Generate Support Dashboard',
            summary: 'Builder run generated managed files.',
            errorMessage: null,
            gatewayRunId: 'gateway-builder-run-1',
            workerId: 'builder-worker-1',
            createdAt: new Date('2026-04-27T09:02:45.000Z'),
            startedAt: new Date('2026-04-27T09:02:50.000Z'),
            finishedAt: new Date('2026-04-27T09:03:10.000Z'),
            updatedAt: new Date('2026-04-27T09:03:10.000Z'),
            project: {
              id: 'project-1',
              name: 'Support Dashboard',
              slug: 'support-dashboard',
            },
          },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    service = new OperatorService(
      agentsService,
      chatService,
      gatewayRoutingService,
      gatewayControlPlaneService,
      gatewayEventsService,
      gatewayAutomationService,
      gatewaySubagentService,
      tasksService,
      prisma,
      appBuilderService,
    );
  });

  it('builds an operator snapshot with aggregated runtime, provenance, tool activity, and subagent lineage', async () => {
    const snapshot = await service.getSnapshot(50);

    expect(snapshot.summary.activeAgents).toBe(2);
    expect(snapshot.summary.activeSessions).toBe(2);
    expect(snapshot.summary.activeRoutes).toBe(2);
    expect(snapshot.summary.currentRuns).toBeGreaterThanOrEqual(4);
    expect(snapshot.summary.toolEvents).toBeGreaterThanOrEqual(2);
    expect(snapshot.summary.memoryEvents).toBe(2);
    expect(snapshot.activeAgents.find((agent) => agent.agentId === 'main')).toEqual(
      expect.objectContaining({
        activeRouteCount: 1,
        currentRunCount: expect.any(Number),
        activeSessionCount: 1,
      }),
    );
    expect(snapshot.activeSessions.find((session) => session.sessionId === 'session-main')).toEqual(
      expect.objectContaining({
        bindingId: 'binding-main',
        currentRunIds: expect.arrayContaining(['route-run-1', 'task-run-1', 'auto-run-1']),
        childSessionIds: expect.arrayContaining(['session-child']),
      }),
    );
    expect(snapshot.toolActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'web_extract', source: 'gateway_event' }),
        expect.objectContaining({ toolName: 'web_extract', source: 'chat_message' }),
      ]),
    );
    expect(snapshot.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'session-main',
          promptPackId: 'rawclaw-default',
          reviewState: 'approved',
          answerabilityMode: 'partial',
        }),
      ]),
    );
    expect(snapshot.subagentTree).toHaveLength(1);
    expect(snapshot.subagentTree[0]).toEqual(
      expect.objectContaining({
        runId: 'child-run-1',
        children: [
          expect.objectContaining({
            runId: 'child-run-2',
          }),
        ],
      }),
    );
  });

  it('merges gateway, memory, provenance, review, and tool items into a descending filtered timeline', async () => {
    const timeline = await service.getTimeline({
      limit: 20,
      sessionId: 'session-main',
    });

    expect(timeline.items.length).toBeGreaterThan(0);
    expect(timeline.items.every((item) => item.sessionId === 'session-main')).toBe(true);
    expect(timeline.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'gateway_event', gatewayEventType: 'run.started' }),
        expect.objectContaining({ kind: 'tool_activity', summary: expect.stringContaining('web_extract') }),
        expect.objectContaining({ kind: 'memory_event', memoryLayer: 'session' }),
        expect.objectContaining({ kind: 'provenance', summary: expect.stringContaining('rawclaw-default') }),
        expect.objectContaining({ kind: 'review', summary: expect.stringContaining('approved') }),
      ]),
    );

    for (let index = 1; index < timeline.items.length; index += 1) {
      expect(Date.parse(timeline.items[index - 1].timestamp)).toBeGreaterThanOrEqual(
        Date.parse(timeline.items[index].timestamp),
      );
    }
  });

  it('pauses and resumes an agent while emitting operator-visible status events', async () => {
    const paused = await service.pauseAgent('main');
    const resumed = await service.resumeAgent('main');

    expect(agentsService.get).toHaveBeenNthCalledWith(1, 'main');
    expect(agentsService.update).toHaveBeenNthCalledWith(1, 'main', { status: 'paused' });
    expect(gatewayEventsService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'agent.status',
        agentId: 'main',
        summary: 'Agent Main paused by operator',
        payload: { status: 'paused' },
      }),
    );
    expect(paused).toEqual(
      expect.objectContaining({
        success: true,
        action: 'pause_agent',
        targetId: 'main',
      }),
    );

    expect(agentsService.get).toHaveBeenNthCalledWith(2, 'main');
    expect(agentsService.update).toHaveBeenNthCalledWith(2, 'main', { status: 'running' });
    expect(gatewayEventsService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'agent.status',
        agentId: 'main',
        summary: 'Agent Main resumed by operator',
        payload: { status: 'running' },
      }),
    );
    expect(resumed).toEqual(
      expect.objectContaining({
        success: true,
        action: 'resume_agent',
        targetId: 'main',
      }),
    );
  });
});
