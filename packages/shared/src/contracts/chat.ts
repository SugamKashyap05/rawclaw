import { ToolCall, ToolResult } from './tool';
import { ProvenanceTrace } from './provenance';
import { AssistantConfidenceState, AssistantLane } from './assistant';
import { GatewayRoutingContext } from './gateway';
import type {
  CoworkerActivityFrame,
  ExecutionIntent,
  RetrievalPolicy,
  TransformStageTiming,
  TransformTrace,
} from './transformer';

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

export type ChatNluIntent =
  | 'conversation'
  | 'research'
  | 'memory_capture'
  | 'memory_query'
  | 'task_create'
  | 'advisory'
  | 'code_help'
  | 'troubleshooting'
  | 'edit_request'
  | 'tool_request'
  | 'settings_control'
  | 'clarification_needed'
  | 'unknown';

export type ChatNluFrameSource = 'deterministic' | 'semantic' | 'model' | 'override' | 'legacy_fallback' | 'timeout_fallback';
export type ChatNluConfidenceState = 'direct' | 'inferred' | 'needs_clarification';
export type ChatNluMemoryScope = 'session' | 'operator' | 'mission' | 'recent' | 'all';

export type ChatNluRoutingFallbackReason =
  | 'nlu_timeout'
  | 'research_followup'
  | 'tool_metadata_unavailable'
  | 'tool_unavailable'
  | 'invalid_nlu_override'
  | 'clarification_expired'
  | 'schema_unknown'
  | 'selected_agent_unavailable'
  | 'lane_unavailable'
  | 'low_confidence'
  | 'clarification_failed';

export type ChatNluEntityType =
  | 'url'
  | 'file_path'
  | 'date_time'
  | 'person'
  | 'tool_name'
  | 'model_name'
  | 'task_text'
  | 'memory_fact'
  | 'setting_key'
  | 'selection_ref'
  | 'attachment_ref';

export interface ChatNluEntity {
  type: ChatNluEntityType;
  value: string;
  normalizedValue?: string;
  confidence: number;
  span?: [number, number];
  source: ChatNluFrameSource;
}

export interface ChatNluRecommendedTool {
  name: string;
  type: 'native' | 'mcp' | 'skill';
  confidence: number;
  reason:
    | 'matched tool name'
    | 'matched MCP server'
    | 'matched research intent'
    | 'matched selected skill'
    | 'matched explicit chat control';
  serverId?: string;
  serverDisplayName?: string;
  mayRequireConfirmation?: boolean;
}

export interface ChatNluFrame {
  schemaVersion: 1;
  intent: ChatNluIntent;
  secondaryIntents?: Array<{ intent: ChatNluIntent; confidence: number; reason?: string }>;
  recommendedLane: AssistantLane;
  confidence: number;
  confidenceState: ChatNluConfidenceState;
  source: ChatNluFrameSource;
  entities: ChatNluEntity[];
  recommendedTools?: ChatNluRecommendedTool[];
  memoryScopes?: {
    capture?: ChatNluMemoryScope;
    query?: ChatNluMemoryScope;
  };
  routingFallbackReason?: ChatNluRoutingFallbackReason;
  clarificationQuestion?: string;
  clarificationFailed?: boolean;
  overrideApplied?: boolean;
  notes?: string[];
}

export interface ChatNluOverride {
  intent: ChatNluIntent | string;
}

