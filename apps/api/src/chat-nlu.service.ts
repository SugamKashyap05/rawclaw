import { Injectable } from '@nestjs/common';
import {
  AssistantLane,
  ChatNluAnalyzeInput,
  ChatNluAnalyzeResult,
  ChatNluAvailableTool,
  ChatNluEntity,
  ChatNluFrame,
  ChatNluIntent,
  ChatNluRecommendedTool,
  ChatNluConfidenceState,
  CHAT_NLU_INTENT_EXAMPLES,
  ChatNluIntentExample,
  NLU_SEMANTIC_MIN_TOKENS,
  NLU_STOPWORDS,
} from '@rawclaw/shared';

const KNOWN_INTENTS: ChatNluIntent[] = [
  'conversation',
  'research',
  'memory_capture',
  'memory_query',
  'task_create',
  'advisory',
  'code_help',
  'troubleshooting',
  'edit_request',
  'tool_request',
  'settings_control',
  'clarification_needed',
  'unknown',
];

export const RESEARCH_FOLLOW_UP_PHRASES = [
  'more sources',
  'find more',
  'compare these',
  'continue',
  'go deeper',
  'any newer source',
  'verify that',
];

const RESEARCH_SIGNAL_PHRASES = [
  'search the web',
  'search web',
  'search for',
  'latest',
  'current',
  'news',
  'official page',
  'official results',
  'sources',
  'research brief',
  'verify',
  'fact check',
  'who won',
  'winner',
  'winners',
  'seat tally',
  'election result',
  'election results',
  'how much seats',
  'how many seats',
  'result for',
  'results for',
  'standings',
  'points table',
];

const MEMORY_QUERY_PHRASES = [
  'what do you know about me',
  'what did we discuss',
  'what do you remember',
  'recall',
  'memory about',
  'earlier in this chat',
  'summarize memory',
  'summarise memory',
  'memory summary',
  'summarize what you remember',
  'summarise what you remember',
  'summarize our memory',
  'summarise our memory',
];

const SECONDARY_INTENT_THRESHOLD = 0.62;
const CLARIFICATION_TTL_MS = 15 * 60 * 1000;
const SEMANTIC_MATCH_THRESHOLD = 0.55;
const SEMANTIC_MAX_CONFIDENCE = 0.81;

type IntentCandidate = {
  intent: ChatNluIntent;
  confidence: number;
  reason: string;
  memoryScopes?: ChatNluFrame['memoryScopes'];
  secondaryIntents?: ChatNluIntent[];
  recommendedLane?: AssistantLane;
};

type ModelNluSubset = {
  intent: ChatNluIntent;
  confidence: number;
  confidenceState: ChatNluConfidenceState;
  secondaryIntents?: Array<{ intent: ChatNluIntent; confidence: number; reason?: string }>;
  memoryScopes?: ChatNluFrame['memoryScopes'];
};

@Injectable()
export class ChatNluService {
  private semanticScoreEvaluations = 0;

  async analyzeTurn(input: ChatNluAnalyzeInput): Promise<ChatNluAnalyzeResult> {
    const text = input.latestUserContent || '';
    const trimmed = text.trim();

    if (input.nluOverride) {
      return { frame: this.applyOverride(input, trimmed) };
    }

    const clarificationResult = this.handlePendingClarification(input, trimmed);
    if (clarificationResult) {
      return clarificationResult;
    }

    return { frame: this.analyzeFreshTurn(input, trimmed) };
  }

