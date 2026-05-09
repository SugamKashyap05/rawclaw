export type SessionBindingStatus = 'idle' | 'running' | 'error' | 'paused';
export type BindingAffinityMode = 'session' | 'sender' | 'thread' | 'channel';
export type SubagentMode = 'background' | 'blocking';
export type SubagentRole = 'strategist' | 'scout' | 'analyst' | 'guardian' | 'generic';
export type ContextForkMode = 'none' | 'recent' | 'compact_summary';
export type AnnounceBackMode = 'summary' | 'full_output' | 'artifact_reference';
export type ChildRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AutomationKind = 'heartbeat' | 'recurring_research' | 'background_task';
export type AutomationJobStatus = 'active' | 'paused' | 'disabled';
export type AutomationRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type GatewayRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type GatewayRunKind = 'foreground_chat' | 'subagent' | 'automation' | 'background_task' | 'app_builder';
export type GatewayExecutionMode = 'foreground' | 'queued' | 'mixed';
export type WorkerRuntimeStatus = 'online' | 'busy' | 'offline';
export type WorkerQueueType = 'subagent' | 'automation' | 'sandbox' | 'builder';
export type WorkerRuntimeType = 'python_swarm_worker' | 'sandbox_worker';
export type SandboxJobMode = 'shell' | 'python';
export type SandboxJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type QueueJobSummaryStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'stale' | 'requeued';
export type ShortTermMemoryKind =
  | 'strategist_brief'
  | 'selected_urls'
  | 'search_terms'
  | 'scout_evidence'
  | 'analyst_verdict'
  | 'guardian_verdict'
  | 'handoff_context'
  | 'provenance_summary';
export type KnowledgeNodeKind =
  | 'session'
  | 'run'
  | 'message'
  | 'agent'
  | 'url'
  | 'document'
  | 'entity'
  | 'memory_item'
  | 'task'
  | 'app_project'
  | 'app_registry';
export type KnowledgeEdgeKind =
  | 'generated_by'
  | 'cites'
  | 'mentions'
  | 'derived_from'
  | 'delegated_to'
  | 'answered_by'
  | 'stored_as_memory'
  | 'contradicts'
  | 'supports';
export type ReflectionProposalKind =
  | 'strategy_proposal'
  | 'policy_proposal'
  | 'prompt_proposal'
  | 'worker_routing_hint'
  | 'sandbox_rule_hint';
export type ReflectionProposalStatus = 'proposed' | 'approved' | 'published' | 'rejected';
export type SimulationRunStatus = 'queued' | 'running' | 'completed' | 'failed';
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
  | 'run.queued'
  | 'run.started'
  | 'run.heartbeat'
  | 'run.completed'
  | 'run.finished'
  | 'run.failed'
  | 'run.cancelled'
  | 'routing.resolved'
  | 'routing.conflict'
  | 'tool.activity'
  | 'agent.status'
  | 'health.degraded'
  | 'role_trace.updated'
  | 'guardian.refused'
  | 'subagent.queued'
  | 'subagent.started'
  | 'subagent.spawned'
  | 'subagent.completed'
  | 'subagent.failed'
  | 'subagent.cancelled'
  | 'subagent.announced_back'
  | 'subagent.job.queued'
  | 'subagent.job.started'
  | 'subagent.job.completed'
  | 'subagent.job.failed'
  | 'automation.job.lifecycle'
  | 'automation.run.queued'
  | 'automation.run.started'
  | 'automation.run.heartbeat'
  | 'automation.run.completed'
  | 'automation.run.failed'
  | 'automation.run.cancelled'
  | 'automation.job.queued'
  | 'automation.job.started'
  | 'automation.job.completed'
  | 'automation.job.failed'
  | 'worker.registered'
  | 'worker.heartbeat'
  | 'worker.offline'
  | 'sandbox.job.queued'
  | 'sandbox.job.started'
  | 'sandbox.job.completed'
  | 'sandbox.job.failed'
  | 'builder.job.queued'
  | 'builder.job.started'
  | 'builder.job.completed'
  | 'builder.job.failed'
  | 'app_builder.project.updated'
  | 'app_builder.registered'
  | 'knowledge_graph.ingested'
  | 'knowledge_graph.failed'
  | 'reflection.proposal.created'
  | 'reflection.proposal.approved'
  | 'reflection.proposal.published'
  | 'reflection.proposal.rejected'
  | 'simulation.run.queued'
  | 'simulation.run.started'
  | 'simulation.run.completed'
  | 'simulation.run.failed';

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

export interface GatewayQueueMetadata {
  executionMode: GatewayExecutionMode;
  queuedRoles: SubagentRole[];
  workerAssignments: string[];
  queueFallbackUsed: boolean;
}

export interface GatewayGuardianOutcome {
  status: 'approved' | 'limited' | 'refused' | 'fail_closed';
  reviewer?: string | null;
  reason?: string | null;
  failClosed?: boolean;
  updatedAt?: string | null;
}

