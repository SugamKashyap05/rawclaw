import { Injectable } from '@nestjs/common';
import {
  AssistantConfidenceState,
  AssistantLane,
  AssistantResponseEnvelope,
  AssistantResponseMode,
  AssistantReviewOutcome,
  CanonicalIntentFrame,
  ChatAttachment,
  ChatControlState,
  ChatMessage,
  ChatNluFrame,
  CoworkerActivityFrame,
  DocumentSelection,
  EvidenceDegradationReason,
  EvidenceEnvelope,
  EvidenceQuality,
  EvidenceSourceType,
  EvidenceStatus,
  ExecutionIntent,
  GroundingMode,
  HumanTurnEnvelope,
  InvocationSource,
  MemoryEvent,
  RetrievalPolicy,
  TransformStageTiming,
  TransformTrace,
  SessionPipelineMode,
  ToolResult,
  COWORKER_WORK_STORY_TEMPLATES,
  modelShortName as sharedModelShortName,
  resolveAgentDisplayLabel as sharedResolveAgentDisplayLabel,
} from '@rawclaw/shared';

type BuildHumanTurnInput = {
  sessionId: string;
  workspaceId?: string | null;
  senderIdentifier?: string | null;
  pipelineMode: SessionPipelineMode;
  latestUserContent: string;
  attachments: ChatAttachment[];
  selection?: DocumentSelection | null;
  chatControls: ChatControlState;
  selectedAgentId?: string | null;
  selectedAgentName?: string | null;
  selectedModel?: string | null;
  requestMessageCount: number;
};

type BuildExecutionIntentInput = {
  lane: AssistantLane;
  latestUserContent: string;
  reviewEnabled: boolean;
  promptPackId?: string | null;
  selectedAgentId?: string | null;
  selectedModel?: string | null;
  toolsSchema?: any[] | undefined;
  retrievalPolicy?: RetrievalPolicy;
};

type BuildAssistantResponseInput = {
  content: string;
  assistantLane: AssistantLane;
  evidence: EvidenceEnvelope[];
  reviewEvents?: Array<{ approved?: boolean; feedback?: string }>;
  errorType?: string | null;
  transportInterrupted?: boolean;
  memoryEvents?: MemoryEvent[];
};

type BuildActivityFrameInput = {
  response: AssistantResponseEnvelope;
  agentId?: string | null;
  agentName?: string | null;
  modelId?: string | null;
  isLocal?: boolean;
  lane?: AssistantLane | null;
  confidenceState?: AssistantConfidenceState | null;
  fallbackReason?: string | null;
};

const FRESHNESS_MARKERS = [
  'latest',
  'current',
  'today',
  'yesterday',
  'tomorrow',
  'news',
  'results',
  'who won',
  'winner',
  'seat tally',
];

@Injectable()
export class ChatTransformerService {
  isEnabledByFlag(): boolean {
    return String(process.env.RAWCLAW_TRANSFORM_PIPELINE_V1 || '').toLowerCase() === 'true';
  }

  buildHumanTurnEnvelope(input: BuildHumanTurnInput): HumanTurnEnvelope {
    return {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      senderIdentifier: input.senderIdentifier,
      invocationSource: 'chat',
      pipelineMode: input.pipelineMode,
      latestUserContent: input.latestUserContent,
      attachments: input.attachments || [],
      selection: input.selection || null,
      chatControls: input.chatControls,
      selectedAgentId: input.selectedAgentId,
      selectedAgentName: input.selectedAgentName,
      selectedModel: input.selectedModel,
      requestMessageCount: input.requestMessageCount,
    };
  }

