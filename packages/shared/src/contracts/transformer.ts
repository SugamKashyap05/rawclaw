import type { AssistantConfidenceState, AssistantLane } from './assistant';
import type { ChatAttachment, ChatControlState, ChatMessage, ChatNluFrame, DocumentSelection } from './chat';
import type { TaskRunTrigger } from './task';

export type SessionPipelineMode = 'legacy' | 'transform_v1';

export type CanonicalIntent =
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

export type CanonicalLane = 'conversation' | 'research' | 'tasking' | 'memory' | 'advisory';
export type CanonicalConfidenceState = 'direct' | 'inferred' | 'needs_clarification';
export type GroundingMode = 'none' | 'tool_preferred' | 'grounded_required';
export type InvocationSource = 'chat' | 'task';

export type EvidenceStatus = 'success' | 'degraded' | 'failed' | 'skipped';
export type EvidenceQuality = 'strong' | 'medium' | 'weak' | 'unknown';
export type EvidenceSourceType =
  | 'search'
  | 'page_extract'
  | 'browser'
  | 'file'
  | 'code'
  | 'terminal'
  | 'memory'
  | 'model_only';

export type EvidenceDegradationReason =
  | 'weak_search_results'
  | 'placeholder_like_results'
  | 'incomplete_results'
  | 'fallback_used'
  | 'partial_extract'
  | 'irrelevant_extract'
  | 'provider_failure'
  | 'timeout'
  | 'interaction_required'
  | 'truncated'
  | 'unknown';

export type AssistantResponseMode = 'direct' | 'grounded' | 'partial' | 'abstain' | 'error' | 'interrupted';
export type AssistantReviewOutcome = 'approved' | 'revised' | 'rejected' | 'not_reviewed';
export type CoworkerVisibilityState = 'clean' | 'degraded';
export type TransformStageOwner = 'api' | 'agent';
export type RetrievalAxisPolicy = 'forbidden' | 'allowed' | 'required';
export type TransformerFallbackBehavior = 'retry' | 'surface-to-user' | 'log-and-continue' | 'abort-turn';

export interface HumanTurnEnvelope {
  sessionId: string;
  workspaceId?: string | null;
  senderIdentifier?: string | null;
  invocationSource: InvocationSource;
  pipelineMode: SessionPipelineMode;
  latestUserContent: string;
  attachments: ChatAttachment[];
  selection?: DocumentSelection | null;
  chatControls: ChatControlState;
  selectedAgentId?: string | null;
  selectedAgentName?: string | null;
  selectedModel?: string | null;
  requestMessageCount: number;
}

export interface CanonicalIntentFrame {
  intent: CanonicalIntent;
  lane: CanonicalLane;
  confidence: number;
  confidenceState: CanonicalConfidenceState;
  freshnessSensitive: boolean;
  groundingRequired: boolean;
  nluFrame?: ChatNluFrame | null;
}

export interface RetrievalPolicy {
  web: RetrievalAxisPolicy;
  memory: RetrievalAxisPolicy;
}

export interface ExecutionIntent {
  invocationSource: InvocationSource;
  lane: AssistantLane;
  groundingMode: GroundingMode;
  promptPackId?: string | null;
  reviewEnabled: boolean;
  selectedToolNames: string[];
  selectedSkillNames: string[];
  selectedAgentId?: string | null;
  selectedModel?: string | null;
  memoryAccessPolicy: {
    structured: boolean;
    semantic: boolean;
  };
  executionPolicy: {
    stream: boolean;
    allowToolUse: boolean;
  };
  retrievalPolicy?: RetrievalPolicy;
  taskInvocation?: {
    taskId: string;
    runId: string;
    triggeredBy?: TaskRunTrigger;
    resumedFromRunId?: string | null;
  };
}

export interface TransformerErrorBase {
  transformer: 'intake' | 'context' | 'execution' | 'emission' | 'persistence';
  code: string;
  reason: string;
  userFacingMessage: string;
  retryable: boolean;
  fallbackBehavior: TransformerFallbackBehavior;
}

