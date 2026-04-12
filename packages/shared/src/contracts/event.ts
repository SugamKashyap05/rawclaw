import { ToolCall, ToolResult } from './tool';

/**
 * Represents streams or discrete events pushed by the agent execution layer.
 */
export type AgentEvent =
  | { type: 'message_delta'; content: string }
  | { type: 'tool_start'; tool: ToolCall }
  | { type: 'tool_confirmation_needed'; confirmation_id: string; tool_name: string; tool_input: Record<string, any> }
  | { type: 'tool_end'; result: ToolResult }
  | { type: 'task_complete'; output: string }
  | { type: 'error'; message: string };

