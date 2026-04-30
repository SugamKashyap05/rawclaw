import { AgentExecutionStatus, AgentProfile } from './agent';
import { MemoryEvent, WorkflowState } from './chat';
import { AutomationKind, AutomationRunStatus, ChildRunStatus, GatewayEventType, SessionBinding, SessionBindingStatus } from './gateway';

export type OperatorRunKind = 'route' | 'child' | 'automation' | 'task';
export type OperatorTimelineKind = 'gateway_event' | 'tool_activity' | 'memory_event' | 'provenance' | 'review' | 'subagent';
export type OperatorRunStatus = SessionBindingStatus | ChildRunStatus | AutomationRunStatus | 'queued' | 'done' | 'cancelled';

export interface OperatorSnapshotSummary {
  activeAgents: number;
  activeSessions: number;
  activeRoutes: number;
  currentRuns: number;
  toolEvents: number;
  memoryEvents: number;
  degradedCount: number;
  subagentCount: number;
}

export interface OperatorProvenanceSummary {
  messageId: string;
  sessionId: string;
  promptPackId?: string | null;
  workflowPromptIds?: string[];
  reviewState?: 'approved' | 'rejected' | 'pending' | 'unknown';
  toolBacked: boolean;
  modelOnly: boolean;
  confidenceState?: string | null;
  assistantLane?: string | null;
  answerabilityMode?: string | null;
  createdAt: string;
}

export interface ActiveAgentRuntimeState {
  agentId: string;
  name: string;
  status: AgentExecutionStatus;
  isDefault: boolean;
  activeRouteCount: number;
  currentRunCount: number;
  activeSessionCount: number;
  lastEventAt?: string | null;
  lastError?: string | null;
  workspaceIds: string[];
  routeIds: string[];
}

export interface ActiveSessionRuntimeState {
  sessionId: string;
  bindingId?: string | null;
  title?: string | null;
  workspaceId: string;
  senderIdentifier: string;
  surfaceType?: string | null;
  agentId?: string | null;
  routeStatus?: SessionBindingStatus | null;
  currentRunIds: string[];
  lastMessageAt?: string | null;
  lastHeartbeatAt?: string | null;
  latestError?: string | null;
  parentSessionId?: string | null;
  childSessionIds: string[];
}

export interface ToolActivityItem {
  id: string;
  timestamp: string;
  sessionId?: string | null;
  bindingId?: string | null;
  runId?: string | null;
  agentId?: string | null;
  toolName: string;
  phase?: 'start' | 'result' | 'unknown';
  summary: string;
  source: 'gateway_event' | 'chat_message';
}

export interface OperatorRunSummary {
  id: string;
  kind: OperatorRunKind;
  status: OperatorRunStatus;
  title: string;
  summary?: string | null;
  sessionId?: string | null;
  bindingId?: string | null;
  agentId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  heartbeatAt?: string | null;
  parentRunId?: string | null;
  parentSessionId?: string | null;
  routeId?: string | null;
  latestError?: string | null;
  provenance?: OperatorProvenanceSummary | null;
}

export interface OperatorTimelineItem {
  id: string;
  kind: OperatorTimelineKind;
  timestamp: string;
  summary: string;
  detail?: string | null;
  sessionId?: string | null;
  bindingId?: string | null;
  runId?: string | null;
  agentId?: string | null;
  parentRunId?: string | null;
  parentSessionId?: string | null;
  memoryLayer?: MemoryEvent['layer'] | null;
  memoryAction?: MemoryEvent['action'] | null;
  gatewayEventType?: GatewayEventType | null;
  workflowState?: WorkflowState | null;
  routeId?: string | null;
}

export interface OperatorSubagentNode {
  id: string;
  runId: string;
  sessionId: string;
  bindingId?: string | null;
  agentId?: string | null;
  status: ChildRunStatus;
  summary?: string | null;
  parentRunId?: string | null;
  parentSessionId?: string | null;
  children: OperatorSubagentNode[];
}

export interface OperatorSnapshot {
  summary: OperatorSnapshotSummary;
  activeAgents: ActiveAgentRuntimeState[];
  activeSessions: ActiveSessionRuntimeState[];
  currentRuns: OperatorRunSummary[];
  toolActivity: ToolActivityItem[];
  timeline: OperatorTimelineItem[];
  provenance: OperatorProvenanceSummary[];
  subagentTree: OperatorSubagentNode[];
  routes: SessionBinding[];
}

export interface OperatorTimelineResponse {
  items: OperatorTimelineItem[];
}

export interface AgentRuntimeListResponse {
  agents: ActiveAgentRuntimeState[];
}

export interface RunActionResult {
  success: boolean;
  action: 'pause_agent' | 'resume_agent' | 'cancel_run' | 'retry_run';
  targetId: string;
  runId?: string;
  replacementRunId?: string | null;
  message: string;
}
