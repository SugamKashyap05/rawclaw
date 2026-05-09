import { Injectable } from '@nestjs/common';
import {
  AssistantConfidenceState,
  AssistantLane,
  ChatContextBudget,
  ChatNluFrame,
  CoworkerActivityFrame,
  MemoryEvent,
  PersistenceError,
  ReviewEvent,
  SessionPipelineMode,
  ToolResult,
  TransformStageTiming,
  TransformTrace,
  WorkflowState,
} from '@rawclaw/shared';
import { ChatService } from './chat.service';
import { ChatTransformerService } from './chat-transformer.service';

type PersistAssistantTurnInput = {
  sessionId: string;
  content: string;
  assistantLane: AssistantLane;
  confidenceState: AssistantConfidenceState;
  toolCalls?: any[];
  toolResults?: ToolResult[];
  provenance?: any;
  runIds?: string[];
  citations?: Array<{ url: string; title?: string }>;
  reviewEvents?: Array<{ approved?: boolean; feedback?: string; reviewer_id?: string }>;
  lastMetadata?: Record<string, unknown> | null;
  turnId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  modelId?: string | null;
  promptProvenance: {
    promptPackId?: string | null;
    promptVersionHash?: string | null;
    reviewerPromptVersionHash?: string | null;
    workflowPromptIds?: string[] | null;
  };
  memoryEvents?: MemoryEvent[];
  advisoryEvents?: any[];
  contextBudget?: ChatContextBudget | null;
  nluFrame?: ChatNluFrame | null;
  conversationSafety?: any;
  retrievalPolicy?: WorkflowState['retrievalPolicy'];
  streamStatus: 'completed' | 'incomplete' | 'failed';
  errorPayload?: { type: string; message: string } | null;
  pipelineMode: SessionPipelineMode;
  apiStageTimings?: TransformStageTiming[];
  agentStageTimings?: TransformStageTiming[];
  firstEventLatencyMs?: number;
  transformerFallbackReason?: string | null;
};

type PersistAssistantTurnResult = {
  coworkerActivityFrame?: CoworkerActivityFrame;
  transformTrace?: TransformTrace;
  workflowState: WorkflowState;
};

@Injectable()
export class PersistenceTransformerService {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatTransformerService: ChatTransformerService,
  ) {}

  async persistAssistantTurn(input: PersistAssistantTurnInput): Promise<PersistAssistantTurnResult> {
    const reviewEvents = (input.reviewEvents || []).map((event) => ({
      approved: event.approved,
      feedback: event.feedback,
      reviewerId: event.reviewer_id,
    })) as ReviewEvent[];

    let coworkerActivityFrame: CoworkerActivityFrame | undefined;
    let transformTrace: TransformTrace | undefined;
    if (input.pipelineMode === 'transform_v1') {
      const responseEnvelope = this.chatTransformerService.buildAssistantResponseEnvelope({
        content: input.content,
        assistantLane: input.assistantLane,
        evidence: this.chatTransformerService.buildEvidenceEnvelopes(input.toolResults || []),
        reviewEvents,
        errorType: input.errorPayload?.type || null,
        transportInterrupted: input.streamStatus === 'incomplete',
        memoryEvents: input.memoryEvents || [],
      });

      coworkerActivityFrame = this.chatTransformerService.buildCoworkerActivityFrame({
        response: responseEnvelope,
        agentId: input.agentId,
        agentName: input.agentName,
        modelId: input.modelId,
        isLocal: Boolean(input.lastMetadata?.isLocal),
        lane: input.assistantLane,
        confidenceState: input.confidenceState,
        fallbackReason: input.transformerFallbackReason || null,
      });
      transformTrace = this.chatTransformerService.buildTransformTrace(
        input.pipelineMode,
        this.chatTransformerService.mergeStageTimings(input.apiStageTimings || [], input.agentStageTimings || []),
        {
          firstEventLatencyMs: input.firstEventLatencyMs,
          fallbackReason: input.transformerFallbackReason || null,
        },
      );
    }

    const workflowState: WorkflowState = {
      promptPackId: input.promptProvenance.promptPackId || undefined,
      promptVersionHash: input.promptProvenance.promptVersionHash || undefined,
      reviewerPromptVersionHash: input.promptProvenance.reviewerPromptVersionHash || undefined,
      workflowPromptIds: input.promptProvenance.workflowPromptIds || undefined,
      reviewEnabled: reviewEvents.length > 0,
      runIds: input.runIds || undefined,
      assistantLane: input.assistantLane,
      confidenceState: input.confidenceState,
      nlu: input.nluFrame || undefined,
      contextBudget: input.contextBudget || null,
      conversationSafety: input.conversationSafety || null,
      retrievalPolicy: input.retrievalPolicy || null,
    };

    try {
      await this.chatService.createMessage(
        input.sessionId,
        'assistant',
        input.content,
        {
          toolCalls: input.toolCalls?.length ? input.toolCalls : undefined,
          toolResults: input.toolResults?.length ? input.toolResults : undefined,
          provenance: input.provenance || undefined,
          runIds: input.runIds || undefined,
          citations: input.citations?.length ? input.citations : undefined,
          reviewEvents,
          ...(input.lastMetadata || {}),
          turnId: input.turnId || undefined,
          agentId: input.agentId || undefined,
          promptPackId: input.promptProvenance.promptPackId || undefined,
          promptVersionHash: input.promptProvenance.promptVersionHash || undefined,
          reviewerPromptVersionHash: input.promptProvenance.reviewerPromptVersionHash || undefined,
          workflowPromptIds: input.promptProvenance.workflowPromptIds || undefined,
          memoryEvents: input.memoryEvents?.length ? input.memoryEvents : undefined,
          advisoryEvents: input.advisoryEvents?.length ? input.advisoryEvents : undefined,
          coworkerActivityFrame,
          transformTrace,
          streamStatus: input.streamStatus,
          workflowState,
          ...(input.errorPayload ? { error: input.errorPayload } : {}),
        },
      );
    } catch (error: any) {
      throw this.buildPersistenceError(error?.message || String(error), true);
    }

    return {
      coworkerActivityFrame,
      transformTrace,
      workflowState,
    };
  }

  buildReplayFrame(input: {
    content: string;
    toolResults?: ToolResult[];
    agentId?: string | null;
    agentName?: string | null;
    modelId?: string | null;
    isLocal?: boolean;
    streamStatus?: 'completed' | 'incomplete' | 'failed';
    errorType?: string | null;
    assistantLane?: AssistantLane | null;
    confidenceState?: AssistantConfidenceState | null;
  }): CoworkerActivityFrame {
    return this.chatTransformerService.buildFallbackActivityFrame({
      content: input.content,
      toolResults: input.toolResults || [],
      agentId: input.agentId || null,
      agentName: input.agentName || null,
      modelId: input.modelId || null,
      isLocal: input.isLocal,
      streamStatus: input.streamStatus || 'completed',
      errorType: input.errorType || null,
      assistantLane: input.assistantLane || 'conversation',
      confidenceState: input.confidenceState || null,
    });
  }

  buildPersistenceError(reason: string, retryable: boolean): PersistenceError {
    return {
      transformer: 'persistence',
      code: retryable ? 'persist_retryable_failure' : 'persist_failure',
      reason,
      userFacingMessage: 'I could not fully save that turn for replay, but the visible response was left unchanged.',
      retryable,
      fallbackBehavior: 'log-and-continue',
      operation: 'persist_message',
    };
  }
}
