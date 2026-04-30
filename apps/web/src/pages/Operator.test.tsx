import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Operator from './Operator';
import type { OperatorSnapshot } from '@rawclaw/shared';

const mockUseGatewayRuntime = vi.fn();
const mockFetchOperatorSnapshot = vi.fn();
const mockPauseOperatorAgent = vi.fn();
const mockResumeOperatorAgent = vi.fn();
const mockCancelOperatorRun = vi.fn();
const mockRetryOperatorRun = vi.fn();

vi.mock('../hooks/useGatewayRuntime', () => ({
  useGatewayRuntime: (...args: unknown[]) => mockUseGatewayRuntime(...args),
}));

vi.mock('../lib/operator', () => ({
  fetchOperatorSnapshot: (...args: unknown[]) => mockFetchOperatorSnapshot(...args),
  pauseOperatorAgent: (...args: unknown[]) => mockPauseOperatorAgent(...args),
  resumeOperatorAgent: (...args: unknown[]) => mockResumeOperatorAgent(...args),
  cancelOperatorRun: (...args: unknown[]) => mockCancelOperatorRun(...args),
  retryOperatorRun: (...args: unknown[]) => mockRetryOperatorRun(...args),
}));

function makeSnapshot(): OperatorSnapshot {
  return {
    summary: {
      activeAgents: 2,
      activeSessions: 2,
      activeRoutes: 2,
      currentRuns: 3,
      toolEvents: 2,
      memoryEvents: 2,
      degradedCount: 0,
      subagentCount: 1,
    },
    activeAgents: [
      {
        agentId: 'main',
        name: 'Main',
        status: 'running',
        isDefault: true,
        activeRouteCount: 1,
        currentRunCount: 2,
        activeSessionCount: 1,
        lastEventAt: '2026-04-27T10:05:00.000Z',
        lastError: null,
        workspaceIds: ['default'],
        routeIds: ['binding-main'],
      },
      {
        agentId: 'helper',
        name: 'Helper',
        status: 'paused',
        isDefault: false,
        activeRouteCount: 1,
        currentRunCount: 1,
        activeSessionCount: 1,
        lastEventAt: '2026-04-27T10:04:00.000Z',
        lastError: null,
        workspaceIds: ['default'],
        routeIds: ['binding-child'],
      },
    ],
    activeSessions: [
      {
        sessionId: 'session-main',
        bindingId: 'binding-main',
        title: 'Main session',
        workspaceId: 'default',
        senderIdentifier: 'web-user',
        surfaceType: 'chat',
        agentId: 'main',
        routeStatus: 'running',
        currentRunIds: ['route-run-1', 'task-run-1'],
        lastMessageAt: '2026-04-27T10:03:00.000Z',
        lastHeartbeatAt: '2026-04-27T10:04:00.000Z',
        latestError: null,
        parentSessionId: null,
        childSessionIds: ['session-child'],
      },
      {
        sessionId: 'session-child',
        bindingId: 'binding-child',
        title: 'Child session',
        workspaceId: 'default',
        senderIdentifier: 'gateway-subagent',
        surfaceType: 'subagent',
        agentId: 'helper',
        routeStatus: 'idle',
        currentRunIds: ['child-run-1'],
        lastMessageAt: '2026-04-27T10:02:00.000Z',
        lastHeartbeatAt: '2026-04-27T10:02:30.000Z',
        latestError: null,
        parentSessionId: 'session-main',
        childSessionIds: [],
      },
    ],
    currentRuns: [
      {
        id: 'route-run-1',
        kind: 'route',
        status: 'running',
        title: 'Main chat route',
        summary: 'Main route in progress.',
        sessionId: 'session-main',
        bindingId: 'binding-main',
        agentId: 'main',
        startedAt: '2026-04-27T10:00:00.000Z',
        finishedAt: null,
        heartbeatAt: '2026-04-27T10:04:00.000Z',
        parentRunId: null,
        parentSessionId: null,
        routeId: 'binding-main',
        latestError: null,
        provenance: {
          messageId: 'message-main',
          sessionId: 'session-main',
          promptPackId: 'rawclaw-default',
          workflowPromptIds: ['jarvis-briefing'],
          reviewState: 'approved',
          toolBacked: true,
          modelOnly: false,
          confidenceState: 'limited',
          assistantLane: 'research',
          answerabilityMode: 'partial',
          createdAt: '2026-04-27T10:03:00.000Z',
        },
      },
      {
        id: 'task-run-1',
        kind: 'task',
        status: 'queued',
        title: 'Operator follow-up',
        summary: 'Queued follow-up task.',
        sessionId: 'session-main',
        bindingId: null,
        agentId: 'main',
        startedAt: '2026-04-27T10:01:00.000Z',
        finishedAt: null,
        heartbeatAt: null,
        parentRunId: null,
        parentSessionId: null,
        routeId: null,
        latestError: null,
        provenance: null,
      },
      {
        id: 'child-run-1',
        kind: 'child',
        status: 'completed',
        title: 'Helper child run',
        summary: 'Child run completed.',
        sessionId: 'session-child',
        bindingId: 'binding-child',
        agentId: 'helper',
        startedAt: '2026-04-27T10:00:30.000Z',
        finishedAt: '2026-04-27T10:01:30.000Z',
        heartbeatAt: null,
        parentRunId: 'route-run-1',
        parentSessionId: 'session-main',
        routeId: 'binding-child',
        latestError: null,
        provenance: {
          messageId: 'message-child',
          sessionId: 'session-child',
          promptPackId: 'subagent-pack',
          workflowPromptIds: ['output-reviewer'],
          reviewState: 'rejected',
          toolBacked: false,
          modelOnly: true,
          confidenceState: 'grounded',
          assistantLane: 'tasking',
          answerabilityMode: null,
          createdAt: '2026-04-27T10:02:00.000Z',
        },
      },
    ],
    toolActivity: [
      {
        id: 'tool-main',
        timestamp: '2026-04-27T10:04:00.000Z',
        sessionId: 'session-main',
        bindingId: 'binding-main',
        runId: 'route-run-1',
        agentId: 'main',
        toolName: 'web_extract',
        phase: 'result',
        summary: 'web_extract used for main session',
        source: 'gateway_event',
      },
      {
        id: 'tool-child',
        timestamp: '2026-04-27T10:02:00.000Z',
        sessionId: 'session-child',
        bindingId: 'binding-child',
        runId: 'child-run-1',
        agentId: 'helper',
        toolName: 'opencli_extract',
        phase: 'result',
        summary: 'opencli_extract used for child session',
        source: 'gateway_event',
      },
    ],
    timeline: [
      {
        id: 'timeline-main',
        kind: 'gateway_event',
        timestamp: '2026-04-27T10:04:00.000Z',
        summary: 'Main route heartbeat',
        detail: 'main-detail',
        sessionId: 'session-main',
        bindingId: 'binding-main',
        runId: 'route-run-1',
        agentId: 'main',
        parentRunId: null,
        parentSessionId: null,
        memoryLayer: null,
        memoryAction: null,
        gatewayEventType: 'run.heartbeat',
        workflowState: null,
        routeId: 'binding-main',
      },
      {
        id: 'timeline-child',
        kind: 'memory_event',
        timestamp: '2026-04-27T10:02:00.000Z',
        summary: 'Child memory captured',
        detail: 'child-memory',
        sessionId: 'session-child',
        bindingId: 'binding-child',
        runId: 'child-run-1',
        agentId: 'helper',
        parentRunId: 'route-run-1',
        parentSessionId: 'session-main',
        memoryLayer: 'session',
        memoryAction: 'captured',
        gatewayEventType: null,
        workflowState: null,
        routeId: 'binding-child',
      },
    ],
    provenance: [
      {
        messageId: 'message-main',
        sessionId: 'session-main',
        promptPackId: 'rawclaw-default',
        workflowPromptIds: ['jarvis-briefing'],
        reviewState: 'approved',
        toolBacked: true,
        modelOnly: false,
        confidenceState: 'limited',
        assistantLane: 'research',
        answerabilityMode: 'partial',
        createdAt: '2026-04-27T10:03:00.000Z',
      },
      {
        messageId: 'message-child',
        sessionId: 'session-child',
        promptPackId: 'subagent-pack',
        workflowPromptIds: ['output-reviewer'],
        reviewState: 'rejected',
        toolBacked: false,
        modelOnly: true,
        confidenceState: 'grounded',
        assistantLane: 'tasking',
        answerabilityMode: null,
        createdAt: '2026-04-27T10:02:00.000Z',
      },
    ],
    subagentTree: [
      {
        id: 'child-run-1',
        runId: 'child-run-1',
        sessionId: 'session-child',
        bindingId: 'binding-child',
        agentId: 'helper',
        status: 'completed',
        summary: 'Child run completed.',
        parentRunId: 'route-run-1',
        parentSessionId: 'session-main',
        children: [],
      },
    ],
    routes: [
      {
        id: 'binding-main',
        routingKey: 'route-main',
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
        lastRunStartedAt: '2026-04-27T10:00:00.000Z',
        lastRunFinishedAt: null,
        lastHeartbeatAt: '2026-04-27T10:04:00.000Z',
        lastError: null,
        createdAt: '2026-04-27T09:59:00.000Z',
        updatedAt: '2026-04-27T10:04:00.000Z',
      },
      {
        id: 'binding-child',
        routingKey: 'route-child',
        sessionId: 'session-child',
        workspaceId: 'default',
        senderIdentifier: 'gateway-subagent',
        surfaceType: 'subagent',
        threadKey: null,
        channelKey: null,
        agentId: 'helper',
        affinityMode: 'session',
        resolutionSource: 'delegated_subagent',
        matchedRuleId: null,
        matchedRuleName: null,
        requestedSessionId: 'session-child',
        resolvedSessionId: 'session-child',
        reused: false,
        status: 'idle',
        parentSessionId: 'session-main',
        parentRunId: 'route-run-1',
        delegationDepth: 1,
        lastRunStartedAt: '2026-04-27T10:00:30.000Z',
        lastRunFinishedAt: '2026-04-27T10:01:30.000Z',
        lastHeartbeatAt: '2026-04-27T10:02:30.000Z',
        lastError: null,
        createdAt: '2026-04-27T10:00:00.000Z',
        updatedAt: '2026-04-27T10:02:30.000Z',
      },
    ],
  };
}