export interface GatewayTerminalOutcome {
  status: GatewayRunStatus;
  summary?: string | null;
  error?: string | null;
  completedAt?: string | null;
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

export interface GatewayRunRecord {
  id: string;
  kind: GatewayRunKind;
  status: GatewayRunStatus;
  executionMode?: GatewayExecutionMode;
  sessionId?: string | null;
  bindingId?: string | null;
  agentId?: string | null;
  parentSessionId?: string | null;
  parentRunId?: string | null;
  role?: SubagentRole | null;
  workerId?: string | null;
  queueType?: WorkerQueueType | null;
  jobId?: string | null;
  summary?: string | null;
  error?: string | null;
  guardianOutcome?: GatewayGuardianOutcome | null;
  queueMetadata?: GatewayQueueMetadata | null;
  terminalOutcome?: GatewayTerminalOutcome | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  startedAt?: string | null;
  heartbeatAt?: string | null;
  finishedAt?: string | null;
}

export interface RoleTraceSnapshot {
  sessionId: string;
  runId: string;
  bindingId?: string | null;
  agentId?: string | null;
  parentSessionId?: string | null;
  parentRunId?: string | null;
  workerId?: string | null;
  workerAssignments?: string[];
  roleTrace: Record<string, unknown>;
  provenanceTrace?: Record<string, unknown> | null;
  source: GatewayRunKind | 'foreground';
  updatedAt: string;
}

export interface ShortTermMemoryEntry {
  key: string;
  sessionId: string;
  runId: string;
  subagentId?: string | null;
  kind: ShortTermMemoryKind;
  value: Record<string, unknown>;
  graphNodeIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkerRegistration {
  workerId: string;
  workerType: WorkerRuntimeType;
  hostname: string;
  pid: number;
  roles: SubagentRole[];
  queues: WorkerQueueType[];
  capabilities: string[];
  metadata?: Record<string, unknown> | null;
}

export interface WorkerStatusSnapshot {
  workerId: string;
  workerType: WorkerRuntimeType;
  status: WorkerRuntimeStatus;
  hostname: string;
  pid: number;
  roles: SubagentRole[];
  queues: WorkerQueueType[];
  capabilities: string[];
  currentJobId?: string | null;
  currentRunId?: string | null;
  registeredAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WorkerLease {
  workerId: string;
  jobId: string;
  queueType: WorkerQueueType;
  runId?: string | null;
  sessionId?: string | null;
  leaseExpiresAt: string;
  lastHeartbeatAt: string;
}

export interface SubagentJob {
  id: string;
  turn_id?: string | null;
  recordId: string;
  runId: string;
  sessionId: string;
  bindingId: string;
  parentSessionId: string;
  parentRunId: string;
  prompt: string;
  agentId?: string | null;
  role: SubagentRole;
  status: GatewayRunStatus;
  mode: SubagentMode;
  contextForkMode: ContextForkMode;
  announceBackMode: AnnounceBackMode;
  allowedTools: string[];
  timeoutSeconds: number;
  requestPayload?: Record<string, unknown> | null;
  workerId?: string | null;
  createdAt: string;
}

export interface ScoutJob extends SubagentJob {
  role: 'scout';
}

export interface AnalystJob extends SubagentJob {
  role: 'analyst';
}

export interface AutomationQueueJob {
  turn_id?: string | null;
  runId: string;
  jobId: string;
  bindingId: string;
  sessionId: string;
  agentId?: string | null;
  requestPayload?: Record<string, unknown> | null;
  workerId?: string | null;
  status: GatewayRunStatus;
  createdAt: string;
}

export interface SandboxJob {
  id: string;
  turn_id?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  toolName: string;
  mode: SandboxJobMode;
  status: SandboxJobStatus;
  workerId?: string | null;
  payload: {
    command?: string | null;
    code?: string | null;
    inputData?: Record<string, unknown> | null;
    inputFiles?: Record<string, string> | null;
    timeoutSeconds: number;
    image?: string | null;
    memoryLimit?: string | null;
    networkDisabled?: boolean;
  };
  result?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    timedOut?: boolean;
    outputFiles?: Record<string, string>;
    error?: string | null;
    durationMs?: number;
  } | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface QueueJobSummary {
  id: string;
  queueType: WorkerQueueType;
  status: QueueJobSummaryStatus;
  runId?: string | null;
  sessionId?: string | null;
  workerId?: string | null;
  title: string;
  summary?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  raw: Record<string, unknown>;
}

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  ref: string;
  label: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEdge {
  id: string;
  kind: KnowledgeEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface GraphIngestionRecord {
  id: string;
  runId: string;
  sessionId?: string | null;
  status: 'completed' | 'failed';
  error?: string | null;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeGraphLineageView {
  runId?: string | null;
  sessionId?: string | null;
  supportingSources: string[];
  workerIds: string[];
  referencedEntities: string[];
  priorRunIds: string[];
}

export interface ReflectionProposal {
  id: string;
  kind: ReflectionProposalKind;
  status: ReflectionProposalStatus;
  runId?: string | null;
  sessionId?: string | null;
  title: string;
  rationale: string;
  proposal: Record<string, unknown>;
  approvalNotes?: string | null;
  assetVersion?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationEligibility {
  proposalId: string;
  canApprove: boolean;
  latestSimulationId?: string | null;
  latestSimulationStatus?: SimulationRunStatus | null;
  latestSimulationImproved?: boolean | null;
  reasons: string[];
}

export interface ReflectionProposalView {
  proposal: ReflectionProposal;
  simulationEligibility: SimulationEligibility;
}

export interface SimulationRun {
  id: string;
  proposalId?: string | null;
  runId?: string | null;
  status: SimulationRunStatus;
  inputEnvelope: Record<string, unknown>;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface SimulationResult {
  id: string;
  simulationRunId: string;
  improved: boolean;
  scoreDelta: number;
  findings: string[];
  metrics: Record<string, number>;
  createdAt: string;
}

export interface GatewayRoleTraceLookup {
  roleTrace: RoleTraceSnapshot | null;
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
  role?: SubagentRole;
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
