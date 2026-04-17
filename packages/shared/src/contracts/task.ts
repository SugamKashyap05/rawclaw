import { ProvenanceTrace } from './provenance';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  name: string;
  description: string;
  agentId?: string;
  toolIds: string[];
  schedule?: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  lastRunStatus?: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
}

export interface TaskRun {
  id: string;
  taskId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt?: string;
  finishedAt?: string;
  selectedAgent?: string;
  outputPath?: string;
  provenance?: ProvenanceTrace;
  errorMessage?: string;
  createdAt: string;
  steps: RunStep[];
  task?: Task;
}

export interface RunStep {
  id: string;
  runId: string;
  stepIndex: number;
  stepType: 'plan' | 'tool_call' | 'tool_result' | 'synthesis' | 'error';
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
  sourceUrl?: string;
  durationMs?: number;
  sandboxed: boolean;
  timestamp: string;
}

export interface AgentTaskDefinition {
  id: string;
  name: string;
  description: string;
  cronExpression?: string;
  prompt: string;
  model?: string;
  tools?: string[];
  maxIterations?: number;
  timeoutSeconds?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskExecutionRequest {
  taskId: string;
  runId: string;
  prompt: string;
  model?: string;
  tools?: string[];
  maxIterations?: number;
  timeoutSeconds?: number;
  context?: Record<string, unknown>;
}

export interface TaskRunLog {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  runId: string;
  status: TaskStatus;
  output?: string;
  artifactPath?: string;
  logs: TaskRunLog[];
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
  };
}

export interface TaskExecution {
  id: string;
  taskId: string;
  status: TaskStatus;
  startedAt: string;
  completedAt?: string;
  result?: TaskResult;
  triggeredBy: 'manual' | 'cron' | 'webhook';
}
