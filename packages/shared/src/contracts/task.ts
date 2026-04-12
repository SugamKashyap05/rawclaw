import { ProvenanceTrace } from './provenance';

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