  buildCanonicalIntentFrame(nluFrame: ChatNluFrame | null, latestUserContent: string): CanonicalIntentFrame {
    const normalized = (latestUserContent || '').toLowerCase();
    const freshnessSensitive = FRESHNESS_MARKERS.some((marker) => normalized.includes(marker));
    const groundingRequired = (nluFrame?.recommendedLane || 'conversation') === 'research' || freshnessSensitive;
    return {
      intent: (nluFrame?.intent || 'unknown') as CanonicalIntentFrame['intent'],
      lane: this.toCanonicalLane(nluFrame?.recommendedLane),
      confidence: nluFrame?.confidence ?? 0,
      confidenceState: (nluFrame?.confidenceState || 'inferred') as CanonicalIntentFrame['confidenceState'],
      freshnessSensitive,
      groundingRequired,
      nluFrame,
    };
  }

  buildExecutionIntent(input: BuildExecutionIntentInput): ExecutionIntent {
    const selectedToolNames = (input.toolsSchema || [])
      .map((tool: any) => tool?.function?.name)
      .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0);
    const selectedSkillNames = selectedToolNames
      .filter((name) => name.startsWith('skill_'))
      .map((name) => name.replace(/^skill_/, ''));
    return {
      invocationSource: 'chat',
      lane: input.lane,
      groundingMode: this.resolveGroundingMode(input.lane, selectedToolNames, input.latestUserContent),
      promptPackId: input.promptPackId,
      reviewEnabled: input.reviewEnabled,
      selectedToolNames,
      selectedSkillNames,
      selectedAgentId: input.selectedAgentId,
      selectedModel: input.selectedModel,
      memoryAccessPolicy: {
        structured: true,
        semantic: true,
      },
      executionPolicy: {
        stream: true,
        allowToolUse: selectedToolNames.length > 0,
      },
      retrievalPolicy: input.retrievalPolicy,
    };
  }

  buildEvidenceEnvelopes(toolResults: ToolResult[] = []): EvidenceEnvelope[] {
    return toolResults.map((result) => this.buildEvidenceEnvelope(result));
  }

  buildAssistantResponseEnvelope(input: BuildAssistantResponseInput): AssistantResponseEnvelope {
    const reviewOutcome = this.deriveReviewOutcome(input.reviewEvents);
    const strongestSource = this.resolveStrongestSource(input.evidence);
    const baseMode = this.deriveBaseResponseMode(input.content, input.assistantLane, input.evidence, input.errorType);
    const responseMode = this.mergeResponseMode({
      baseMode,
      content: input.content,
      evidence: input.evidence,
      reviewOutcome,
      transportInterrupted: Boolean(input.transportInterrupted),
      errorType: input.errorType || null,
    });

    return {
      responseMode,
      reviewOutcome,
      content: input.content,
      evidence: input.evidence,
      strongestSource,
      memorySignals: {
        structured: (input.memoryEvents || []).map((event) => ({
          summary: event.summary,
          layer: event.layer,
        })),
        semantic: [],
      },
    };
  }

  buildCoworkerActivityFrame(input: BuildActivityFrameInput): CoworkerActivityFrame {
    const degradedEvidence = input.response.evidence.filter((evidence) => evidence.status === 'degraded');
    const failedEvidence = input.response.evidence.filter((evidence) => evidence.status === 'failed');
    const visibilityState =
      this.isCleanResponse(input.response, input.fallbackReason)
        ? 'clean'
        : 'degraded';
    const agentLabel = sharedResolveAgentDisplayLabel(input.agentId, {
      profileName: input.agentName,
      fallback: input.agentId ? 'Assistant' : 'RawClaw',
    });
    const modelLabel = sharedModelShortName(input.modelId);

    return {
      visibilityState,
      responseMode: input.response.responseMode,
      workStory: this.buildWorkStory(input.response),
      lane: input.lane || null,
      confidenceState: input.confidenceState || null,
      source: {
        agentId: input.agentId,
        agentLabel,
        modelId: input.modelId,
        modelLabel,
        isLocal: input.isLocal,
      },
      evidenceSummary: {
        total: input.response.evidence.length,
        degraded: degradedEvidence.length,
        failed: failedEvidence.length,
        strongestSource: input.response.strongestSource || null,
        sourceCount: input.response.evidence.reduce((max, evidence) => Math.max(max, evidence.sourceCount || 0), 0),
      },
    };
  }

  buildFallbackActivityFrame(message: {
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
    const response = this.buildAssistantResponseEnvelope({
      content: message.content,
      assistantLane: message.assistantLane || 'conversation',
      evidence: this.buildEvidenceEnvelopes(message.toolResults || []),
      errorType: message.errorType || (message.streamStatus === 'incomplete' ? 'stream_interrupted' : null),
      transportInterrupted: message.streamStatus === 'incomplete',
    });
    return this.buildCoworkerActivityFrame({
      response,
      agentId: message.agentId,
      agentName: message.agentName,
      modelId: message.modelId,
      isLocal: message.isLocal,
      lane: message.assistantLane || 'conversation',
      confidenceState: message.confidenceState || null,
      fallbackReason: 'legacy_render_fallback',
    });
  }

  buildStageTiming(stage: string, owner: 'api' | 'agent', durationMs: number, fallbackReason?: string | null): TransformStageTiming {
    return {
      stage,
      owner,
      durationMs,
      fallbackReason: fallbackReason || null,
    };
  }

  buildTransformTrace(
    pipelineMode: SessionPipelineMode,
    stageTimings: TransformStageTiming[],
    options: { firstEventLatencyMs?: number; fallbackReason?: string | null } = {},
  ): TransformTrace {
    return {
      pipelineMode,
      stageTimings,
      firstEventLatencyMs: options.firstEventLatencyMs,
      fallbackReason: options.fallbackReason || null,
    };
  }

  mergeStageTimings(...timingGroups: Array<TransformStageTiming[] | undefined | null>): TransformStageTiming[] {
    return timingGroups.flatMap((timings) => timings || []);
  }

  private toCanonicalLane(lane?: AssistantLane | null): CanonicalIntentFrame['lane'] {
    switch (lane) {
      case 'research':
        return 'research';
      case 'tasking':
        return 'tasking';
      case 'memory':
        return 'memory';
      case 'advisory':
        return 'advisory';
      case 'conversation':
      default:
        return 'conversation';
    }
  }

  private resolveGroundingMode(lane: AssistantLane, selectedToolNames: string[], latestUserContent: string): GroundingMode {
    const normalized = (latestUserContent || '').toLowerCase();
    if (lane === 'research') return 'grounded_required';
    if (selectedToolNames.some((name) => name.includes('web') || name.includes('search') || name.includes('extract'))) {
      return 'tool_preferred';
    }
    if (FRESHNESS_MARKERS.some((marker) => normalized.includes(marker))) {
      return 'tool_preferred';
    }
    return 'none';
  }

  private buildEvidenceEnvelope(result: ToolResult): EvidenceEnvelope {
    const output = (result.output || {}) as Record<string, any>;
    const toolName = String(result.tool_name || '');
    const sourceType = this.resolveEvidenceSourceType(toolName);
    const degradationReasons = this.resolveDegradationReasons(output, result.error);
    const status = this.resolveEvidenceStatus(output, result.error, degradationReasons);
    const quality = this.resolveEvidenceQuality(output, status);
    const title = this.pickString(output.title, output.sourceTitle);
    const url = this.pickString(output.url, output.redirectedUrl, output.sourceUrl);
    const results = Array.isArray(output.results) ? output.results : [];
    const sourceCount = results.length || (url ? 1 : 0);
    const strongestSource = this.resolveStrongestSourceFromOutput(output, title, url);

    return {
      sourceType,
      status,
      quality,
      toolName: toolName || null,
      title: title || null,
      url: url || null,
      sourceLabel: title || strongestSource || null,
      sourceCount,
      strongestSource: strongestSource || null,
      degradationReasons: degradationReasons.length > 0 ? degradationReasons : undefined,
    };
  }

  private resolveEvidenceSourceType(toolName: string): EvidenceSourceType {
    const normalized = toolName.toLowerCase();
    if (normalized.includes('search')) return 'search';
    if (normalized.includes('extract')) return 'page_extract';
    if (normalized.includes('browser') || normalized.includes('navigate')) return 'browser';
    if (normalized.includes('file')) return 'file';
    if (normalized.includes('python') || normalized.includes('code')) return 'code';
    if (normalized.includes('terminal') || normalized.includes('shell') || normalized.includes('command')) return 'terminal';
    return 'model_only';
  }

  private resolveEvidenceStatus(
    output: Record<string, any>,
    error?: string | null,
    degradationReasons: EvidenceDegradationReason[] = [],
  ): EvidenceStatus {
    const backendResult = String(output.backendResult || '').toLowerCase();
    if (backendResult === 'skipped') return 'skipped';
    if (error) {
      return degradationReasons.length > 0 ? 'degraded' : 'failed';
    }
    if (degradationReasons.length > 0) return 'degraded';
    return 'success';
  }

  private resolveEvidenceQuality(output: Record<string, any>, status: EvidenceStatus): EvidenceQuality {
    const resultQuality = String(output.result_quality || output.resultQuality || '').toLowerCase();
    if (resultQuality === 'strong' || resultQuality === 'medium' || resultQuality === 'weak') {
      return resultQuality as EvidenceQuality;
    }
    if (status === 'degraded') return 'weak';
    if (status === 'failed' || status === 'skipped') return 'unknown';
    return 'medium';
  }

  private resolveDegradationReasons(output: Record<string, any>, error?: string | null): EvidenceDegradationReason[] {
    const reasons = new Set<EvidenceDegradationReason>();
    const backendResult = String(output.backendResult || '').toLowerCase();
    const qualityAssessment = String(output.quality_assessment || output.qualityAssessment || '').toLowerCase();
    const resultQuality = String(output.result_quality || output.resultQuality || '').toLowerCase();
    if (resultQuality === 'weak') reasons.add('weak_search_results');
    if (qualityAssessment.includes('placeholder')) reasons.add('placeholder_like_results');
    if (qualityAssessment.includes('incomplete')) reasons.add('incomplete_results');
    if (backendResult === 'garbage') reasons.add('partial_extract');
    if (backendResult === 'skipped') reasons.add('interaction_required');
    if (output.isFallback || output.fallbackAttempted) reasons.add('fallback_used');
    if (output.is_truncated || output.truncated) reasons.add('truncated');
    if (error && String(error).toLowerCase().includes('timeout')) reasons.add('timeout');
    if (error && reasons.size === 0) reasons.add('provider_failure');
    if (reasons.size === 0 && String(output.evidenceStatus || '').toLowerCase() === 'degraded') reasons.add('unknown');
    return [...reasons];
  }

  private deriveReviewOutcome(reviewEvents?: Array<{ approved?: boolean }>): AssistantReviewOutcome {
    if (!reviewEvents?.length) return 'not_reviewed';
    const lastEvent = reviewEvents[reviewEvents.length - 1];
    if (lastEvent?.approved === true && reviewEvents.length > 1) return 'revised';
    if (lastEvent?.approved === true) return 'approved';
    return 'rejected';
  }

  private deriveBaseResponseMode(
    content: string,
    assistantLane: AssistantLane,
    evidence: EvidenceEnvelope[],
    errorType?: string | null,
  ): AssistantResponseMode {
    if (errorType && !content.trim()) {
      return 'error';
    }
    if (!content.trim() && assistantLane === 'research') {
      return 'abstain';
    }
    if (!evidence.length) {
      return content.trim() ? 'direct' : 'error';
    }
    if (assistantLane === 'research') {
      const allEvidenceFailed = evidence.every((item) => item.status === 'failed' || item.status === 'skipped');
      if (allEvidenceFailed) {
        return content.trim() ? 'partial' : 'abstain';
      }
      const anyDegraded = evidence.some((item) => item.status === 'degraded');
      return anyDegraded ? 'partial' : 'grounded';
    }
    return content.trim() ? 'direct' : 'error';
  }

  private mergeResponseMode(input: {
    baseMode: AssistantResponseMode;
    content: string;
    evidence: EvidenceEnvelope[];
    reviewOutcome: AssistantReviewOutcome;
    transportInterrupted: boolean;
    errorType?: string | null;
  }): AssistantResponseMode {
    if (input.transportInterrupted && input.content.trim()) {
      return 'interrupted';
    }
    if (input.errorType && !input.content.trim()) {
      return 'error';
    }
    if (input.reviewOutcome === 'rejected' && input.baseMode === 'direct') {
      return 'abstain';
    }
    if (input.baseMode === 'grounded') {
      const allEvidenceFailed = input.evidence.length > 0 && input.evidence.every((item) => item.status === 'failed' || item.status === 'skipped');
      if (allEvidenceFailed) {
        return input.content.trim() ? 'partial' : 'abstain';
      }
    }
    return input.baseMode;
  }

  private resolveStrongestSource(evidence: EvidenceEnvelope[]): string | null {
    const first = evidence.find((item) => item.strongestSource || item.sourceLabel || item.title || item.url);
    return first?.strongestSource || first?.sourceLabel || first?.title || first?.url || null;
  }

  private resolveStrongestSourceFromOutput(output: Record<string, any>, title?: string | null, url?: string | null): string | null {
    if (title) return title;
    const results = Array.isArray(output.results) ? output.results : [];
    const firstResult = results[0] as Record<string, any> | undefined;
    const resultTitle = this.pickString(firstResult?.title);
    if (resultTitle) return resultTitle;
    if (url) {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    }
    return null;
  }

  private isCleanResponse(response: AssistantResponseEnvelope, fallbackReason?: string | null): boolean {
    if (response.responseMode !== 'direct' && response.responseMode !== 'grounded') {
      return false;
    }
    if (response.reviewOutcome === 'rejected') {
      return false;
    }
    if (fallbackReason) {
      return false;
    }
    return response.evidence.every((item) => item.status !== 'degraded' && item.status !== 'failed');
  }

  private buildWorkStory(response: AssistantResponseEnvelope): string {
    if (response.responseMode === 'direct') {
      return COWORKER_WORK_STORY_TEMPLATES.direct;
    }
    const strongestSource = response.strongestSource || 'the strongest source';
    if (response.responseMode === 'grounded') {
      const sourceCount = response.evidence.reduce((max, evidence) => Math.max(max, evidence.sourceCount || 0), 0) || 1;
      return COWORKER_WORK_STORY_TEMPLATES.grounded(sourceCount, strongestSource);
    }
    if (response.responseMode === 'partial' || response.responseMode === 'abstain') {
      return COWORKER_WORK_STORY_TEMPLATES.partial(strongestSource);
    }
    const degradedEvidence = response.evidence.find((item) => item.status === 'degraded' || item.status === 'failed');
    const toolLabel = degradedEvidence?.toolName?.replace(/^skill_/, '').replace(/_/g, ' ') || 'the request';
    const degradationReasonLabel = this.humanizeDegradationReason(degradedEvidence?.degradationReasons?.[0] || 'unknown');
    return COWORKER_WORK_STORY_TEMPLATES.degraded(toolLabel, degradationReasonLabel);
  }

  private humanizeDegradationReason(reason: EvidenceDegradationReason): string {
    switch (reason) {
      case 'weak_search_results':
        return 'the search results were weak';
      case 'placeholder_like_results':
        return 'the results looked placeholder-like';
      case 'incomplete_results':
        return 'the evidence stayed incomplete';
      case 'fallback_used':
        return 'it had to fall back to a weaker path';
      case 'partial_extract':
        return 'the extract came back partial';
      case 'irrelevant_extract':
        return 'the extract was not relevant enough';
      case 'provider_failure':
        return 'the provider failed';
      case 'timeout':
        return 'the request timed out';
      case 'interaction_required':
        return 'it needed an interactive step';
      case 'truncated':
        return 'the result was truncated';
      case 'unknown':
      default:
        return 'the evidence was limited';
    }
  }

  private pickString(...values: Array<unknown>): string | undefined {
    return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
  }
}