export interface PendingNluClarification {
  id: string;
  originalUserContent: string;
  clarifyingQuestion: string;
  candidateFrame: ChatNluFrame;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatNluPendingClarificationUpdate {
  action: 'set' | 'clear' | 'increment';
  state?: PendingNluClarification;
  expectedUpdatedAt?: string | null;
}

export interface ChatNluClarificationUpdateResult {
  applied: boolean;
  reason?: 'stale' | 'missing_session' | 'empty_update';
}

export interface ChatNluAnalyzeResult {
  frame: ChatNluFrame;
  pendingClarificationUpdate?: ChatNluPendingClarificationUpdate;
}

export interface ChatNluAvailableTool {
  name: string;
  description?: string;
  type: 'native' | 'mcp' | 'skill';
  capabilityTags?: string[];
  serverId?: string;
  serverDisplayName?: string;
}

export interface ChatNluAnalyzeInput {
  sessionId: string;
  latestUserContent: string;
  chatControlsSubset: Pick<ChatControlState, 'preferredWebMode' | 'toolUseMode' | 'selectedTools' | 'selectedPlugins'>;
  selectedAgent: { id?: string; name?: string | null; skills?: string[] } | null;
  availableTools: ChatNluAvailableTool[];
  attachments: ChatAttachment[];
  selection: DocumentSelection | null;
  assistantStateSummary: string;
  pendingClarification: PendingNluClarification | null;
  nluOverride?: ChatNluOverride | null;
  previousAssistantNlu?: ChatNluFrame | null;
}

export interface ChatContextBudget {
  systemPromptChars: number;
  messageHistoryChars: number;
  toolDefinitionChars: number;
  otherChars: number;
  totalEstimatedChars: number;
}

export interface AdvisoryEvent {
  category: 'next_step' | 'follow_up' | 'reminder' | 'blocker' | 'briefing';
  summary: string;
  actionState: 'suggested' | 'queued' | 'executed';
}

export interface ConversationSafetySignal {
  confabulatedMemoryCandidate: boolean;
  reasons: Array<'external_retrieval_on_direct_turn' | 'memory_claim_without_recall'>;
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
  nlu?: ChatNluFrame;
  contextBudget?: ChatContextBudget | null;
  conversationSafety?: ConversationSafetySignal | null;
  retrievalPolicy?: RetrievalPolicy | null;
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
  turnId?: string;
  isLocal?: boolean;
  fallbacks?: string[];
  memoryRecall?: boolean;
  agentId?: string;
  streamStatus?: 'completed' | 'incomplete' | 'failed';
  error?: {
    type: string;
    message: string;
    details?: string;
  };
  // P2 Metadata
  createdAt?: Date | string;
  branchId?: string | null;
  parentMessageId?: string | null;
  branchSequence?: number | null;
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
  coworkerActivityFrame?: CoworkerActivityFrame;
  transformTrace?: TransformTrace;
  /** Parsed edit suggestion containing originalText, suggestedText, action */
  editSuggestion?: {
    originalText: string;
    suggestedText: string;
    action: DocumentEditAction;
  };
}

export type ChatComplexity = 'low' | 'medium' | 'high';

/**
 * TurnTrace — the single identifier that links one user request
 * across the full API → agent → worker execution path.
 * Every log line, every SSE event, every queue message that belongs
 * to a turn MUST carry this trace ID.
 */
export interface TurnTrace {
  turn_id: string;          // UUID v4, generated by the API at request entry
  session_id: string;       // the session this turn belongs to
  request_ts: string;       // ISO timestamp when the request entered the API
  model_requested?: string; // model resolved at routing time
  tools_selected?: number;  // count of tools selected for this turn
  research_mode?: boolean;  // whether the research pipeline was invoked
}

export function makeTurnTrace(sessionId: string, overrides?: Partial<TurnTrace>): TurnTrace {
  return {
    turn_id: crypto.randomUUID(),
    session_id: sessionId,
    request_ts: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Request payload for initiating a chat completion.
 */
export interface ChatRequest {
  /** The caller-provided session identifier. For routed surfaces, this is advisory and may be remapped by the gateway. */
  session_id: string;
  /** Turn trace identifier used for end-to-end correlation across API, agent, and workers. */
  turn_id?: string;
  /** Optional request correlation identifier. The API generates one when callers omit it. */
  correlationId?: string;
  /** Snake-case variant forwarded to the Python agent. */
  correlation_id?: string;
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
  /** Normalized execution intent attached by the orchestration layer for downstream enforcement. */
  executionIntent?: ExecutionIntent;
  /** Optional prompt-pack override for internal surfaces such as App Builder. */
  promptPackId?: string;
  /** Optional system-level overlay appended for internal surfaces. */
  promptOverlay?: string | null;
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
  nluOverride?: ChatNluOverride | null;
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

export type ChatStreamChunkType =
  | 'content'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'sources'
  | 'error'
  | 'done'
  | 'provenance'
  | 'metadata'
  | 'review_result'
  | 'harness'
  | 'approval_required'
  | 'activity_frame'
  | 'heartbeat';

export interface ChatStreamChunk {
  type: ChatStreamChunkType;
  correlationId?: string;
  content?: string;
  thinking?: string;
  tool_call?: ToolCall;
  tool_result?: ToolResult;
  sources?: string[];
  provenance?: ProvenanceTrace | null;
  provenanceTrace?: ProvenanceTrace | null;
  error?: string;
  message?: string;
  harness_log?: {
    tool: string;
    step: 'preparing' | 'executing' | 'finalizing';
    message?: string;
  };
  approved?: boolean;
  feedback?: string;
  reviewer_id?: string;
  reason?: string;
  ts?: number;
  timestamp?: string;
  metadata?: {
    modelId: string;
    isLocal: boolean;
    fallbacks?: string[];
    memoryRecall: boolean;
    durationMs?: number;
    runIds?: string[];
    isDeepResearch?: boolean;
    nlu?: ChatNluFrame;
    contextBudget?: ChatContextBudget | null;
    transformStageTimings?: TransformStageTiming[];
    correlationId?: string;
  };
  activityFrame?: CoworkerActivityFrame;
}

export type ChatErrorType = 
  | 'agent_error'
  | 'agent_unavailable'
  | 'stream_failed'
  | 'provider_routing_failed'
  | 'provider_offline'
  | 'request_too_large'
  | 'context_limit_exceeded'
  | 'auth_failure'
  | 'stream_interrupted'
  | 'stream_timeout'
  | 'execution_timeout'
  | 'turn_limit_reached'
  | 'sequential_thinking_limit_reached'
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
