import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AutomationRun,
  BindingAffinityMode,
  BindingRule,
  ChildRunSummary,
  CreateBindingRuleRequest,
  GatewayBindingLiveState,
  GatewayEvent,
  GatewayRouteDetail,
  GatewayRouteSummary,
  GatewayRoutingContext,
  RoutingResolutionSource,
  SessionBinding,
  UpdateBindingRuleRequest,
} from '@rawclaw/shared';
import { randomUUID } from 'crypto';
import { AgentsService } from './agents.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { GatewayEventsService } from './gateway-events.service';

type ResolveRoutingInput = {
  sessionId: string;
  workspaceId: string;
  senderIdentifier: string;
  surfaceType?: string;
  threadKey?: string | null;
  channelKey?: string | null;
  agentId?: string | null;
  parentSessionId?: string | null;
  parentRunId?: string | null;
  delegationDepth?: number;
  allowedTools?: string[];
};

type BindingState = {
  bindingId: string;
  sessionId: string;
  status: string;
  runId?: string | null;
  lastHeartbeatAt?: string | null;
  lastError?: string | null;
};

type ResolutionDecision = {
  targetAgentId: string;
  affinityMode: BindingAffinityMode;
  resolutionSource: RoutingResolutionSource;
  matchedRuleId?: string | null;
  matchedRuleName?: string | null;
};

type NormalizedResolveInput = {
  requestedSessionId: string;
  workspaceId: string;
  senderIdentifier: string;
  surfaceType: string;
  threadKey: string | null;
  channelKey: string | null;
  requestedAgentId: string | null;
  parentSessionId: string | null;
  parentRunId: string | null;
  delegationDepth: number;
  allowedTools: string[];
};

const AFFINITY_MODES: BindingAffinityMode[] = ['session', 'sender', 'thread', 'channel'];

@Injectable()
export class GatewayRoutingService {
  private readonly logger = new Logger(GatewayRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gatewayEvents: GatewayEventsService,
    private readonly agentsService: AgentsService,
  ) {}