  private analyzeFreshTurn(input: ChatNluAnalyzeInput, text: string): ChatNluFrame {
    const entities = this.extractEntities(input, text);
    const candidates = this.detectIntentCandidates(input, text, entities);
    const primary = candidates[0] || this.semanticIntentCandidate(input, text) || { intent: 'conversation' as const, confidence: 0.86, reason: 'default conversation' };
    const secondaryIntents = candidates
      .slice(1)
      .filter((candidate) => candidate.confidence >= SECONDARY_INTENT_THRESHOLD && candidate.intent !== primary.intent)
      .concat((primary.secondaryIntents || []).map((intent) => ({ intent, confidence: Math.min(primary.confidence, 0.72), reason: 'semantic secondary intent' })))
      .sort((a, b) => b.confidence - a.confidence || this.laneDiversityTieBreak(a.intent, b.intent, primary.intent))
      .map((candidate) => ({
        intent: candidate.intent,
        confidence: candidate.confidence,
        reason: candidate.reason,
      }))
      .slice(0, 3);

    const recommendedTools = this.recommendTools(input, text, primary.intent, entities);
    return this.buildFrame({
      intent: primary.intent,
      confidence: primary.confidence,
      source: primary.reason === 'semantic-lite' ? 'semantic' : 'deterministic',
      entities,
      secondaryIntents,
      recommendedTools,
      memoryScopes: primary.memoryScopes || this.inferMemoryScopes(primary.intent, secondaryIntents.map((item) => item.intent), text),
      routingFallbackReason: primary.reason === 'research follow-up' ? 'research_followup' : undefined,
    });
  }

  private applyOverride(input: ChatNluAnalyzeInput, text: string): ChatNluFrame {
    const intent = input.nluOverride?.intent;
    if (!this.isKnownIntent(intent)) {
      return this.buildFrame({
        intent: 'conversation',
        confidence: 0.8,
        source: 'override',
        entities: this.extractEntities(input, text),
        routingFallbackReason: 'invalid_nlu_override',
        notes: ['Invalid NLU override was ignored and the turn was routed conversationally.'],
      });
    }

    return this.buildFrame({
      intent,
      confidence: 1,
      source: 'override',
      entities: this.extractEntities(input, text),
      recommendedTools: this.recommendTools(input, text, intent, this.extractEntities(input, text)),
      memoryScopes: this.inferMemoryScopes(intent, [], text),
      overrideApplied: true,
    });
  }

  private handlePendingClarification(input: ChatNluAnalyzeInput, text: string): ChatNluAnalyzeResult | null {
    const pending = input.pendingClarification;
    if (!pending) {
      return null;
    }

    const createdAt = new Date(pending.createdAt).getTime();
    if (Number.isFinite(createdAt) && Date.now() - createdAt > CLARIFICATION_TTL_MS) {
      return {
        frame: this.buildFrame({
          intent: 'conversation',
          confidence: 0.78,
          source: 'deterministic',
          entities: this.extractEntities(input, text),
          routingFallbackReason: 'clarification_expired',
          notes: ['The previous clarification expired. Ask the user to restate the original request.'],
        }),
        pendingClarificationUpdate: {
          action: 'clear',
          expectedUpdatedAt: pending.updatedAt,
        },
      };
    }

    const independent = this.analyzeFreshTurn({ ...input, pendingClarification: null }, text);
    const pendingIntent = pending.candidateFrame.intent;
    const unrelated =
      independent.intent !== 'conversation' &&
      independent.intent !== pendingIntent &&
      independent.confidence >= 0.75;
    if (unrelated) {
      return {
        frame: independent,
        pendingClarificationUpdate: {
          action: 'clear',
          expectedUpdatedAt: pending.updatedAt,
        },
      };
    }

    if (pending.attemptCount >= 2) {
      return {
        frame: this.buildFrame({
          intent: 'unknown',
          confidence: 0.5,
          source: 'deterministic',
          entities: this.extractEntities(input, text),
          clarificationFailed: true,
          routingFallbackReason: 'clarification_failed',
        }),
        pendingClarificationUpdate: {
          action: 'clear',
          expectedUpdatedAt: pending.updatedAt,
        },
      };
    }

    return {
      frame: {
        ...pending.candidateFrame,
        confidence: Math.max(pending.candidateFrame.confidence, 0.82),
        confidenceState: 'direct',
        notes: [...(pending.candidateFrame.notes || []), 'Resolved from pending clarification answer.'],
      },
      pendingClarificationUpdate: {
        action: 'clear',
        expectedUpdatedAt: pending.updatedAt,
      },
    };
  }

