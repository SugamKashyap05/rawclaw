export interface ProvenanceTrace {
  run_id: string;
  steps: ProvenanceStep[];
}

export interface ProvenanceStep {
  step_index: number;
  step_type: 'plan' | 'tool_call' | 'tool_result' | 'synthesis' | 'error';
  tool_name?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  source_url?: string | null;
  duration_ms: number;
  sandboxed: boolean;
  timestamp: string;
}
