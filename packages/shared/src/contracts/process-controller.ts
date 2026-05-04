export type HarnessRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'superseded' | 'stale';
export type HarnessProcessStatus = 'queued' | 'running' | 'passed' | 'failed' | 'timed_out' | 'cancelled' | 'superseded';

export interface HarnessProcessRecord {
  id: string;
  runId: string;
  name: string;
  suiteKey?: string | null;
  status: HarnessProcessStatus;
  command: string[];
  pid?: number | null;
  outputLog?: string | null;
  metadata?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  artifacts: string[];
  startedAt: string;
  heartbeatAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessRunRecord {
  id: string;
  name: string;
  kind: string;
  status: HarnessRunStatus;
  modelId?: string | null;
  workspace?: string | null;
  metadata?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  artifacts: string[];
  startedAt: string;
  heartbeatAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  processes?: HarnessProcessRecord[];
}

export interface StartHarnessRunRequest {
  name: string;
  kind?: string;
  modelId?: string;
  workspace?: string;
  metadata?: Record<string, unknown>;
}

export interface StartHarnessProcessRequest {
  name: string;
  suiteKey?: string;
  command: string[];
  pid?: number;
  metadata?: Record<string, unknown>;
}

export interface CompleteHarnessProcessRequest {
  status: HarnessProcessStatus;
  durationSeconds?: number;
  outputLog?: string;
  summary?: Record<string, unknown>;
  artifacts?: string[];
  metadata?: Record<string, unknown>;
}

export interface CompleteHarnessRunRequest {
  status: HarnessRunStatus;
  summary?: Record<string, unknown>;
  artifacts?: string[];
  metadata?: Record<string, unknown>;
}
