/**
 * Tool contracts — TypeScript interfaces for tool execution.
 * These contracts mirror the Python models in apps/agent/src/contracts/tool.py
 */

/**
 * Represents a tool call requested by the model.
 */
export interface ToolCall {
  /** The unique identifier or name of the tool to be executed */
  tool_name: string;
  /** The JSON or dictionary payload passed to the tool */
  input: Record<string, unknown>;
}

/**
 * Represents the result of a tool execution.
 */
export interface ToolResult {
  /** The name of the tool that was executed */
  tool_name: string;
  /** The input provided to the tool */
  input: Record<string, unknown>;
  /** The output result from the tool execution */
  output?: unknown;
  /** Any error encountered during tool execution */
  error?: string;
  /** The duration it took the tool to execute in milliseconds */
  duration_ms: number;
  /** Whether the tool was executed in a Docker sandbox */
  sandboxed: boolean;
  /** Source URL if the tool fetched content from a URL */
  source_url?: string | null;
  /** Additional provenance metadata */
  provenance_hint?: Record<string, unknown> | null;
}

/**
 * Describes a tool's capabilities for the planner.
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  capability_tags: string[];
  requires_sandbox: boolean;
  requires_confirmation: boolean;
}

/**
 * Per-tool health status for the /tools/health endpoint.
 */
export interface ToolHealthStatus {
  name: string;
  status: 'ok' | 'degraded' | 'unavailable';
  reason?: string | null;
  last_checked?: string | null;
}

/**
 * Complete tool information including health status.
 * Used for API responses listing tools.
 */
export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  capability_tags: string[];
  requires_confirmation: boolean;
  requires_sandbox: boolean;
  health_status: ToolHealthStatus;
}

/**
 * Result of an MCP gateway connection attempt.
 */
export interface MCPConnectionResult {
  connected: boolean;
  profiles: string[];
  servers: string[];
  error?: string;
}

/**
 * Information about a tool discovered from an MCP server.
 */
export interface MCPToolInfo {
  server_id: string;
  server_name: string;
  tool_name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Provenance record for auditing tool execution.
 * Stores both integrity hashes and human-readable summaries.
 */
export interface ProvenanceRecord {
  trace_id: string;
  tool_name: string;
  input_hash: string;
  output_hash: string;
  input_summary?: string;
  output_summary?: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
  sandbox_used: boolean;
}