  private detectIntentCandidates(input: ChatNluAnalyzeInput, text: string, entities: ChatNluEntity[]): IntentCandidate[] {
    const lower = text.toLowerCase();
    const candidates: IntentCandidate[] = [];
    const has = (tokens: string[]) => tokens.some((token) => lower.includes(token));
    const hasResearchSignal = this.hasResearchSignal(lower, input);
    const push = (intent: ChatNluIntent, confidence: number, reason: string) => {
      candidates.push({ intent, confidence, reason });
    };

    const researchFollowUp =
      input.previousAssistantNlu?.intent === 'research' &&
      RESEARCH_FOLLOW_UP_PHRASES.some((phrase) => lower.includes(phrase)) &&
      !this.hasCompetingPrimarySignal(lower);

    if (researchFollowUp) {
      push('research', 0.9, 'research follow-up');
    }

    if (input.selection && has(['rewrite', 'improve', 'shorten', 'formalize', 'edit this', 'revise this', 'make this'])) {
      push('edit_request', 0.9, 'selection edit');
    }

    if (hasResearchSignal) {
      push('research', 0.88, 'research signal');
    }

    if (entities.some((entity) => entity.type === 'url') && has(['open', 'fetch', 'read', 'summarize', 'extract'])) {
      push('research', 0.86, 'url research signal');
    }

    if (has(['remember this', 'my name is', 'call me', 'i prefer', 'my preference is', 'our mission', 'project goal', 'working on'])) {
      push('memory_capture', 0.9, 'memory capture');
    }

    if (has(MEMORY_QUERY_PHRASES)) {
      push('memory_query', 0.86, 'memory query');
    }

    if (has(['create a task', 'create task', 'remind me', 'follow up', 'monitor', 'schedule this'])) {
      push('task_create', 0.87, 'task signal');
    }

    if (has(['disable memory', 'enable memory', 'change setting', 'set mode', 'turn off', 'turn on'])) {
      push('settings_control', 0.84, 'settings signal');
    }

    if (entities.some((entity) => entity.type === 'tool_name') || has(['use tool', 'call tool', 'use notion', 'use asana', 'use jira', 'use slack'])) {
      push('tool_request', 0.83, 'tool request');
    }

    if (has(['error', 'exception', 'stack trace', 'failing', 'failed', 'broken', 'debug', 'bug', 'fix this bug', 'test failed'])) {
      push('troubleshooting', 0.87, 'troubleshooting signal');
    }

    if (has(['write code', 'implement', 'refactor', 'function', 'component', 'codebase', 'explain this code', 'api endpoint'])) {
      push('code_help', 0.8, 'coding help signal');
    }

    if (has(['next step', 'recommend', 'what should we do', 'strategy', 'advice', 'briefing', 'status update'])) {
      push('advisory', 0.78, 'advisory signal');
    }

    if (!candidates.length) {
      return [];
    }

    return candidates.sort((a, b) => b.confidence - a.confidence || this.intentPriority(a.intent) - this.intentPriority(b.intent));
  }

  private hasResearchSignal(lower: string, input: ChatNluAnalyzeInput): boolean {
    if (RESEARCH_SIGNAL_PHRASES.some((token) => lower.includes(token))) {
      return true;
    }

    const selectedTools = input.chatControlsSubset?.selectedTools || [];
    if (selectedTools.includes('skill_grounded-web-summary')) {
      return true;
    }

    return false;
  }

  private semanticIntentCandidate(_input: ChatNluAnalyzeInput, text: string): IntentCandidate | null {
    const queryTokens = this.normalizeSemanticTokens(text);
    if (queryTokens.length < NLU_SEMANTIC_MIN_TOKENS) {
      return null;
    }

    const bestByIntent = new Map<ChatNluIntent, { score: number; example: ChatNluIntentExample }>();
    for (const example of CHAT_NLU_INTENT_EXAMPLES) {
      const exampleTokens = this.normalizeSemanticTokens(example.text);
      const score = this.scoreSemanticTokens(queryTokens, exampleTokens);
      const existing = bestByIntent.get(example.intent);
      if (!existing || score > existing.score) {
        bestByIntent.set(example.intent, { score, example });
      }
    }

    const best = [...bestByIntent.entries()]
      .map(([intent, value]) => ({ intent, ...value }))
      .sort((a, b) => b.score - a.score || this.intentPriority(a.intent) - this.intentPriority(b.intent))[0];

    if (!best || best.score < SEMANTIC_MATCH_THRESHOLD) {
      return null;
    }

    return {
      intent: best.intent,
      confidence: Number(Math.min(SEMANTIC_MAX_CONFIDENCE, best.score).toFixed(2)),
      reason: 'semantic-lite',
      memoryScopes: best.example.memoryScopes,
      secondaryIntents: best.example.secondaryIntents,
      recommendedLane: best.example.recommendedLane,
    };
  }

