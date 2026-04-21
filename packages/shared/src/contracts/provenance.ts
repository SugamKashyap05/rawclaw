export interface ProvenanceSummary {
  hasTools: boolean;
  hasDocuments: boolean;
  hasTaskRun: boolean;
  mainSource: 'model' | 'tool' | 'document';
  brief: string; // "Synthesized final answer from extracted PDF text..."
  lastAction: string; // "Completed Web Search" or "Encountered Error"
}

export interface ProvenanceTrace {
  runId: string;
  summary?: ProvenanceSummary;
  runIds?: string[];
  steps: ProvenanceStep[];
  stepCount?: number;
  createdAt?: string;
}

export interface ProvenanceStep {
  stepIndex: number;
  stepType: 'plan' | 'tool_call' | 'tool_result' | 'synthesis' | 'error' | 'review';
  toolName?: string | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
  sourceUrl?: string | null;
  durationMs: number;
  sandboxed: boolean;
  timestamp: string;
}