describe('Operator page', () => {
  beforeEach(() => {
    mockUseGatewayRuntime.mockReturnValue({
      routes: [],
      summary: {},
      recentEvents: [],
      selectedDetail: null,
      loading: false,
      detailLoading: false,
      error: null,
      streamError: null,
      isStreamLive: true,
      lastEventAt: null,
      refresh: vi.fn(),
    });
    mockPauseOperatorAgent.mockResolvedValue({
      success: true,
      action: 'pause_agent',
      targetId: 'main',
      message: 'Paused Main.',
    });
    mockResumeOperatorAgent.mockResolvedValue({
      success: true,
      action: 'resume_agent',
      targetId: 'helper',
      message: 'Resumed Helper.',
    });
    mockCancelOperatorRun.mockResolvedValue({
      success: true,
      action: 'cancel_run',
      targetId: 'route-run-1',
      runId: 'route-run-1',
      message: 'Cancellation requested.',
    });
    mockRetryOperatorRun.mockResolvedValue({
      success: true,
      action: 'retry_run',
      targetId: 'task-run-1',
      runId: 'task-run-1',
      replacementRunId: 'task-run-2',
      message: 'Queued retry.',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('pivots runs, timeline, provenance, tool activity, and subagent tree when a session is selected', async () => {
    mockFetchOperatorSnapshot.mockResolvedValue(makeSnapshot());

    render(
      <MemoryRouter>
        <Operator />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Unified Operator Surface')).toBeInTheDocument();
    await screen.findByText('web_extract');
    expect(screen.getByText('rawclaw-default')).toBeInTheDocument();
    expect(screen.getByText('Main route heartbeat')).toBeInTheDocument();
    expect(screen.getAllByText('Child run completed.').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: /Child session/i }));

    await waitFor(() => {
      expect(screen.getByText('opencli_extract')).toBeInTheDocument();
    });
    expect(screen.getByText('subagent-pack')).toBeInTheDocument();
    expect(screen.getByText('Child memory captured')).toBeInTheDocument();
    expect(screen.getByText('Child session')).toBeInTheDocument();
    expect(screen.queryByText('web_extract')).not.toBeInTheDocument();
    expect(screen.queryByText('rawclaw-default')).not.toBeInTheDocument();
    expect(screen.queryByText('Main route heartbeat')).not.toBeInTheDocument();
  });

  it('calls pause/resume, cancel, and retry controls and refreshes the operator snapshot afterward', async () => {
    const firstSnapshot = makeSnapshot();
    const pausedSnapshot: OperatorSnapshot = {
      ...firstSnapshot,
      activeAgents: firstSnapshot.activeAgents.map((agent) =>
        agent.agentId === 'main'
          ? { ...agent, status: 'paused' }
          : agent,
      ),
    };
    const resumedSnapshot: OperatorSnapshot = {
      ...firstSnapshot,
    };
    const cancelledSnapshot: OperatorSnapshot = {
      ...firstSnapshot,
      currentRuns: firstSnapshot.currentRuns.map((run) =>
        run.id === 'route-run-1'
          ? { ...run, status: 'cancelled', summary: 'Cancelled.' }
          : run,
      ),
    };
    const retriedSnapshot: OperatorSnapshot = {
      ...firstSnapshot,
      currentRuns: firstSnapshot.currentRuns.map((run) =>
        run.id === 'task-run-1'
          ? { ...run, status: 'queued', id: 'task-run-2', summary: 'Retry queued.' }
          : run,
      ),
    };

    mockFetchOperatorSnapshot
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(pausedSnapshot)
      .mockResolvedValueOnce(resumedSnapshot)
      .mockResolvedValueOnce(cancelledSnapshot)
      .mockResolvedValueOnce(retriedSnapshot);

    render(
      <MemoryRouter>
        <Operator />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Unified Operator Surface')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Pause$/i }));
    expect(mockPauseOperatorAgent).toHaveBeenCalledWith('main');

    await userEvent.click(screen.getAllByRole('button', { name: /^Resume$/i })[0]);
    expect(mockResumeOperatorAgent).toHaveBeenCalledWith('main');

    await userEvent.click(screen.getByRole('button', { name: /Cancel Run/i }));
    expect(mockCancelOperatorRun).toHaveBeenCalledWith('route-run-1');

    await userEvent.click(screen.getByRole('button', { name: /task-run-1/i }));
    await userEvent.click(screen.getByRole('button', { name: /Retry Run/i }));
    expect(mockRetryOperatorRun).toHaveBeenCalledWith('task-run-1');

    await waitFor(() => {
      expect(mockFetchOperatorSnapshot).toHaveBeenCalledTimes(5);
    });
  });

  it('keeps timeline and provenance aligned when switching between child and main session views', async () => {
    mockFetchOperatorSnapshot.mockResolvedValue(makeSnapshot());

    render(
      <MemoryRouter>
        <Operator />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Unified Operator Surface')).toBeInTheDocument();
    expect(screen.getByText('Main route heartbeat')).toBeInTheDocument();
    expect(screen.getByText('rawclaw-default')).toBeInTheDocument();
    expect(screen.getByText('Child memory captured')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Child session/i }));

    await waitFor(() => {
      expect(screen.getByText('subagent-pack')).toBeInTheDocument();
    });
    expect(screen.getByText('Child memory captured')).toBeInTheDocument();
    expect(screen.queryByText('Main route heartbeat')).not.toBeInTheDocument();
    expect(screen.queryByText('rawclaw-default')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Main session/i }));

    await waitFor(() => {
      expect(screen.getByText('Main route heartbeat')).toBeInTheDocument();
    });
    expect(screen.getByText('rawclaw-default')).toBeInTheDocument();
    expect(screen.getByText('Child memory captured')).toBeInTheDocument();
    expect(screen.queryByText('subagent-pack')).not.toBeInTheDocument();
  });

  it('updates run detail controls and route reveal links as different runs are selected', async () => {
    mockFetchOperatorSnapshot.mockResolvedValue(makeSnapshot());

    render(
      <MemoryRouter>
        <Operator />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Unified Operator Surface')).toBeInTheDocument();

    expect(screen.getAllByText('Main route in progress.').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Reveal Route/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel Run/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry Run/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /task-run-1/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Queued follow-up task.').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: /Cancel Run/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry Run/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Reveal Route/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /child-run-1/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Child run completed.').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: /Cancel Run/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry Run/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reveal Route/i })).toBeInTheDocument();
  });

  it('refreshes from stream activity without losing the selected session and run', async () => {
    const runtimeState = {
      routes: [],
      summary: {},
      recentEvents: [],
      selectedDetail: null,
      loading: false,
      detailLoading: false,
      error: null,
      streamError: null,
      isStreamLive: true,
      lastEventAt: null as string | null,
      refresh: vi.fn(),
    };

    mockUseGatewayRuntime.mockImplementation(() => runtimeState);

    const firstSnapshot = makeSnapshot();
    const refreshedSnapshot: OperatorSnapshot = {
      ...firstSnapshot,
      activeSessions: firstSnapshot.activeSessions.map((session) =>
        session.sessionId === 'session-child'
          ? { ...session, lastHeartbeatAt: '2026-04-27T10:05:30.000Z' }
          : session,
      ),
      currentRuns: firstSnapshot.currentRuns.map((run) =>
        run.id === 'child-run-1'
          ? { ...run, summary: 'Child run completed after stream refresh.' }
          : run,
      ),
    };

    mockFetchOperatorSnapshot
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(refreshedSnapshot);

    const { rerender } = render(
      <MemoryRouter>
        <Operator />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Unified Operator Surface')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Child session/i }));
    await userEvent.click(screen.getByRole('button', { name: /child-run-1/i }));

    await waitFor(() => {
      expect(screen.getByText('subagent-pack')).toBeInTheDocument();
    });

    runtimeState.lastEventAt = '2026-04-27T10:06:00.000Z';

    rerender(
      <MemoryRouter>
        <Operator />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockFetchOperatorSnapshot).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText('Child run completed after stream refresh.').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Child session')).toBeInTheDocument();
    expect(screen.getByText('subagent-pack')).toBeInTheDocument();
    expect(screen.queryByText('Main route heartbeat')).not.toBeInTheDocument();
  });
});