  normalizeSemanticTokens(text: string): string[] {
    return this.normalize(text)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !NLU_STOPWORDS.has(token));
  }

  scoreSemanticTokens(queryTokens: string[], exampleTokens: string[]): number {
    this.semanticScoreEvaluations += 1;
    const query = new Set(queryTokens);
    const example = new Set(exampleTokens);
    const union = new Set([...query, ...example]);
    if (!union.size) {
      return 0;
    }
    let intersection = 0;
    for (const token of query) {
      if (example.has(token)) {
        intersection += 1;
      }
    }
    return intersection / union.size;
  }

  getSemanticScoreEvaluationCount(): number {
    return this.semanticScoreEvaluations;
  }

  resetSemanticScoreEvaluationCount(): void {
    this.semanticScoreEvaluations = 0;
  }

  mergeModelNluResultForTest(deterministicFrame: ChatNluFrame, rawModelOutput: unknown): ChatNluFrame {
    return this.mergeModelNluResult(deterministicFrame, rawModelOutput);
  }

  private mergeModelNluResult(deterministicFrame: ChatNluFrame, rawModelOutput: unknown): ChatNluFrame {
    const parsed = this.validateModelNluSubset(rawModelOutput);
    if (!parsed) {
      console.warn('chat_nlu_model_validation_failed', { rawModelOutput });
      return {
        ...deterministicFrame,
        source: 'timeout_fallback',
      };
    }

    return {
      ...deterministicFrame,
      intent: parsed.intent,
      confidence: Number(Math.max(0, Math.min(1, parsed.confidence)).toFixed(2)),
      confidenceState: parsed.confidenceState,
      secondaryIntents: parsed.secondaryIntents,
      memoryScopes: parsed.memoryScopes,
      recommendedLane: this.intentToLane(parsed.intent),
      source: 'model',
    };
  }

  private validateModelNluSubset(raw: unknown): ModelNluSubset | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const value = raw as Record<string, unknown>;
    const intent = value.intent;
    const confidence = value.confidence;
    const confidenceState = value.confidenceState;
    if (!this.isKnownIntent(intent)) {
      return null;
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return null;
    }
    if (!['direct', 'inferred', 'needs_clarification'].includes(String(confidenceState))) {
      return null;
    }
    const secondaryIntents = Array.isArray(value.secondaryIntents)
      ? value.secondaryIntents
          .filter((item): item is { intent: ChatNluIntent; confidence: number; reason?: string } =>
            Boolean(item)
            && typeof item === 'object'
            && this.isKnownIntent((item as any).intent)
            && typeof (item as any).confidence === 'number'
            && (item as any).confidence >= 0
            && (item as any).confidence <= 1,
          )
          .slice(0, 3)
      : undefined;
    const memoryScopes = this.validateMemoryScopes(value.memoryScopes);
    return {
      intent,
      confidence,
      confidenceState: confidenceState as ChatNluConfidenceState,
      secondaryIntents,
      memoryScopes,
    };
  }

  private validateMemoryScopes(raw: unknown): ChatNluFrame['memoryScopes'] | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const allowed = new Set(['session', 'operator', 'mission', 'recent', 'all']);
    const value = raw as Record<string, unknown>;
    const scopes: ChatNluFrame['memoryScopes'] = {};
    if (typeof value.capture === 'string' && allowed.has(value.capture)) {
      scopes.capture = value.capture as any;
    }
    if (typeof value.query === 'string' && allowed.has(value.query)) {
      scopes.query = value.query as any;
    }
    return Object.keys(scopes).length ? scopes : undefined;
  }

  private extractEntities(input: ChatNluAnalyzeInput, text: string): ChatNluEntity[] {
    const entities: ChatNluEntity[] = [];
    this.pushRegexEntities(entities, text, /(https?:\/\/[^\s)]+)/gi, 'url', 0.95);
    this.pushRegexEntities(entities, text, /(?:[A-Za-z]:\\[^\s]+|(?:\.{1,2}\/)?[\w.-]+(?:\/[\w.-]+)+)/g, 'file_path', 0.72);
    this.pushRegexEntities(entities, text, /\b(today|tomorrow|next week|next month|tonight|this afternoon)\b/gi, 'date_time', 0.78);

    const memoryFact = this.extractMemoryFact(text);
    if (memoryFact) {
      entities.push({
        type: 'memory_fact',
        value: memoryFact,
        confidence: 0.82,
        source: 'deterministic',
      });
    }

    const taskText = this.extractTaskText(text);
    if (taskText) {
      entities.push({
        type: 'task_text',
        value: taskText,
        confidence: 0.8,
        source: 'deterministic',
      });
    }

    if (input.selection?.text) {
      entities.push({
        type: 'selection_ref',
        value: input.selection.documentId,
        confidence: 1,
        source: 'deterministic',
      });
    }

    for (const attachment of input.attachments || []) {
      if (attachment?.filename) {
        entities.push({
          type: 'attachment_ref',
          value: attachment.filename,
          confidence: 0.9,
          source: 'deterministic',
        });
      }
    }

    const matchedTools = this.matchTools(input.availableTools || [], text);
    for (const tool of matchedTools.slice(0, 5)) {
      entities.push({
        type: 'tool_name',
        value: tool.name,
        normalizedValue: this.normalize(tool.name),
        confidence: tool.type === 'mcp' ? 0.78 : 0.82,
        source: 'deterministic',
      });
    }

    return this.dedupeEntities(entities).slice(0, 20);
  }

  private recommendTools(
    input: ChatNluAnalyzeInput,
    text: string,
    intent: ChatNluIntent,
    entities: ChatNluEntity[],
  ): ChatNluRecommendedTool[] {
    const recommendations: ChatNluRecommendedTool[] = [];
    const add = (tool: ChatNluAvailableTool, confidence: number, reason: ChatNluRecommendedTool['reason']) => {
      if (recommendations.some((item) => item.name === tool.name)) {
        return;
      }
      recommendations.push({
        name: tool.name,
        type: tool.type,
        confidence,
        reason,
        serverId: tool.serverId,
        serverDisplayName: tool.serverDisplayName,
        mayRequireConfirmation: tool.type === 'mcp',
      });
    };

    const tools = input.availableTools || [];
    if (intent === 'research') {
      for (const tool of tools) {
        const name = tool.name.toLowerCase();
        if (this.isSearchToolName(name) || this.isFetchOrBrowserToolName(name)) {
          add(tool, 0.82, 'matched research intent');
        }
      }
    }

    const explicitToolNames = new Set(entities.filter((entity) => entity.type === 'tool_name').map((entity) => entity.value));
    for (const tool of tools) {
      if (explicitToolNames.has(tool.name)) {
        add(tool, 0.9, tool.type === 'mcp' ? 'matched MCP server' : 'matched tool name');
      } else if (tool.type === 'mcp' && this.fuzzyMatchesTool(text, tool)) {
        add(tool, 0.78, 'matched MCP server');
      }
    }

    const selectedSkills = new Set((input.selectedAgent?.skills || []).map((skill) => `skill_${skill}`));
    for (const tool of tools) {
      if (tool.type === 'skill' && selectedSkills.has(tool.name)) {
        add(tool, 0.84, 'matched selected skill');
      }
    }

    for (const selected of input.chatControlsSubset.selectedTools || []) {
      const tool = tools.find((item) => item.name === selected);
      if (tool) {
        add(tool, 0.9, 'matched explicit chat control');
      }
    }

    return recommendations.slice(0, 8);
  }

  private inferMemoryScopes(primary: ChatNluIntent, secondary: ChatNluIntent[], text: string): ChatNluFrame['memoryScopes'] {
    const lower = text.toLowerCase();
    const memoryScopes: ChatNluFrame['memoryScopes'] = {};
    if (primary === 'memory_capture' || secondary.includes('memory_capture')) {
      if (['my name', 'my preference', 'i prefer', 'call me'].some((token) => lower.includes(token))) {
        memoryScopes.capture = 'operator';
      } else if (['our mission', 'project goal', 'working on', 'the goal is', 'the mission is'].some((token) => lower.includes(token))) {
        memoryScopes.capture = 'mission';
      } else {
        memoryScopes.capture = 'session';
      }
    }
    if (primary === 'memory_query' || secondary.includes('memory_query')) {
      if (['this chat', 'earlier in this chat', 'we discuss'].some((token) => lower.includes(token))) {
        memoryScopes.query = 'session';
      } else if (['about me', 'my preference', 'my name'].some((token) => lower.includes(token))) {
        memoryScopes.query = 'operator';
      } else if (['mission', 'project', 'goal'].some((token) => lower.includes(token))) {
        memoryScopes.query = 'mission';
      } else {
        memoryScopes.query = 'all';
      }
    }
    return Object.keys(memoryScopes).length ? memoryScopes : undefined;
  }

  private buildFrame(partial: {
    intent: ChatNluIntent;
    confidence: number;
    source: ChatNluFrame['source'];
    entities: ChatNluEntity[];
    secondaryIntents?: ChatNluFrame['secondaryIntents'];
    recommendedTools?: ChatNluRecommendedTool[];
    memoryScopes?: ChatNluFrame['memoryScopes'];
    routingFallbackReason?: ChatNluFrame['routingFallbackReason'];
    clarificationFailed?: boolean;
    overrideApplied?: boolean;
    notes?: string[];
  }): ChatNluFrame {
    return {
      schemaVersion: 1,
      intent: partial.intent,
      secondaryIntents: partial.secondaryIntents?.length ? partial.secondaryIntents : undefined,
      recommendedLane: this.intentToLane(partial.intent),
      confidence: Number(Math.max(0, Math.min(1, partial.confidence)).toFixed(2)),
      confidenceState: partial.confidence >= 0.82 ? 'direct' : partial.confidence >= 0.55 ? 'inferred' : 'needs_clarification',
      source: partial.source,
      entities: partial.entities,
      recommendedTools: partial.recommendedTools?.length ? partial.recommendedTools : undefined,
      memoryScopes: partial.memoryScopes,
      routingFallbackReason: partial.routingFallbackReason,
      clarificationFailed: partial.clarificationFailed || undefined,
      overrideApplied: partial.overrideApplied || undefined,
      notes: partial.notes?.length ? partial.notes : undefined,
    };
  }

  private pushRegexEntities(
    entities: ChatNluEntity[],
    text: string,
    regex: RegExp,
    type: ChatNluEntity['type'],
    confidence: number,
  ) {
    for (const match of text.matchAll(regex)) {
      if (!match[0]) continue;
      entities.push({
        type,
        value: match[0],
        confidence,
        span: typeof match.index === 'number' ? [match.index, match.index + match[0].length] : undefined,
        source: 'deterministic',
      });
    }
  }

  private extractMemoryFact(text: string): string | null {
    const patterns = [
      /remember this(?: for later)?(?: in this chat)?:?\s*(.+?)(?:[.?!]|$)/i,
      /\b(?:my name is|call me)\s+(.+?)(?:[.?!]|$)/i,
      /\b(?:i prefer|my preference is|i like)\s+(.+?)(?:[.?!]|$)/i,
      /\b(?:we are working on|our mission is|the mission is|the goal is|project goal is|i am working on)\s+(.+?)(?:[.?!]|$)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim().replace(/[.?!]+$/, '');
      }
    }
    return null;
  }

  private extractTaskText(text: string): string | null {
    const match = text.match(/\b(?:create a task|create task|remind me to|follow up(?: on)?|monitor)\s+(.+?)(?:[.?!]|$)/i);
    return match?.[1]?.trim().replace(/[.?!]+$/, '') || null;
  }

  private matchTools(tools: ChatNluAvailableTool[], text: string): ChatNluAvailableTool[] {
    return tools.filter((tool) => {
      const normalizedText = this.normalize(text);
      const normalizedTool = this.normalize(tool.name);
      return normalizedText.includes(normalizedTool) || this.fuzzyMatchesTool(text, tool);
    });
  }

  private fuzzyMatchesTool(query: string, tool: ChatNluAvailableTool): boolean {
    const queryNormalized = this.normalize(query);
    const toolName = this.normalize(tool.name);
    const serverName = this.normalize(`${tool.serverDisplayName || ''} ${tool.serverId || ''}`);
    const candidates = [toolName, serverName].filter(Boolean);
    return candidates.some((candidate) => this.fuzzyMatchNormalized(queryNormalized, candidate));
  }

  private fuzzyMatchNormalized(query: string, candidate: string): boolean {
    if (!query || !candidate) {
      return false;
    }
    if (query === candidate || query.includes(candidate)) {
      return true;
    }
    const shorter = query.length < candidate.length ? query : candidate;
    const longer = query.length < candidate.length ? candidate : query;
    if (shorter.length >= 4 && longer.includes(shorter)) {
      return true;
    }
    const queryTokens = new Set(query.split(/\s+/).filter(Boolean));
    const candidateTokens = candidate.split(/\s+/).filter(Boolean);
    if (!candidateTokens.length) {
      return false;
    }
    const intersection = candidateTokens.filter((token) => queryTokens.has(token)).length;
    return intersection / candidateTokens.length >= 0.6;
  }

  private dedupeEntities(entities: ChatNluEntity[]): ChatNluEntity[] {
    const seen = new Set<string>();
    const deduped: ChatNluEntity[] = [];
    for (const entity of entities) {
      const key = `${entity.type}:${entity.normalizedValue || entity.value}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(entity);
    }
    return deduped;
  }

  private hasCompetingPrimarySignal(lower: string): boolean {
    return [
      'remember',
      'my name',
      'create task',
      'create a task',
      'remind me',
      'error',
      'debug',
      'fix',
      'rewrite',
      'improve',
      'disable',
      'enable',
      'use tool',
    ].some((token) => lower.includes(token));
  }

  private isKnownIntent(value: unknown): value is ChatNluIntent {
    return typeof value === 'string' && (KNOWN_INTENTS as string[]).includes(value);
  }

  private intentToLane(intent: ChatNluIntent): AssistantLane {
    if (intent === 'research') return 'research';
    if (intent === 'memory_capture' || intent === 'memory_query') return 'memory';
    if (intent === 'task_create') return 'tasking';
    if (intent === 'advisory') return 'advisory';
    return 'conversation';
  }

  private laneDiversityTieBreak(a: ChatNluIntent, b: ChatNluIntent, primary: ChatNluIntent): number {
    const primaryLane = this.intentToLane(primary);
    const aDistinct = this.intentToLane(a) !== primaryLane;
    const bDistinct = this.intentToLane(b) !== primaryLane;
    if (aDistinct === bDistinct) {
      return this.intentPriority(a) - this.intentPriority(b);
    }
    return aDistinct ? -1 : 1;
  }

  private intentPriority(intent: ChatNluIntent): number {
    const order: ChatNluIntent[] = [
      'edit_request',
      'settings_control',
      'tool_request',
      'task_create',
      'memory_capture',
      'memory_query',
      'research',
      'troubleshooting',
      'code_help',
      'advisory',
      'conversation',
      'clarification_needed',
      'unknown',
    ];
    return order.indexOf(intent);
  }

  private isSearchToolName(name: string): boolean {
    return ['web_search', 'duckduckgo_search', 'smart_search', 'iask-search', 'web-search', 'google:search'].includes(name)
      || (name.includes('search') && name.includes('web'));
  }

  private isFetchOrBrowserToolName(name: string): boolean {
    return ['web_extract', 'web_fetch', 'fetch_url', 'browser_fetch', 'browser_open', 'browser_navigate'].includes(name)
      || name.includes('browser')
      || name.includes('fetch')
      || name.includes('extract');
  }

  private normalize(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/^skill_/, 'skill ')
      .replace(/[_:/.-]+/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