export interface IntakeRejection extends TransformerErrorBase {
  transformer: 'intake';
  rejectedField?: 'latestUserContent' | 'selection' | 'attachment' | 'totalPayload';
}

export interface EmissionFailure extends TransformerErrorBase {
  transformer: 'emission';
  chunkType?: string;
}

export interface PersistenceError extends TransformerErrorBase {
  transformer: 'persistence';
  operation?: 'persist_message' | 'persist_frame' | 'persist_trace' | 'replay_load';
}

export interface ContextCompactionError extends TransformerErrorBase {
  transformer: 'context';
  operation?: 'classify_turns' | 'build_summary' | 'compact_messages';
}

export interface EvidenceEnvelope {
  sourceType: EvidenceSourceType;
  status: EvidenceStatus;
  quality: EvidenceQuality;
  toolName?: string | null;
  title?: string | null;
  url?: string | null;
  sourceLabel?: string | null;
  sourceCount?: number;
  strongestSource?: string | null;
  degradationReasons?: EvidenceDegradationReason[];
}

export interface AssistantResponseEnvelope {
  responseMode: AssistantResponseMode;
  reviewOutcome: AssistantReviewOutcome;
  content: string;
  evidence: EvidenceEnvelope[];
  strongestSource?: string | null;
  memorySignals?: {
    structured: Array<{ summary: string; layer?: string | null }>;
    semantic: Array<{ summary: string; source?: string | null }>;
  };
}

export interface CoworkerActivityFrame {
  visibilityState: CoworkerVisibilityState;
  responseMode: AssistantResponseMode;
  workStory: string;
  lane?: AssistantLane | null;
  confidenceState?: AssistantConfidenceState | null;
  source: {
    agentId?: string | null;
    agentLabel?: string | null;
    modelId?: string | null;
    modelLabel?: string | null;
    isLocal?: boolean;
  };
  evidenceSummary?: {
    total: number;
    degraded: number;
    failed: number;
    strongestSource?: string | null;
    sourceCount?: number;
  };
}

export interface TransformStageTiming {
  stage: string;
  owner: TransformStageOwner;
  durationMs: number;
  fallbackReason?: string | null;
}

/**
 * V1 trace coverage is intentionally narrow on the agent side.
 * Today the agent reports only `model_execution`.
 * Tool/search/fetch/extract/synthesis stage timings are planned for V2.
 */
export const TRANSFORM_TRACE_V1_AGENT_TIMING_STAGES = ['model_execution'] as const;
export const TRANSFORM_TRACE_V2_PLANNED_AGENT_TIMING_STAGES = ['tool', 'search', 'fetch', 'extract', 'synthesis'] as const;

export interface TransformTrace {
  pipelineMode: SessionPipelineMode;
  stageTimings: TransformStageTiming[];
  firstEventLatencyMs?: number;
  fallbackReason?: string | null;
}

export interface SummaryItem {
  text: string;
  sourceTurnIds: string[];
}

export interface ContextSummaryBlock {
  resolvedTopics: SummaryItem[];
  openCommitments: SummaryItem[];
  namedEntities: SummaryItem[];
  unresolvedQuestions: SummaryItem[];
  userPreferences: SummaryItem[];
}

export interface ContextEnvelope {
  messages: Array<{
    id?: string | null;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    name?: string;
    attachments?: ChatMessage['attachments'];
    selection?: ChatMessage['selection'];
    toolResults?: ChatMessage['toolResults'];
    memoryRecall?: boolean;
  }>;
  summary: ContextSummaryBlock;
  totalEstimatedChars: number;
  compacted: boolean;
}

export interface IntakeEnvelope {
  latestUserContent: string;
  selectionText?: string | null;
  attachmentSummaries: Array<{
    filename: string;
    contentChars: number;
    truncated?: boolean;
  }>;
  totalEstimatedChars: number;
  retrievalPolicy: RetrievalPolicy;
}

export interface EmissionEnvelope {
  eventType: string;
  payload: Record<string, unknown>;
}

export interface PersistenceEnvelope {
  persistedContent: string;
  coworkerActivityFrame?: CoworkerActivityFrame | null;
  transformTrace?: TransformTrace | null;
}
