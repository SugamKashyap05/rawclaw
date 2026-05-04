import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ActiveAgentRuntimeState,
  ActiveSessionRuntimeState,
  AgentRuntimeListResponse,
  GatewayEvent,
  GatewayRunRecord,
  MemoryEvent,
  OperatorProvenanceSummary,
  OperatorRunSummary,
  OperatorSnapshot,
  OperatorSubagentNode,
  OperatorTimelineItem,
  OperatorTimelineResponse,
  RunActionResult,
  SessionBinding,
  ToolActivityItem,
} from '@rawclaw/shared';
import { AgentsService } from './agents.service';
import { ChatService, SessionWithMessages } from './chat.service';
import { GatewayAutomationService } from './gateway-automation.service';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewayEventsService } from './gateway-events.service';
import { GatewayRoutingService } from './gateway-routing.service';
import { GatewaySubagentService } from './gateway-subagent.service';
import { PrismaService } from './prisma.service';
import { TasksService } from './tasks/tasks.service';
import { AppBuilderService } from './app-builder/app-builder.service';

type TimelineFilters = {
  limit?: number;
  sessionId?: string;
  agentId?: string;
  memoryLayer?: string;
  eventType?: string;
};

@Injectable()
export class OperatorService {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly chatService: ChatService,
    private readonly gatewayRoutingService: GatewayRoutingService,
    private readonly gatewayControlPlaneService: GatewayControlPlaneService,
    private readonly gatewayEventsService: GatewayEventsService,
    private readonly gatewayAutomationService: GatewayAutomationService,
    private readonly gatewaySubagentService: GatewaySubagentService,
    private readonly tasksService: TasksService,
    private readonly prisma: PrismaService,
    private readonly appBuilderService: AppBuilderService,
  ) {}

  private normalizeLimit(limit?: number): number {
    return Math.max(10, Math.min(limit || 60, 200));
  }

  private inferReviewState(message: any): OperatorProvenanceSummary['reviewState'] {
    const events = Array.isArray(message.reviewEvents) ? message.reviewEvents : [];
    if (!events.length) return 'unknown';
    const last = events[events.length - 1];
    if (last?.approved === true) return 'approved';
    if (last?.approved === false) return 'rejected';
    return 'pending';
  }

  private extractAnswerabilityMode(message: any): string | null {
    const trace = message.provenanceTrace as any;
    const internalStages =
      trace?.metadata?.internalResearchStages
      || trace?.internalResearchStages
      || trace?.metadata?.stagedResearch;
    if (internalStages && typeof internalStages === 'object') {
      const gate = internalStages['answerability-gate'] || internalStages.answerabilityGate;
      if (gate && typeof gate === 'object' && typeof gate.mode === 'string') {
        return gate.mode;
      }
    }
    return null;
  }

  private collectProvenanceSummaries(sessions: SessionWithMessages[]): OperatorProvenanceSummary[] {
    const summaries: OperatorProvenanceSummary[] = [];
    for (const session of sessions) {
      for (const message of session.messages) {
        if (message.role !== 'assistant') continue;
        const hasTrace = !!message.provenanceTrace;
        const hasWorkflow = !!message.workflowState || !!message.promptPackId;
        if (!hasTrace && !hasWorkflow) continue;

        summaries.push({
          messageId: message.id || `${session.id}-${message.createdAt || 'unknown'}`,
          sessionId: session.id,
          promptPackId: message.promptPackId || message.workflowState?.promptPackId || null,
          workflowPromptIds: message.workflowPromptIds || message.workflowState?.workflowPromptIds || [],
          reviewState: this.inferReviewState(message),
          toolBacked: Array.isArray(message.tool_calls) && message.tool_calls.length > 0,
          modelOnly: !message.tool_calls?.length,
          confidenceState: message.workflowState?.confidenceState || null,
          assistantLane: message.workflowState?.assistantLane || null,
          answerabilityMode: this.extractAnswerabilityMode(message),
          createdAt: new Date(message.createdAt || session.updatedAt).toISOString(),
        });
      }
    }

    return summaries
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 40);
  }

  private collectMemoryTimelineItems(sessions: SessionWithMessages[]): OperatorTimelineItem[] {
    const items: OperatorTimelineItem[] = [];
    for (const session of sessions) {
      for (const message of session.messages) {
        const memoryEvents = Array.isArray(message.memoryEvents) ? message.memoryEvents : [];
        for (const event of memoryEvents) {
          items.push({
            id: `memory-${message.id || session.id}-${event.layer}-${event.action}-${event.summary}`,
            kind: 'memory_event',
            timestamp: new Date(message.createdAt || session.updatedAt).toISOString(),
            summary: event.summary,
            detail: `${event.layer} memory ${event.action}`,
            sessionId: session.id,
            agentId: message.agentId || null,
            memoryLayer: event.layer,
            memoryAction: event.action,
          });
        }
      }
    }
    return items;
  }

  private collectReviewTimelineItems(sessions: SessionWithMessages[]): OperatorTimelineItem[] {
    const items: OperatorTimelineItem[] = [];
    for (const session of sessions) {
      for (const message of session.messages) {
        const reviewEvents = Array.isArray(message.reviewEvents) ? message.reviewEvents : [];
        for (const event of reviewEvents) {
          items.push({
            id: `review-${message.id || session.id}-${String(event.approved)}-${event.feedback || ''}`,
            kind: 'review',
            timestamp: new Date(message.createdAt || session.updatedAt).toISOString(),
            summary: event.approved === true ? 'Output reviewer approved the draft.' : event.approved === false ? 'Output reviewer rejected the draft.' : 'Output reviewer recorded feedback.',
            detail: event.feedback || null,
            sessionId: session.id,
            agentId: message.agentId || null,
          });
        }
      }
    }
    return items;
  }

  private collectToolActivity(gatewayEvents: GatewayEvent[], sessions: SessionWithMessages[]): ToolActivityItem[] {
    const items: ToolActivityItem[] = gatewayEvents
      .filter((event) => event.type === 'tool.activity')
      .map((event) => {
        const payload = event.payload || {};
        const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'unknown-tool';
        const phase = payload.phase === 'start' || payload.phase === 'result' ? payload.phase : 'unknown';
        return {
          id: event.id,
          timestamp: event.timestamp,
          sessionId: event.sessionId || null,
          bindingId: event.bindingId || null,
          runId: event.runId || null,
          agentId: event.agentId || null,
          toolName,
          phase,
          summary: event.summary || `${toolName} ${phase}`,
          source: 'gateway_event',
        };
      });

    for (const session of sessions) {
      for (const message of session.messages) {
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        for (const toolCall of toolCalls.slice(0, 5)) {
          const toolName = toolCall?.tool_name || 'unknown-tool';
          items.push({
            id: `tool-${message.id || session.id}-${toolName}`,
            timestamp: new Date(message.createdAt || session.updatedAt).toISOString(),
            sessionId: session.id,
            bindingId: null,
            runId: Array.isArray(message.runIds) ? message.runIds[0] : null,
            agentId: message.agentId || null,
            toolName,
            phase: 'result',
            summary: `${toolName} used in chat turn`,
            source: 'chat_message',
          });
        }
      }
    }

    return items
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 40);
  }

  private toGatewayTimelineItems(events: GatewayEvent[]): OperatorTimelineItem[] {
    return events.map((event) => ({
      id: event.id,
      kind: event.type === 'tool.activity' ? 'tool_activity' : event.type.startsWith('subagent.') ? 'subagent' : 'gateway_event',
      timestamp: event.timestamp,
      summary: event.summary || event.type,
      detail: event.payload ? JSON.stringify(event.payload) : null,
      sessionId: event.sessionId || null,
      bindingId: event.bindingId || null,
      runId: event.runId || null,
      agentId: event.agentId || null,
      parentRunId: event.parentRunId || null,
      parentSessionId: event.parentSessionId || null,
      gatewayEventType: event.type,
      routeId: event.bindingId || null,
    }));
  }

  private toProvenanceTimelineItems(summaries: OperatorProvenanceSummary[]): OperatorTimelineItem[] {
    return summaries.map((summary) => ({
      id: `provenance-${summary.messageId}`,
      kind: 'provenance',
      timestamp: summary.createdAt,
      summary: summary.promptPackId ? `Provenance captured under ${summary.promptPackId}` : 'Provenance captured for assistant turn',
      detail: [
        summary.reviewState ? `review=${summary.reviewState}` : null,
        summary.assistantLane ? `lane=${summary.assistantLane}` : null,
        summary.answerabilityMode ? `answerability=${summary.answerabilityMode}` : null,
      ].filter(Boolean).join(' | ') || null,
      sessionId: summary.sessionId,
      routeId: null,
    }));
  }

  private mergeTimeline(
    gatewayEvents: GatewayEvent[],
    memoryItems: OperatorTimelineItem[],
    provenanceItems: OperatorTimelineItem[],
    reviewItems: OperatorTimelineItem[],
    toolItems: ToolActivityItem[],
  ): OperatorTimelineItem[] {
    const gatewayItems = this.toGatewayTimelineItems(gatewayEvents);
    const toolTimelineItems: OperatorTimelineItem[] = toolItems.map((item) => ({
      id: `tool-timeline-${item.id}`,
      kind: 'tool_activity',
      timestamp: item.timestamp,
      summary: item.summary,
      detail: `${item.toolName} (${item.phase || 'unknown'})`,
      sessionId: item.sessionId || null,
      bindingId: item.bindingId || null,
      runId: item.runId || null,
      agentId: item.agentId || null,
      routeId: item.bindingId || null,
    }));

    return [...gatewayItems, ...memoryItems, ...provenanceItems, ...reviewItems, ...toolTimelineItems]
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 120);
  }

  private buildActiveSessions(routes: SessionBinding[], sessions: SessionWithMessages[], currentRuns: OperatorRunSummary[]): ActiveSessionRuntimeState[] {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    const childMap = new Map<string, string[]>();

    for (const route of routes) {
      if (route.parentSessionId) {
        childMap.set(route.parentSessionId, [...(childMap.get(route.parentSessionId) || []), route.sessionId]);
      }
    }

    return routes.map((route) => {
      const session = sessionMap.get(route.sessionId);
      const currentRunIds = currentRuns
        .filter((run) => run.sessionId === route.sessionId || run.bindingId === route.id)
        .map((run) => run.id);

      const lastMessage = session?.messages.length ? session.messages[session.messages.length - 1] : null;
      return {
        sessionId: route.sessionId,
        bindingId: route.id,
        title: session?.title || null,
        workspaceId: route.workspaceId,
        senderIdentifier: route.senderIdentifier,
        surfaceType: route.surfaceType,
        agentId: route.agentId || null,
        routeStatus: route.status,
        currentRunIds,
        lastMessageAt: lastMessage?.createdAt ? new Date(lastMessage.createdAt as any).toISOString() : session?.updatedAt?.toISOString() || null,
        lastHeartbeatAt: route.lastHeartbeatAt || null,
        latestError: route.lastError || null,
        parentSessionId: route.parentSessionId || null,
        childSessionIds: childMap.get(route.sessionId) || [],
      };
    });
  }

  private buildActiveAgents(
    agents: any[],
    routes: SessionBinding[],
    currentRuns: OperatorRunSummary[],
    gatewayEvents: GatewayEvent[],
  ): ActiveAgentRuntimeState[] {
    return agents
      .map((agent) => {
        const ownedRoutes = routes.filter((route) => (route.agentId || 'main') === agent.id);
        const agentRuns = currentRuns.filter((run) => (run.agentId || 'main') === agent.id);
        const lastAgentEvent = gatewayEvents.find((event) => (event.agentId || 'main') === agent.id);
        const workspaceIds = Array.from(new Set(ownedRoutes.map((route) => route.workspaceId)));
        const activeSessionCount = new Set(ownedRoutes.map((route) => route.sessionId)).size;

        return {
          agentId: agent.id,
          name: agent.name,
          status: agent.status,
          isDefault: agent.isDefault,
          activeRouteCount: ownedRoutes.length,
          currentRunCount: agentRuns.length,
          activeSessionCount,
          lastEventAt: lastAgentEvent?.timestamp || null,
          lastError: ownedRoutes.find((route) => !!route.lastError)?.lastError || null,
          workspaceIds,
          routeIds: ownedRoutes.map((route) => route.id),
        } satisfies ActiveAgentRuntimeState;
      })
      .filter((agent) => agent.activeRouteCount > 0 || agent.currentRunCount > 0 || agent.status !== 'idle');
  }

  private buildSubagentTree(childRuns: any[]): OperatorSubagentNode[] {
    const nodes = new Map<string, OperatorSubagentNode>();
    for (const record of childRuns) {
      nodes.set(record.id, {
        id: record.id,
        runId: record.id,
        sessionId: record.childSessionId,
        bindingId: record.bindingId,
        agentId: record.agentId || null,
        status: record.status,
        summary: record.summary || null,
        parentRunId: record.parentRunId,
        parentSessionId: record.parentSessionId,
        children: [],
      });
    }

    const roots: OperatorSubagentNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentRunId ? nodes.get(node.parentRunId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortTree = (items: OperatorSubagentNode[]) => {
      items.sort((left, right) => left.runId.localeCompare(right.runId));
      items.forEach((item) => sortTree(item.children));
    };
    sortTree(roots);
    return roots;
  }

  private buildCurrentRuns(
    routes: SessionBinding[],
    gatewayEvents: GatewayEvent[],
    gatewayRuns: GatewayRunRecord[],
    provenance: OperatorProvenanceSummary[],
    childRuns: any[],
    automationRuns: any[],
    taskRuns: any[],
    appBuilderRuns: any[],
  ): OperatorRunSummary[] {
    const gatewayRunsById = new Map(gatewayRuns.map((run) => [run.id, run]));
    const lastRunEventByBinding = new Map<string, GatewayEvent>();
    for (const event of gatewayEvents) {
      if (!event.bindingId || !event.runId) continue;
      if (!lastRunEventByBinding.has(event.bindingId)) {
        lastRunEventByBinding.set(event.bindingId, event);
      }
    }

    const provenanceBySession = new Map<string, OperatorProvenanceSummary>();
    for (const item of provenance) {
      if (!provenanceBySession.has(item.sessionId)) {
        provenanceBySession.set(item.sessionId, item);
      }
    }

    const withGatewayContext = (run: OperatorRunSummary): OperatorRunSummary => {
      const gatewayRun = gatewayRunsById.get(run.id);
      if (!gatewayRun) {
        return run;
      }
      return {
        ...run,
        executionMode: gatewayRun.executionMode ?? run.executionMode ?? null,
        workerId: gatewayRun.workerId ?? run.workerId ?? null,
        queueType: gatewayRun.queueType ?? run.queueType ?? null,
        guardianOutcome: gatewayRun.guardianOutcome ?? run.guardianOutcome ?? null,
        queueMetadata: gatewayRun.queueMetadata ?? run.queueMetadata ?? null,
      };
    };

    const routeRuns: OperatorRunSummary[] = routes
      .filter((route) => route.status === 'running' || route.status === 'error' || route.status === 'paused')
      .map((route) => {
        const event = lastRunEventByBinding.get(route.id);
        return withGatewayContext({
          id: event?.runId || route.id,
          kind: 'route',
          status: route.status,
          title: `${route.agentId || 'main'} ${route.surfaceType} route`,
          summary: route.lastError || event?.summary || 'Live route binding',
          sessionId: route.sessionId,
          bindingId: route.id,
          agentId: route.agentId || null,
          startedAt: route.lastRunStartedAt || null,
          finishedAt: route.lastRunFinishedAt || null,
          heartbeatAt: route.lastHeartbeatAt || null,
          parentRunId: route.parentRunId || null,
          parentSessionId: route.parentSessionId || null,
          routeId: route.id,
          latestError: route.lastError || null,
          provenance: provenanceBySession.get(route.sessionId) || null,
        });
      });

    const childRunSummaries: OperatorRunSummary[] = childRuns.map((record) => withGatewayContext({
      id: record.id,
      kind: 'child',
      status: record.status,
      title: `Subagent ${record.agentId || 'main'}`,
      summary: record.summary || null,
      sessionId: record.childSessionId,
      bindingId: record.bindingId,
      agentId: record.agentId || null,
      startedAt: record.startedAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
      heartbeatAt: null,
      parentRunId: record.parentRunId,
      parentSessionId: record.parentSessionId,
      routeId: record.bindingId,
      latestError: record.errorMessage || null,
      provenance: provenanceBySession.get(record.childSessionId) || null,
    }));

    const automationRunSummaries: OperatorRunSummary[] = automationRuns.map((record) => withGatewayContext({
      id: record.id,
      kind: 'automation',
      status: record.status,
      title: `Automation ${record.job?.name || record.jobId}`,
      summary: record.summary || null,
      sessionId: record.sessionId || null,
      bindingId: record.bindingId || null,
      agentId: record.agentId || null,
      startedAt: record.startedAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
      heartbeatAt: record.heartbeatAt?.toISOString() || null,
      routeId: record.bindingId || null,
      latestError: record.errorMessage || null,
      provenance: record.sessionId ? provenanceBySession.get(record.sessionId) || null : null,
    }));

    const taskRunSummaries: OperatorRunSummary[] = taskRuns.map((record: any) => withGatewayContext({
      id: record.id,
      kind: 'task',
      status: record.status,
      title: record.definition?.name || 'Task run',
      summary: record.errorMessage || null,
      sessionId: record.sessionId || null,
      bindingId: null,
      agentId: record.selectedAgent || record.definition?.agentId || null,
      startedAt: record.startedAt?.toISOString?.() || record.startedAt || null,
      finishedAt: record.finishedAt?.toISOString?.() || record.finishedAt || null,
      heartbeatAt: null,
      routeId: null,
      latestError: record.errorMessage || null,
      provenance: record.sessionId ? provenanceBySession.get(record.sessionId) || null : null,
    }));

    const appBuilderRunSummaries: OperatorRunSummary[] = appBuilderRuns.map((record: any) => withGatewayContext({
      id: record.id,
      kind: 'app_builder',
      status: record.status,
      title: record.title || `App Builder ${record.phase}`,
      summary: record.summary || record.project?.name || null,
      sessionId: null,
      bindingId: null,
      agentId: 'app-builder',
      startedAt: record.startedAt?.toISOString?.() || record.startedAt || null,
      finishedAt: record.finishedAt?.toISOString?.() || record.finishedAt || null,
      heartbeatAt: null,
      routeId: null,
      latestError: record.errorMessage || null,
      provenance: null,
    }));

    return [...routeRuns, ...childRunSummaries, ...automationRunSummaries, ...taskRunSummaries, ...appBuilderRunSummaries]
      .sort((left, right) => {
        const rightTime = Date.parse(right.heartbeatAt || right.startedAt || right.finishedAt || '1970-01-01T00:00:00.000Z');
        const leftTime = Date.parse(left.heartbeatAt || left.startedAt || left.finishedAt || '1970-01-01T00:00:00.000Z');
        return rightTime - leftTime;
      })
      .slice(0, 40);
  }

  async getSnapshot(limit?: number): Promise<OperatorSnapshot> {
    const boundedLimit = this.normalizeLimit(limit);
    const [agents, routePayload, gatewayEvents, gatewayRuns, sessions, childRuns, automationRuns, taskRuns, appBuilderRuns] = await Promise.all([
      this.agentsService.list(),
      this.gatewayRoutingService.listBindingsWithSummary(),
      this.gatewayEventsService.listRecent(Math.max(boundedLimit, 80)),
      this.gatewayControlPlaneService.listRecentRuns(Math.max(boundedLimit, 80)),
      this.chatService.listSessions(),
      this.prisma.childRun.findMany({ orderBy: [{ createdAt: 'desc' }], take: 40 }),
      this.prisma.gatewayAutomationRun.findMany({
        include: { job: true },
        orderBy: [{ createdAt: 'desc' }],
        take: 40,
      }),
      this.tasksService.listRecentRuns(),
      this.prisma.appBuilderRun.findMany({
        include: { project: true },
        orderBy: [{ createdAt: 'desc' }],
        take: 40,
      }),
    ]);

    const provenance = this.collectProvenanceSummaries(sessions);
    const memoryItems = this.collectMemoryTimelineItems(sessions);
    const reviewItems = this.collectReviewTimelineItems(sessions);
    const toolActivity = this.collectToolActivity(gatewayEvents, sessions);
    const timeline = this.mergeTimeline(gatewayEvents, memoryItems, this.toProvenanceTimelineItems(provenance), reviewItems, toolActivity);
    const currentRuns = this.buildCurrentRuns(routePayload.routes, gatewayEvents, gatewayRuns, provenance, childRuns, automationRuns, taskRuns, appBuilderRuns);
    const activeSessions = this.buildActiveSessions(routePayload.routes, sessions, currentRuns);
    const activeAgents = this.buildActiveAgents(agents, routePayload.routes, currentRuns, gatewayEvents);
    const subagentTree = this.buildSubagentTree(childRuns);

    return {
      summary: {
        activeAgents: activeAgents.length,
        activeSessions: activeSessions.length,
        activeRoutes: routePayload.summary.activeRoutes,
        currentRuns: currentRuns.length,
        toolEvents: toolActivity.length,
        memoryEvents: memoryItems.length,
        degradedCount: routePayload.summary.degradedRoutes,
        subagentCount: subagentTree.length,
      },
      activeAgents,
      activeSessions,
      currentRuns,
      toolActivity,
      timeline: timeline.slice(0, boundedLimit),
      provenance: provenance.slice(0, 20),
      subagentTree,
      routes: routePayload.routes,
    };
  }

  async getTimeline(filters: TimelineFilters): Promise<OperatorTimelineResponse> {
    const snapshot = await this.getSnapshot(filters.limit);
    const items = snapshot.timeline.filter((item) => {
      if (filters.sessionId && item.sessionId !== filters.sessionId) return false;
      if (filters.agentId && item.agentId !== filters.agentId) return false;
      if (filters.memoryLayer && item.memoryLayer !== filters.memoryLayer) return false;
      if (filters.eventType && item.gatewayEventType !== filters.eventType) return false;
      return true;
    });
    return { items: items.slice(0, this.normalizeLimit(filters.limit)) };
  }

  async listActiveAgents(): Promise<AgentRuntimeListResponse> {
    const snapshot = await this.getSnapshot(40);
    return { agents: snapshot.activeAgents };
  }

  async pauseAgent(agentId: string): Promise<RunActionResult> {
    const agent = await this.agentsService.get(agentId);
    await this.agentsService.update(agentId, { status: 'paused' });
    await this.gatewayEventsService.publish({
      type: 'agent.status',
      agentId,
      summary: `Agent ${agent.name} paused by operator`,
      payload: { status: 'paused' },
    });
    return {
      success: true,
      action: 'pause_agent',
      targetId: agentId,
      message: `Paused agent ${agent.name}.`,
    };
  }

  async resumeAgent(agentId: string): Promise<RunActionResult> {
    const agent = await this.agentsService.get(agentId);
    await this.agentsService.update(agentId, { status: 'running' });
    await this.gatewayEventsService.publish({
      type: 'agent.status',
      agentId,
      summary: `Agent ${agent.name} resumed by operator`,
      payload: { status: 'running' },
    });
    return {
      success: true,
      action: 'resume_agent',
      targetId: agentId,
      message: `Resumed agent ${agent.name}.`,
    };
  }

  async cancelRun(runId: string): Promise<RunActionResult> {
    const automationRun = await this.prisma.gatewayAutomationRun.findUnique({ where: { id: runId } });
    if (automationRun) {
      const result = await this.gatewayAutomationService.cancelRun(runId);
      return {
        success: true,
        action: 'cancel_run',
        targetId: runId,
        runId,
        message: result.message,
      };
    }

    const childRun = await this.prisma.childRun.findUnique({ where: { id: runId } });
    if (childRun) {
      const result = await this.gatewaySubagentService.cancelRun(runId);
      return {
        success: true,
        action: 'cancel_run',
        targetId: runId,
        runId,
        message: result.message,
      };
    }

    try {
      await this.tasksService.getRunDetail(runId);
      await this.tasksService.updateRun(runId, { status: 'cancelled' } as any);
      return {
        success: true,
        action: 'cancel_run',
        targetId: runId,
        runId,
        message: `Marked task run ${runId} as cancelled.`,
      };
    } catch {
      // fall through
    }

    const appBuilderRun = await this.prisma.appBuilderRun.findUnique({ where: { id: runId } });
    if (appBuilderRun) {
      await this.prisma.appBuilderRun.update({
        where: { id: runId },
        data: {
          status: 'cancelled',
          finishedAt: new Date(),
        },
      });
      if (appBuilderRun.gatewayRunId) {
        await this.gatewayControlPlaneService.updateRun(appBuilderRun.gatewayRunId, {
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
          terminalOutcome: {
            status: 'cancelled',
            summary: `App Builder run ${runId} cancelled by operator.`,
            completedAt: new Date().toISOString(),
          },
        });
      }
      return {
        success: true,
        action: 'cancel_run',
        targetId: runId,
        runId,
        message: `Cancelled App Builder run ${runId}.`,
      };
    }

    throw new NotFoundException(`Run '${runId}' was not found in the operator control plane.`);
  }

  async retryRun(runId: string): Promise<RunActionResult> {
    const automationRun = await this.prisma.gatewayAutomationRun.findUnique({ where: { id: runId } });
    if (automationRun) {
      const replacement = await this.gatewayAutomationService.retryRun(runId);
      return {
        success: true,
        action: 'retry_run',
        targetId: runId,
        runId,
        replacementRunId: replacement.id,
        message: `Queued automation retry ${replacement.id}.`,
      };
    }

    try {
      const detail = await this.tasksService.getRunDetail(runId);
      const replacement = await this.tasksService.resumeRun(runId, detail.sessionId || undefined);
      return {
        success: true,
        action: 'retry_run',
        targetId: runId,
        runId,
        replacementRunId: replacement.id,
        message: `Queued task retry ${replacement.id}.`,
      };
    } catch {
      // fall through
    }

    const appBuilderRun = await this.prisma.appBuilderRun.findUnique({ where: { id: runId } });
    if (appBuilderRun) {
      const replacement = await this.appBuilderService.queueProjectPhase(appBuilderRun.projectId, appBuilderRun.phase as any);
      return {
        success: true,
        action: 'retry_run',
        targetId: runId,
        runId,
        replacementRunId: replacement.id,
        message: `Queued App Builder retry ${replacement.id}.`,
      };
    }

    if (await this.prisma.childRun.findUnique({ where: { id: runId } })) {
      throw new NotFoundException(`Child run '${runId}' cannot be retried yet because the original delegation payload is not stored durably.`);
    }

    throw new NotFoundException(`Run '${runId}' was not found in the operator control plane.`);
  }
}
