export type SessionBindingStatus = 'idle' | 'running' | 'error' | 'paused';
export type BindingAffinityMode = 'session' | 'sender' | 'thread' | 'channel';
export type SubagentMode = 'background' | 'blocking';
export type ContextForkMode = 'none' | 'recent' | 'compact_summary';
export type AnnounceBackMode = 'summary' | 'full_output' | 'artifact_reference';
export type ChildRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AutomationKind = 'heartbeat' | 'recurring_research' | 'background_task';
export type AutomationJobStatus = 'active' | 'paused' | 'disabled';
export type AutomationRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RoutingResolutionSource =
  | 'delegated_subagent'
  | 'explicit_agent'
  | 'existing_session'
  | 'binding_rule'
  | 'surface_default'
  | 'global_default';

export interface BindingRule {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  workspaceId?: string | null;
  surfaceType?: string | null;
  senderIdentifier?: string | null;
  threadKey?: string | null;
  channelKey?: string | null;
  targetAgentId?: string | null;
  affinityMode: BindingAffinityMode;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBindingRuleRequest {
  name: string;
  active?: boolean;
  priority?: number;
  workspaceId?: string | null;
  surfaceType?: string | null;
  senderIdentifier?: string | null;
  threadKey?: string | null;
  channelKey?: string | null;
  targetAgentId?: string | null;
  affinityMode: BindingAffinityMode;
}

export interface UpdateBindingRuleRequest {
  name?: string;
  active?: boolean;
  priority?: number;
  workspaceId?: string | null;
  surfaceType?: string | null;
  senderIdentifier?: string | null;
  threadKey?: string | null;
  channelKey?: string | null;
  targetAgentId?: string | null;
  affinityMode?: BindingAffinityMode;
}

export interface SessionBinding {
  id: string;
  routingKey: string;
  sessionId: string;
  workspaceId: string;
  senderIdentifier: string;
  surfaceType: string;
  threadKey?: string | null;
  channelKey?: string | null;
  agentId?: string | null;
  affinityMode: BindingAffinityMode;
  resolutionSource: RoutingResolutionSource;
  matchedRuleId?: string | null;
  matchedRuleName?: string | null;
  requestedSessionId?: string | null;
  resolvedSessionId?: string | null;
  reused: boolean;
  status: SessionBindingStatus;
  parentSessionId?: string | null;
  parentRunId?: string | null;
  delegationDepth: number;
  lastRunStartedAt?: string | null;
  lastRunFinishedAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayRoutingContext {
  bindingId: string;
  routingKey: string;
  sessionId: string;
  workspaceId: string;
  senderIdentifier: string;
  surfaceType: string;
  threadKey?: string | null;
  channelKey?: string | null;
  agentId?: string | null;
  affinityMode: BindingAffinityMode;
  resolutionSource: RoutingResolutionSource;
  matchedRuleId?: string | null;
  matchedRuleName?: string | null;
  requestedSessionId?: string | null;
  resolvedSessionId?: string | null;
  reused: boolean;
  parentSessionId?: string | null;
  parentRunId?: string | null;
  delegationDepth: number;
  allowedTools?: string[];
}

export interface GatewayBindingLiveState {
  bindingId: string;
  sessionId: string;
  status: SessionBindingStatus | string;
  runId?: string | null;
  lastHeartbeatAt?: string | null;
  lastError?: string | null;
}

export type GatewayEventType =
  | 'session.lifecycle'
  | 'run.started'
  | 'run.heartbeat'
  | 'run.finished'
  | 'run.failed'
  | 'run.cancelled'
  | 'routing.resolved'
  | 'routing.conflict'
  | 'tool.activity'
  | 'agent.status'
  | 'health.degraded'
  | 'subagent.queued'
  | 'subagent.spawned'
  | 'subagent.completed'
  | 'subagent.failed'
  | 'subagent.cancelled'
  | 'subagent.announced_back'
  | 'automation.job.lifecycle'
  | 'automation.run.queued'
  | 'automation.run.started'
  | 'automation.run.heartbeat'
  | 'automation.run.completed'
  | 'automation.run.failed'
  | 'automation.run.cancelled';

export interface GatewayEvent {
  id: string;
  type: GatewayEventType;
  timestamp: string;
  sessionId?: string | null;
  bindingId?: string | null;
  runId?: string | null;
  agentId?: string | null;
  parentSessionId?: string | null;
  parentRunId?: string | null;
  summary?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface ChildRunSummary {
  id: string;
  bindingId: string;
  parentBindingId?: string | null;
  childSessionId: string;
  parentSessionId: string;
  parentRunId: string;
  agentId?: string | null;
  workspaceId: string;
  status: ChildRunStatus;
  mode: SubagentMode;
  contextForkMode: ContextForkMode;
  announceBackMode: AnnounceBackMode;
  timeoutSeconds?: number | null;
  summary?: string | null;
  fullOutput?: string | null;
  sources?: string[];
  toolCalls?: Record<string, unknown>[];
  provenanceTrace?: Record<string, unknown> | null;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface AutomationJob {
  id: string;
  name: string;
  kind: AutomationKind;
  status: AutomationJobStatus;
  schedule: string;
  prompt: string;
  workspaceId: string;
  agentId?: string | null;
  sessionId?: string | null;
  bindingId?: string | null;
  surfaceType?: string | null;
  senderIdentifier?: string | null;
  threadKey?: string | null;
  channelKey?: string | null;
  toolIds?: string[];
  model?: string | null;
  contextForkMode: ContextForkMode;
  maxConcurrency: number;
  timeoutSeconds: number;
  maxRetries: number;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  jobId: string;
  bindingId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  status: AutomationRunStatus;
  attempt: number;
  summary?: string | null;
  output?: string | null;
  sources?: string[];
  toolCalls?: Record<string, unknown>[];
  provenanceTrace?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  heartbeatAt?: string | null;
  createdAt: string;
}

export interface GatewayHeartbeatEvent {
  type: 'heartbeat';
  timestamp: string;
}

export type GatewayStreamEvent = GatewayEvent | GatewayHeartbeatEvent;

export interface GatewayRouteSummary {
  activeSessions: number;
  activeRoutes: number;
  inflightRuns: number;
  degradedRoutes: number;
  activeSubagents: number;
  activeAutomationJobs?: number;
  inflightAutomationRuns?: number;
}

export interface GatewayRouteDetail {
  route: SessionBinding;
  liveState: GatewayBindingLiveState | null;
  recentEvents: GatewayEvent[];
  childRoutes: SessionBinding[];
  childRunSummaries?: ChildRunSummary[];
  automationRuns?: AutomationRun[];
}

export interface SubagentInvocation {
  parentSessionId: string;
  parentRunId: string;
  prompt: string;
  childSessionId?: string;
  delegationDepth?: number;
  mode?: SubagentMode;
  contextForkMode?: ContextForkMode;
  announceBackMode?: AnnounceBackMode;
  allowedTools?: string[];
  agentId?: string;
  workspaceId?: string;
  senderIdentifier?: string;
  surfaceType?: string;
  threadKey?: string;
  channelKey?: string;
  model?: string;
  timeoutSeconds?: number;
}

export interface SubagentResult {
  childSessionId: string;
  childRunId?: string;
  parentSessionId: string;
  parentRunId: string;
  delegationDepth: number;
  mode?: SubagentMode;
  announceBackMode?: AnnounceBackMode;
  status: 'queued' | 'running' | 'completed' | 'failed';
  summary?: string | null;
  output: string;
  sources?: string[];
  toolCalls?: Record<string, unknown>[];
  provenanceTrace?: Record<string, unknown> | null;
  error?: string | null;
}

export interface CreateAutomationJobRequest {
  name: string;
  kind: AutomationKind;
  status?: AutomationJobStatus;
  schedule: string;
  prompt: string;
  workspaceId?: string;
  agentId?: string | null;
  sessionId?: string | null;
  bindingId?: string | null;
  surfaceType?: string | null;
  senderIdentifier?: string | null;
  threadKey?: string | null;
  channelKey?: string | null;
  toolIds?: string[];
  model?: string | null;
  contextForkMode?: ContextForkMode;
  maxConcurrency?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateAutomationJobRequest {
  name?: string;
  kind?: AutomationKind;
  status?: AutomationJobStatus;
  schedule?: string;
  prompt?: string;
  workspaceId?: string;
  agentId?: string | null;
  sessionId?: string | null;
  bindingId?: string | null;
  surfaceType?: string | null;
  senderIdentifier?: string | null;
  threadKey?: string | null;
  channelKey?: string | null;
  toolIds?: string[];
  model?: string | null;
  contextForkMode?: ContextForkMode;
  maxConcurrency?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown> | null;
}
