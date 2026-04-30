import { ToolCall, ToolResult } from './tool';
import { ProvenanceTrace, ProvenanceStep } from './provenance';
import { AssistantConfidenceState, AssistantLane } from './assistant';
import { GatewayRoutingContext } from './gateway';

export interface Citation {
  url: string;
  title?: string;
}

export type PreferredWebMode = 'auto' | 'search' | 'read_page' | 'browser';
export type ToolUseMode = 'auto' | 'limited' | 'manual';
export type PermissionMode = 'ask_every_time' | 'allow_safe_tools' | 'workspace_default';

export interface ChatControlState {
  planMode?: boolean;
  preferredWebMode?: PreferredWebMode;
  toolUseMode?: ToolUseMode;
  permissionMode?: PermissionMode;
  selectedPlugins?: string[];
  selectedTools?: string[];
}

export interface DocumentSelection {
  documentId: string;
  text: string;
  contextBefore: string;
  contextAfter: string;
  startOffset?: number;
  endOffset?: number;
}

export type DocumentEditAction = 'rewrite' | 'improve' | 'shorten' | 'formalize';

export interface DocumentEditRequest {
  documentId: string;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  startOffset?: number;
  endOffset?: number;
  action: DocumentEditAction;
  instruction?: string;
}

export interface GatewayAgentProfileSnapshot {
  id: string;
  name: string;
  workspace_id: string;
  workspace_path: string;
  default_model?: string;
  allowed_tools: string[];
  memory_scope: string;
  prompt_files: string[];
  research_defaults: Record<string, any>;
  active: boolean;
}

export interface GatewayContextPayload {
  resolved_agent_profile?: GatewayAgentProfileSnapshot;
  workspace_path?: string;
  memory_scope?: string;
  routing_binding?: GatewayRoutingContext;
}

export interface ChatAttachment {
  filename: string;
  type?: string;
  size?: number;
  content: string;
  /** Link to stable persistence if extracted */
  documentId?: string;
  /** Primary byte size of the file before any extraction/truncation */
  originalSize?: number;
  /** Set to true if the content was truncated to fit context limits */
  isTruncated?: boolean;
  /** Set if extraction failed, so UI can show a clear error */
  extractionError?: string;
  /** Explicit flag for extraction failure */
  extractionFailed?: boolean;
  /** The text resulting from extraction (duplicated here for immediate context budgeting) */
  extractedText?: string;
}

export interface ReviewEvent {
  approved?: boolean;
  feedback?: string;
  reviewerId?: string;
}

export interface MemoryEvent {
  layer: 'session' | 'operator' | 'mission';
  action: 'captured' | 'updated' | 'recalled';
  summary: string;
  entryId?: string;
}

export interface AdvisoryEvent {
  category: 'next_step' | 'follow_up' | 'reminder' | 'blocker' | 'briefing';
  summary: string;
  actionState: 'suggested' | 'queued' | 'executed';
}

export interface WorkflowState {
  promptPackId?: string;
  promptVersionHash?: string;
  reviewerPromptVersionHash?: string;
  workflowPromptIds?: string[];
  reviewEnabled?: boolean;
  runIds?: string[];
  assistantLane?: AssistantLane;
  confidenceState?: AssistantConfidenceState;
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
  /** Active selection context for this message turn */
  selection?: DocumentSelection;
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
  promptPackId?: string;
  promptVersionHash?: string;
  reviewerPromptVersionHash?: string;
  workflowPromptIds?: string[];
  runIds?: string[];
  reviewEvents?: ReviewEvent[];
  workflowState?: WorkflowState;
  memoryEvents?: MemoryEvent[];
  advisoryEvents?: AdvisoryEvent[];
  /** Parsed edit suggestion containing originalText, suggestedText, action */
  editSuggestion?: {
    originalText: string;
    suggestedText: string;
    action: DocumentEditAction;
  };
}

export type ChatComplexity = 'low' | 'medium' | 'high';

/**
 * Request payload for initiating a chat completion.
 */
export interface ChatRequest {
  /** The caller-provided session identifier. For routed surfaces, this is advisory and may be remapped by the gateway. */
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
  /** Optional surface key for control-plane routing */
  surfaceType?: string;
  /** Optional thread key for durable routing */
  threadKey?: string;
  /** Optional channel key for durable routing */
  channelKey?: string;
  /** Optional secondary agent to review output before finalizing */
  output_reviewer_id?: string;
  /** Resolved prompt templates for reviewer/repair runtime helpers */
  promptTemplates?: {
    reviewer?: string;
    repair?: string;
  };
  /** Prompt provenance attached by the API orchestration layer */
  promptProvenance?: {
    promptPackId?: string;
    promptVersionHash?: string;
    reviewerPromptVersionHash?: string;
    workflowPromptIds?: string[];
    assistantLane?: AssistantLane;
  };
  /** Runtime gateway routing context resolved by the API or another caller */
  gateway_context?: GatewayContextPayload;
  // P2 Parameters
  temperature?: number;
  top_p?: number;
  /** Active selection context for the current turn */
  selection?: DocumentSelection;
  /** Direct edit request forcing the backend to issue a specific edit intent */
  editRequest?: DocumentEditRequest;
  /** Codex-style per-chat controls selected in the composer */
  planMode?: boolean;
  preferredWebMode?: PreferredWebMode;
  toolUseMode?: ToolUseMode;
  permissionMode?: PermissionMode;
  selectedPlugins?: string[];
  selectedTools?: string[];
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
  provenanceTrace?: ProvenanceTrace | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  context_window?: number;
}

export type ChatStreamChunkType = 'content' | 'thinking' | 'tool_call' | 'tool_result' | 'sources' | 'error' | 'done' | 'provenance' | 'metadata' | 'review_result' | 'harness' | 'approval_required';

export interface ChatStreamChunk {
  type: ChatStreamChunkType;
  content?: string;
  thinking?: string;
  tool_call?: ToolCall;
  tool_result?: ToolResult;
  sources?: string[];
  provenance?: ProvenanceTrace | null;
  provenanceTrace?: ProvenanceTrace | null;
  error?: string;
  harness_log?: {
    tool: string;
    step: 'preparing' | 'executing' | 'finalizing';
    message?: string;
  };
  reason?: string;
  metadata?: {
    modelId: string;
    isLocal: boolean;
    fallbacks?: string[];
    memoryRecall: boolean;
    durationMs?: number;
    runIds?: string[];
    isDeepResearch?: boolean;
  };
}

export type ChatErrorType = 
  | 'agent_error'
  | 'agent_unavailable'
  | 'provider_routing_failed'
  | 'provider_offline'
  | 'request_too_large'
  | 'context_limit_exceeded'
  | 'auth_failure'
  | 'stream_interrupted'
  | 'unsupported_file_type';

export interface DocumentPayload {
  id: string;
  filename: string;
  mimeType: string;
  extractedText: string;
  extractionMethod: string;
  createdAt: string | Date;
  updatedAt?: string | Date;
  metadata?: any;
}
