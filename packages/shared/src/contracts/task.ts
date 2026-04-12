/**
 * Represents a task request context.
 */
export interface TaskRequest {
  /** The unique workflow id representing this task assignment */
  task_id: string;
  /** The natural language definition of what the task requires */
  definition: string;
}

/**
 * Represents a discrete task execution output.
 */
export interface TaskResult {
  /** The ID of the task that was actioned */
  task_id: string;
  /** The execution workflow trace ID */
  run_id: string;
  /** The terminal status of the task */
  status: 'pending' | 'success' | 'failed';
  /** The actual text output or summary of the task result */
  output: string;
  /** Any system provenance trails backing this task run */
  provenance: string[];
}
