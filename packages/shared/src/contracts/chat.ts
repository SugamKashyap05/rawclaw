import { ToolCall, ToolResult } from './tool';
import { ProvenanceTrace, ProvenanceStep } from './provenance';

export interface Citation {
  url: string;
  title?: string;
}

export interface ChatAttachment {
  filename: string;
  type?: string;
  size?: number;
  content: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  toolResults?: ToolResult[];
  provenanceTrace?: ProvenanceTrace;
  citations?: Citation[];
  attachments?: ChatAttachment[];
  // P1 Metadata
  modelId?: string;
  isLocal?: boolean;
  fallbacks?: string[];
  memoryRecall?: boolean;
  agentId?: string;
  error?: {
    type: string;
    message: string;
    details?: string;
  };
  // P2 Metadata
  createdAt?: Date | string;
  durationMs?: number;
}

export type ChatComplexity = 'low' | 'medium' | 'high';

/**
 * Request payload for initiating a chat completion.
 */
export interface ChatRequest {
  /** The unique session identifier for storing conversational context */
  session_id: string;
  /** The array of messages forming the latest conversation context */
  messages: ChatMessage[];
  /** The requested model override path (e.g., 'gpt-4', 'ollama/llama3') */
  model?: string;
  /** Complexity hint for automatic model routing */
  complexity?: ChatComplexity;
  /** The array of requested tools enabled for this chat turn */
  tools?: string[];
  /** Whether to stream the response */
  stream?: boolean;
  /** Workspace identifier for multi-surface scoping */
  workspace_id?: string;
  /** Identity of the sender surface (e.g., 'web', 'desktop', 'api') */
  sender_identifier?: string;
  /** Optional selected agent profile to apply additional system instructions */
  agent_id?: string;
  // P2 Parameters
  temperature?: number;
  top_p?: number;
}

/**
 * Response payload mapping the result of a chat execution.
 */
export interface ChatResponse {
  /** The returned final response content from the agent */
  response: string;
  /** Output sequence of tool calls executed during the turn */
  tool_calls: ToolCall[];
  /** Document sources/URLs that contributed to the generated response */
  sources: string[];
  /** Provenance trace for auditing tool execution */
  provenance_trace?: {
    run_id: string;
    steps: ProvenanceStep[];
    step_count: number;
    created_at: string;
  } | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  context_window?: number;
}

export type ChatStreamChunkType = 'content' | 'tool_call' | 'tool_result' | 'sources' | 'error' | 'done' | 'provenance' | 'metadata';

export interface ChatStreamChunk {
  type: ChatStreamChunkType;
  content?: string;
  tool_call?: ToolCall;
  tool_result?: ToolResult;
  sources?: string[];
  provenance_trace?: {
    run_id: string;
    steps: ProvenanceStep[];
    step_count: number;
    created_at: string;
  } | null;
  error?: string;
  metadata?: {
    modelId: string;
    isLocal: boolean;
    fallbacks?: string[];
    memoryRecall: boolean;
    durationMs?: number;
  };
}