  private normalizeNullable(value?: string | null): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed ? trimmed : null;
  }

  private normalizeResolveInput(input: ResolveRoutingInput): NormalizedResolveInput {
    return {
      requestedSessionId: input.sessionId,
      workspaceId: this.normalizeNullable(input.workspaceId) || 'default',
      senderIdentifier: this.normalizeNullable(input.senderIdentifier) || 'local',
      surfaceType: this.normalizeNullable(input.surfaceType) || 'chat',
      threadKey: this.normalizeNullable(input.threadKey),
      channelKey: this.normalizeNullable(input.channelKey),
      requestedAgentId: this.normalizeNullable(input.agentId),
      parentSessionId: this.normalizeNullable(input.parentSessionId),
      parentRunId: this.normalizeNullable(input.parentRunId),
      delegationDepth: Math.max(0, input.delegationDepth || 0),
      allowedTools: input.allowedTools || [],
    };
  }

  private normalizeAffinityMode(
    preferred: BindingAffinityMode,
    input: Pick<NormalizedResolveInput, 'threadKey' | 'channelKey' | 'senderIdentifier'>,
  ): BindingAffinityMode {
    if (preferred === 'channel') {
      if (input.channelKey) return 'channel';
      if (input.threadKey) return 'thread';
      return 'session';
    }
    if (preferred === 'thread') {
      return input.threadKey ? 'thread' : 'session';
    }
    if (preferred === 'sender') {
      return input.senderIdentifier ? 'sender' : 'session';
    }
    return 'session';
  }

  private inferDefaultAffinity(input: Pick<NormalizedResolveInput, 'surfaceType' | 'threadKey' | 'channelKey'>): BindingAffinityMode {
    if (input.channelKey) return 'channel';
    if (input.threadKey) return 'thread';
    if (input.surfaceType === 'subagent') return 'session';
    return 'session';
  }

  private buildRoutingKey(input: NormalizedResolveInput, targetAgentId: string, affinityMode: BindingAffinityMode): string {
    return [
      input.workspaceId,
      input.surfaceType,
      targetAgentId || 'main',
      String(input.delegationDepth),
      affinityMode,
      this.scopeIdentity(input, affinityMode),
    ].join('::');
  }

  private scopeIdentity(input: NormalizedResolveInput, affinityMode: BindingAffinityMode): string {
    if (affinityMode === 'channel') {
      return `channel:${input.channelKey || input.threadKey || input.requestedSessionId}`;
    }
    if (affinityMode === 'thread') {
      return `thread:${input.threadKey || input.requestedSessionId}`;
    }
    if (affinityMode === 'sender') {
      return `sender:${input.senderIdentifier || 'local'}`;
    }
    return `session:${input.requestedSessionId}`;
  }

  private stateKey(bindingId: string): string {
    return `gateway:binding:${bindingId}:state`;
  }

  private async getLiveState(bindingId: string): Promise<GatewayBindingLiveState | null> {
    return this.redis.getJson<GatewayBindingLiveState>(this.stateKey(bindingId));
  }

  private mapRule(record: any): BindingRule {
    return {
      id: record.id,
      name: record.name,
      active: record.active,
      priority: record.priority,
      workspaceId: record.workspaceId || null,
      surfaceType: record.surfaceType || null,
      senderIdentifier: record.senderIdentifier || null,
      threadKey: record.threadKey || null,
      channelKey: record.channelKey || null,
      targetAgentId: record.targetAgentId || null,
      affinityMode: record.affinityMode as BindingAffinityMode,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapBinding(record: any): SessionBinding {
    return {
      id: record.id,
      routingKey: record.routingKey,
      sessionId: record.sessionId,
      workspaceId: record.workspaceId,
      senderIdentifier: record.senderIdentifier,
      surfaceType: record.surfaceType,
      threadKey: record.threadKey || null,
      channelKey: record.channelKey || null,
      agentId: record.agentId || null,
      affinityMode: (record.affinityMode || 'session') as BindingAffinityMode,
      resolutionSource: (record.resolutionSource || 'global_default') as RoutingResolutionSource,
      matchedRuleId: record.matchedRuleId || null,
      matchedRuleName: record.matchedRuleName || null,
      requestedSessionId: record.requestedSessionId || null,
      resolvedSessionId: record.resolvedSessionId || record.sessionId,
      reused: !!record.reused,
      status: record.status,
      parentSessionId: record.parentSessionId || null,
      parentRunId: record.parentRunId || null,
      delegationDepth: record.delegationDepth ?? 0,
      lastRunStartedAt: record.lastRunStartedAt?.toISOString() || null,
      lastRunFinishedAt: record.lastRunFinishedAt?.toISOString() || null,
      lastHeartbeatAt: record.lastHeartbeatAt?.toISOString() || null,
      lastError: record.lastError || null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapChildRun(record: any): ChildRunSummary {
    return {
      id: record.id,
      bindingId: record.bindingId,
      parentBindingId: record.parentBindingId || null,
      childSessionId: record.childSessionId,
      parentSessionId: record.parentSessionId,
      parentRunId: record.parentRunId,
      agentId: record.agentId || null,
      workspaceId: record.workspaceId,
      status: record.status,
      mode: record.mode,
      contextForkMode: record.contextForkMode,
      announceBackMode: record.announceBackMode,
      timeoutSeconds: record.timeoutSeconds ?? null,
      summary: record.summary || null,
      fullOutput: record.fullOutput || null,
      sources: record.sourcesJson ? JSON.parse(record.sourcesJson) : [],
      toolCalls: record.toolCallsJson ? JSON.parse(record.toolCallsJson) : [],
      provenanceTrace: record.provenanceJson ? JSON.parse(record.provenanceJson) : null,
      error: record.errorMessage || null,
      createdAt: record.createdAt.toISOString(),
      startedAt: record.startedAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
    };
  }

  private mapAutomationRun(record: any): AutomationRun {
    return {
      id: record.id,
      jobId: record.jobId,
      bindingId: record.bindingId || null,
      sessionId: record.sessionId || null,
      agentId: record.agentId || null,
      status: record.status,
      attempt: record.attempt,
      summary: record.summary || null,
      output: record.output || null,
      sources: record.sourcesJson ? JSON.parse(record.sourcesJson) : [],
      toolCalls: record.toolCallsJson ? JSON.parse(record.toolCallsJson) : [],
      provenanceTrace: record.provenanceJson ? JSON.parse(record.provenanceJson) : null,
      error: record.errorMessage || null,
      startedAt: record.startedAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
      heartbeatAt: record.heartbeatAt?.toISOString() || null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private countSpecificSelectors(rule: BindingRule): number {
    return [
      rule.workspaceId,
      rule.surfaceType,
      rule.senderIdentifier,
      rule.threadKey,
      rule.channelKey,
    ].filter((value) => value !== null && value !== undefined && value !== '').length;
  }

  private isDefaultLikeRule(rule: BindingRule): boolean {
    return !rule.senderIdentifier && !rule.threadKey && !rule.channelKey;
  }

  private ruleMatches(rule: BindingRule, input: NormalizedResolveInput): boolean {
    if (!rule.active) return false;
    if (rule.workspaceId && rule.workspaceId !== input.workspaceId) return false;
    if (rule.surfaceType && rule.surfaceType !== input.surfaceType) return false;
    if (rule.senderIdentifier && rule.senderIdentifier !== input.senderIdentifier) return false;
    if (rule.threadKey && rule.threadKey !== input.threadKey) return false;
    if (rule.channelKey && rule.channelKey !== input.channelKey) return false;
    return true;
  }

  private sortRules(left: BindingRule, right: BindingRule): number {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    const specificityDiff = this.countSpecificSelectors(right) - this.countSpecificSelectors(left);
    if (specificityDiff !== 0) {
      return specificityDiff;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  }

  private async validateTargetAgentId(targetAgentId?: string | null): Promise<void> {
    const normalized = this.normalizeNullable(targetAgentId);
    if (!normalized) {
      return;
    }
    const exists = await this.agentsService.getOptional(normalized);
    if (!exists) {
      throw new NotFoundException(`Unknown agent profile '${normalized}'.`);
    }
  }

  async listRules(): Promise<BindingRule[]> {
    const rows = await this.prisma.bindingRule.findMany({
      orderBy: [{ active: 'desc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => this.mapRule(row));
  }

  async getRule(id: string): Promise<BindingRule> {
    const row = await this.prisma.bindingRule.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Binding rule '${id}' not found.`);
    }
    return this.mapRule(row);
  }

  async createRule(payload: CreateBindingRuleRequest): Promise<BindingRule> {
    await this.validateTargetAgentId(payload.targetAgentId);
    const created = await this.prisma.bindingRule.create({
      data: {
        name: payload.name.trim(),
        active: payload.active ?? true,
        priority: payload.priority ?? 100,
        workspaceId: this.normalizeNullable(payload.workspaceId),
        surfaceType: this.normalizeNullable(payload.surfaceType),
        senderIdentifier: this.normalizeNullable(payload.senderIdentifier),
        threadKey: this.normalizeNullable(payload.threadKey),
        channelKey: this.normalizeNullable(payload.channelKey),
        targetAgentId: this.normalizeNullable(payload.targetAgentId),
        affinityMode: payload.affinityMode,
      },
    });
    return this.mapRule(created);
  }

  async updateRule(id: string, payload: UpdateBindingRuleRequest): Promise<BindingRule> {
    await this.getRule(id);
    if (payload.targetAgentId !== undefined) {
      await this.validateTargetAgentId(payload.targetAgentId);
    }

    const updated = await this.prisma.bindingRule.update({
      where: { id },
      data: {
        name: payload.name?.trim(),
        active: payload.active,
        priority: payload.priority,
        workspaceId: payload.workspaceId === undefined ? undefined : this.normalizeNullable(payload.workspaceId),
        surfaceType: payload.surfaceType === undefined ? undefined : this.normalizeNullable(payload.surfaceType),
        senderIdentifier: payload.senderIdentifier === undefined ? undefined : this.normalizeNullable(payload.senderIdentifier),
        threadKey: payload.threadKey === undefined ? undefined : this.normalizeNullable(payload.threadKey),
        channelKey: payload.channelKey === undefined ? undefined : this.normalizeNullable(payload.channelKey),
        targetAgentId: payload.targetAgentId === undefined ? undefined : this.normalizeNullable(payload.targetAgentId),
        affinityMode: payload.affinityMode,
      },
    });
    return this.mapRule(updated);
  }

  async deleteRule(id: string): Promise<{ success: true }> {
    await this.prisma.bindingRule.delete({ where: { id } });
    return { success: true };
  }

  async listBindings(): Promise<SessionBinding[]> {
    const rows = await this.prisma.sessionBinding.findMany({
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((row) => this.mapBinding(row));
  }

  async listBindingsWithSummary(): Promise<{ routes: SessionBinding[]; summary: GatewayRouteSummary }> {
    const routes = await this.listBindings();
    const activeRoutes = routes.length;
    const activeSessions = new Set(routes.map((route) => route.sessionId)).size;
    const inflightRuns = routes.filter((route) => route.status === 'running').length;
    const degradedRoutes = routes.filter((route) => route.status === 'error' || !!route.lastError).length;
    const activeSubagents = routes.filter((route) => !!route.parentSessionId).length;
    const activeAutomationJobs = await this.prisma.gatewayAutomationJob.count({
      where: { status: 'active' },
    });
    const inflightAutomationRuns = await this.prisma.gatewayAutomationRun.count({
      where: { status: 'running' },
    });

    return {
      routes,
      summary: {
        activeSessions,
        activeRoutes,
        inflightRuns,
        degradedRoutes,
        activeSubagents,
        activeAutomationJobs,
        inflightAutomationRuns,
      },
    };
  }

  async getBinding(id: string): Promise<SessionBinding | null> {
    const row = await this.prisma.sessionBinding.findUnique({ where: { id } });
    return row ? this.mapBinding(row) : null;
  }

  async getBindingDetail(id: string, recentEvents: GatewayEvent[] = []): Promise<GatewayRouteDetail | null> {
    const route = await this.getBinding(id);
    if (!route) {
      return null;
    }

    const childRows = await this.prisma.sessionBinding.findMany({
      where: { parentSessionId: route.sessionId },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const liveState = await this.getLiveState(route.id);
    const childRoutes = childRows
      .map((row) => this.mapBinding(row))
      .filter((child) => child.id !== route.id);
    const relatedBindingIds = new Set([route.id, ...childRoutes.map((child) => child.id)]);
    const relatedSessionIds = new Set([route.sessionId, ...childRoutes.map((child) => child.sessionId)]);
    const filteredEvents = recentEvents.filter((event) => {
      if (event.bindingId && relatedBindingIds.has(event.bindingId)) return true;
      if (event.sessionId && relatedSessionIds.has(event.sessionId)) return true;
      return false;
    });
    const childRunRows = await this.prisma.childRun.findMany({
      where: {
        OR: [
          { parentBindingId: route.id },
          { parentSessionId: route.sessionId },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
    });
    const automationRunRows = await this.prisma.gatewayAutomationRun.findMany({
      where: {
        OR: [
          { bindingId: route.id },
          { sessionId: route.sessionId },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
    });

    return {
      route,
      liveState,
      recentEvents: filteredEvents,
      childRoutes,
      childRunSummaries: childRunRows.map((row) => this.mapChildRun(row)),
      automationRuns: automationRunRows.map((row) => this.mapAutomationRun(row)),
    };
  }

  private isSessionBindingCompatible(existing: SessionBinding, input: NormalizedResolveInput): boolean {
    if (existing.workspaceId !== input.workspaceId) return false;
    if (existing.surfaceType !== input.surfaceType) return false;
    if ((existing.senderIdentifier || 'local') !== input.senderIdentifier) return false;
    if ((existing.threadKey || null) !== input.threadKey) return false;
    if ((existing.channelKey || null) !== input.channelKey) return false;
    if (existing.delegationDepth !== input.delegationDepth) return false;
    if ((existing.parentSessionId || null) !== input.parentSessionId) return false;
    if ((existing.parentRunId || null) !== input.parentRunId) return false;
    if (input.requestedAgentId && (existing.agentId || 'main') !== input.requestedAgentId) return false;
    return true;
  }

  private async resolveDefaultAgentId(): Promise<string> {
    const agent = await this.agentsService.getDefaultOptional();
    return agent?.id || 'main';
  }

  private async resolveRuleTargetAgentId(rule: BindingRule, fallbackAgentId: string): Promise<string> {
    if (!rule.targetAgentId) {
      return fallbackAgentId;
    }
    const agent = await this.agentsService.getOptional(rule.targetAgentId);
    if (agent) {
      return agent.id;
    }
    await this.emitHealthDegraded(`Binding rule '${rule.name}' targets missing agent '${rule.targetAgentId}'. Falling back to default agent.`, {
      ruleId: rule.id,
      targetAgentId: rule.targetAgentId,
      fallbackAgentId,
    });
    return fallbackAgentId;
  }

  private async selectResolutionDecision(
    input: NormalizedResolveInput,
    existingBySession: SessionBinding | null,
  ): Promise<ResolutionDecision> {
    const defaultAgentId = await this.resolveDefaultAgentId();

    if (input.surfaceType === 'subagent' && (input.parentSessionId || input.parentRunId)) {
      return {
        targetAgentId: input.requestedAgentId || defaultAgentId,
        affinityMode: 'session',
        resolutionSource: 'delegated_subagent',
        matchedRuleId: null,
        matchedRuleName: null,
      };
    }

    if (input.requestedAgentId) {
      return {
        targetAgentId: input.requestedAgentId,
        affinityMode: this.normalizeAffinityMode(this.inferDefaultAffinity(input), input),
        resolutionSource: 'explicit_agent',
        matchedRuleId: null,
        matchedRuleName: null,
      };
    }

    if (existingBySession && this.isSessionBindingCompatible(existingBySession, input)) {
      return {
        targetAgentId: existingBySession.agentId || defaultAgentId,
        affinityMode: existingBySession.affinityMode,
        resolutionSource: 'existing_session',
        matchedRuleId: existingBySession.matchedRuleId || null,
        matchedRuleName: existingBySession.matchedRuleName || null,
      };
    }

    const activeRules = await this.listRules();
    const matchingRules = activeRules.filter((rule) => this.ruleMatches(rule, input));
    const specificRules = matchingRules.filter((rule) => !this.isDefaultLikeRule(rule)).sort((left, right) => this.sortRules(left, right));
    const defaultRules = matchingRules.filter((rule) => this.isDefaultLikeRule(rule)).sort((left, right) => this.sortRules(left, right));
    const matchedRule = specificRules[0] || defaultRules[0] || null;

    if (matchedRule) {
      return {
        targetAgentId: await this.resolveRuleTargetAgentId(matchedRule, defaultAgentId),
        affinityMode: this.normalizeAffinityMode(matchedRule.affinityMode, input),
        resolutionSource: this.isDefaultLikeRule(matchedRule) ? 'surface_default' : 'binding_rule',
        matchedRuleId: matchedRule.id,
        matchedRuleName: matchedRule.name,
      };
    }

    return {
      targetAgentId: defaultAgentId,
      affinityMode: this.normalizeAffinityMode(this.inferDefaultAffinity(input), input),
      resolutionSource: 'global_default',
      matchedRuleId: null,
      matchedRuleName: null,
    };
  }

  private async persistBindingDecision(
    bindingId: string,
    decision: ResolutionDecision,
    input: NormalizedResolveInput,
    reused: boolean,
  ): Promise<SessionBinding> {
    const updated = await this.prisma.sessionBinding.update({
      where: { id: bindingId },
      data: {
        agentId: decision.targetAgentId,
        affinityMode: decision.affinityMode,
        resolutionSource: decision.resolutionSource,
        matchedRuleId: decision.matchedRuleId || null,
        matchedRuleName: decision.matchedRuleName || null,
        requestedSessionId: input.requestedSessionId,
        resolvedSessionId: undefined,
        reused,
      },
    });
    return this.mapBinding(updated);
  }

  async resolveBinding(input: ResolveRoutingInput): Promise<{ binding: SessionBinding; routing: GatewayRoutingContext; reused: boolean }> {
    const normalized = this.normalizeResolveInput(input);
    const existingBySessionRow = await this.prisma.sessionBinding.findUnique({
      where: { sessionId: normalized.requestedSessionId },
    });
    const existingBySession = existingBySessionRow ? this.mapBinding(existingBySessionRow) : null;
    const decision = await this.selectResolutionDecision(normalized, existingBySession);
    const routingKey = this.buildRoutingKey(normalized, decision.targetAgentId, decision.affinityMode);

    if (
      existingBySession &&
      existingBySession.routingKey !== routingKey &&
      !this.isSessionBindingCompatible(existingBySession, normalized)
    ) {
      await this.gatewayEvents.publish({
        type: 'routing.conflict',
        sessionId: normalized.requestedSessionId,
        bindingId: existingBySession.id,
        agentId: decision.targetAgentId,
        parentSessionId: normalized.parentSessionId,
        parentRunId: normalized.parentRunId,
        summary: `Routing conflict for session ${normalized.requestedSessionId}`,
        payload: {
          existingRoutingKey: existingBySession.routingKey,
          requestedRoutingKey: routingKey,
          requestedSessionId: normalized.requestedSessionId,
          resolvedSessionId: existingBySession.sessionId,
          resolutionSource: decision.resolutionSource,
          affinityMode: decision.affinityMode,
          matchedRuleId: decision.matchedRuleId,
          matchedRuleName: decision.matchedRuleName,
        },
      });
      throw new ConflictException(`Session '${normalized.requestedSessionId}' is already bound to a different routing identity.`);
    }

    const existingByKeyRow = await this.prisma.sessionBinding.findUnique({
      where: { routingKey },
    });

    if (existingByKeyRow) {
      const persisted = await this.persistBindingDecision(existingByKeyRow.id, decision, normalized, true);
      await this.syncBindingState(persisted);
      await this.gatewayEvents.publish({
        type: 'session.lifecycle',
        sessionId: persisted.sessionId,
        bindingId: persisted.id,
        agentId: persisted.agentId,
        parentSessionId: persisted.parentSessionId,
        parentRunId: persisted.parentRunId,
        summary: `Session ${persisted.sessionId} reused via routing policy`,
        payload: {
          action: 'reused',
          routingKey: persisted.routingKey,
          requestedSessionId: normalized.requestedSessionId,
          resolvedSessionId: persisted.sessionId,
        },
      });
      await this.gatewayEvents.publish({
        type: 'routing.resolved',
        sessionId: persisted.sessionId,
        bindingId: persisted.id,
        agentId: persisted.agentId,
        parentSessionId: persisted.parentSessionId,
        parentRunId: persisted.parentRunId,
        summary: `Resolved routing binding ${persisted.id}`,
        payload: {
          reused: true,
          routingKey: persisted.routingKey,
          resolutionSource: persisted.resolutionSource,
          affinityMode: persisted.affinityMode,
          matchedRuleId: persisted.matchedRuleId,
          matchedRuleName: persisted.matchedRuleName,
          requestedSessionId: normalized.requestedSessionId,
          resolvedSessionId: persisted.sessionId,
        },
      });
      return { binding: persisted, routing: this.toRoutingContext(persisted, normalized.allowedTools), reused: true };
    }

    await this.prisma.session.upsert({
      where: { id: normalized.requestedSessionId },
      update: {
        workspaceId: normalized.workspaceId,
        senderIdentifier: normalized.senderIdentifier,
        surfaceType: normalized.surfaceType,
        updatedAt: new Date(),
      },
      create: {
        id: normalized.requestedSessionId,
        title: null,
        workspaceId: normalized.workspaceId,
        senderIdentifier: normalized.senderIdentifier,
        surfaceType: normalized.surfaceType,
      },
    });

    const sessionIdToUse = existingBySession ? randomUUID() : normalized.requestedSessionId;

    if (sessionIdToUse !== normalized.requestedSessionId) {
      await this.prisma.session.upsert({
        where: { id: sessionIdToUse },
        update: {
          workspaceId: normalized.workspaceId,
          senderIdentifier: normalized.senderIdentifier,
          surfaceType: normalized.surfaceType,
          updatedAt: new Date(),
        },
        create: {
          id: sessionIdToUse,
          title: null,
          workspaceId: normalized.workspaceId,
          senderIdentifier: normalized.senderIdentifier,
          surfaceType: normalized.surfaceType,
        },
      });
    }

    const created = await this.prisma.sessionBinding.create({
      data: {
        routingKey,
        sessionId: sessionIdToUse,
        workspaceId: normalized.workspaceId,
        senderIdentifier: normalized.senderIdentifier,
        surfaceType: normalized.surfaceType,
        threadKey: normalized.threadKey,
        channelKey: normalized.channelKey,
        agentId: decision.targetAgentId,
        affinityMode: decision.affinityMode,
        resolutionSource: decision.resolutionSource,
        matchedRuleId: decision.matchedRuleId || null,
        matchedRuleName: decision.matchedRuleName || null,
        requestedSessionId: normalized.requestedSessionId,
        resolvedSessionId: sessionIdToUse,
        reused: false,
        status: 'idle',
        parentSessionId: normalized.parentSessionId,
        parentRunId: normalized.parentRunId,
        delegationDepth: normalized.delegationDepth,
      },
    });

    const binding = this.mapBinding(created);
    await this.syncBindingState(binding);
    await this.gatewayEvents.publish({
      type: 'session.lifecycle',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      agentId: binding.agentId,
      parentSessionId: binding.parentSessionId,
      parentRunId: binding.parentRunId,
      summary: `Session ${binding.sessionId} created`,
      payload: {
        action: 'created',
        routingKey: binding.routingKey,
        requestedSessionId: normalized.requestedSessionId,
        resolvedSessionId: binding.sessionId,
      },
    });
    await this.gatewayEvents.publish({
      type: 'routing.resolved',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      agentId: binding.agentId,
      parentSessionId: binding.parentSessionId,
      parentRunId: binding.parentRunId,
      summary: `Created routing binding ${binding.id}`,
      payload: {
        reused: false,
        routingKey: binding.routingKey,
        resolutionSource: binding.resolutionSource,
        affinityMode: binding.affinityMode,
        matchedRuleId: binding.matchedRuleId,
        matchedRuleName: binding.matchedRuleName,
        requestedSessionId: normalized.requestedSessionId,
        resolvedSessionId: binding.sessionId,
      },
    });
    return { binding, routing: this.toRoutingContext(binding, normalized.allowedTools), reused: false };
  }

  toRoutingContext(binding: SessionBinding, allowedTools: string[] = []): GatewayRoutingContext {
    return {
      bindingId: binding.id,
      routingKey: binding.routingKey,
      sessionId: binding.sessionId,
      workspaceId: binding.workspaceId,
      senderIdentifier: binding.senderIdentifier,
      surfaceType: binding.surfaceType,
      threadKey: binding.threadKey || null,
      channelKey: binding.channelKey || null,
      agentId: binding.agentId || null,
      affinityMode: binding.affinityMode,
      resolutionSource: binding.resolutionSource,
      matchedRuleId: binding.matchedRuleId || null,
      matchedRuleName: binding.matchedRuleName || null,
      requestedSessionId: binding.requestedSessionId || null,
      resolvedSessionId: binding.resolvedSessionId || binding.sessionId,
      reused: binding.reused,
      parentSessionId: binding.parentSessionId || null,
      parentRunId: binding.parentRunId || null,
      delegationDepth: binding.delegationDepth,
      allowedTools,
    };
  }

  async markRunStarted(bindingId: string, runId: string): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.sessionBinding.update({
      where: { id: bindingId },
      data: {
        status: 'running',
        lastRunStartedAt: now,
        lastHeartbeatAt: now,
        lastError: null,
      },
    });
    const binding = this.mapBinding(updated);
    await this.redis.setJson(this.stateKey(bindingId), {
      bindingId,
      sessionId: binding.sessionId,
      status: 'running',
      runId,
      lastHeartbeatAt: now.toISOString(),
      lastError: null,
    } satisfies BindingState);
    await this.gatewayEvents.publish({
      type: 'run.started',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId,
      agentId: binding.agentId,
      parentSessionId: binding.parentSessionId,
      parentRunId: binding.parentRunId,
      summary: `Run ${runId} started`,
      payload: {
        routingKey: binding.routingKey,
        delegationDepth: binding.delegationDepth,
        resolutionSource: binding.resolutionSource,
        affinityMode: binding.affinityMode,
      },
    });
  }

  async heartbeat(bindingId: string, runId: string): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.sessionBinding.update({
      where: { id: bindingId },
      data: {
        lastHeartbeatAt: now,
      },
    });
    const binding = this.mapBinding(updated);
    await this.redis.setJson(this.stateKey(bindingId), {
      bindingId,
      sessionId: binding.sessionId,
      status: binding.status,
      runId,
      lastHeartbeatAt: now.toISOString(),
      lastError: binding.lastError,
    } satisfies BindingState);
    await this.gatewayEvents.publish({
      type: 'run.heartbeat',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId,
      agentId: binding.agentId,
      summary: `Run ${runId} heartbeat`,
      payload: { lastHeartbeatAt: now.toISOString() },
    });
  }

  async markRunFinished(bindingId: string, runId: string, status: 'completed' | 'failed', error?: string | null): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.sessionBinding.update({
      where: { id: bindingId },
      data: {
        status: status === 'failed' ? 'error' : 'idle',
        lastRunFinishedAt: now,
        lastHeartbeatAt: now,
        lastError: error || null,
      },
    });
    const binding = this.mapBinding(updated);
    await this.redis.setJson(this.stateKey(bindingId), {
      bindingId,
      sessionId: binding.sessionId,
      status: status === 'failed' ? 'error' : 'idle',
      runId,
      lastHeartbeatAt: now.toISOString(),
      lastError: error || null,
    } satisfies BindingState);
    await this.gatewayEvents.publish({
      type: status === 'failed' ? 'run.failed' : 'run.finished',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId,
      agentId: binding.agentId,
      parentSessionId: binding.parentSessionId,
      parentRunId: binding.parentRunId,
      summary: status === 'failed' ? `Run ${runId} failed` : `Run ${runId} finished`,
      payload: error ? { error } : { status },
    });
  }

  async emitToolActivity(bindingId: string, runId: string, toolName: string, phase: 'start' | 'result'): Promise<void> {
    const binding = await this.getBinding(bindingId);
    if (!binding) return;
    await this.gatewayEvents.publish({
      type: 'tool.activity',
      sessionId: binding.sessionId,
      bindingId: binding.id,
      runId,
      agentId: binding.agentId,
      summary: `${toolName} ${phase}`,
      payload: { toolName, phase },
    });
  }

  async emitHealthDegraded(summary: string, payload?: Record<string, unknown>): Promise<void> {
    await this.gatewayEvents.publish({
      type: 'health.degraded',
      summary,
      payload: payload || null,
    });
  }

  private async syncBindingState(binding: SessionBinding): Promise<void> {
    const state: BindingState = {
      bindingId: binding.id,
      sessionId: binding.sessionId,
      status: binding.status,
      lastHeartbeatAt: binding.lastHeartbeatAt || null,
      lastError: binding.lastError || null,
    };
    await this.redis.setJson(this.stateKey(binding.id), state);
  }
}
