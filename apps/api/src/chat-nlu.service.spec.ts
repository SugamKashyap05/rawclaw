import {
  CHAT_NLU_INTENT_EXAMPLES,
  CHAT_NLU_INTENT_HELD_OUT_FIXTURES,
  ChatNluAnalyzeInput,
} from '@rawclaw/shared';
import { ChatNluService, RESEARCH_FOLLOW_UP_PHRASES } from './chat-nlu.service';

const baseInput = (latestUserContent: string): ChatNluAnalyzeInput => ({
  sessionId: 'session-1',
  latestUserContent,
  chatControlsSubset: {
    preferredWebMode: 'auto',
    toolUseMode: 'auto',
    selectedTools: [],
    selectedPlugins: [],
  },
  selectedAgent: null,
  availableTools: [],
  attachments: [],
  selection: null,
  assistantStateSummary: '',
  pendingClarification: null,
});

const frameFor = async (service: ChatNluService, input: ChatNluAnalyzeInput) => (await service.analyzeTurn(input)).frame;

describe('ChatNluService', () => {
  const service = new ChatNluService();

  it('separates code help from troubleshooting', async () => {
    await expect(frameFor(service, baseInput('Help me write a TypeScript function for parsing dates.'))).resolves.toMatchObject({
      intent: 'code_help',
      recommendedLane: 'conversation',
    });

    await expect(frameFor(service, baseInput('This test failed with a stack trace, please debug it.'))).resolves.toMatchObject({
      intent: 'troubleshooting',
      recommendedLane: 'conversation',
    });
  });

  it('rejects invalid overrides into safe conversation routing', async () => {
    const frame = await frameFor(service, {
      ...baseInput('search current prices'),
      nluOverride: { intent: 'made_up_intent' },
    });

    expect(frame.intent).toBe('conversation');
    expect(frame.source).toBe('override');
    expect(frame.routingFallbackReason).toBe('invalid_nlu_override');
  });

  it('infers memory capture scope and gates memory facts with confidence metadata', async () => {
    const frame = await frameFor(service, baseInput('Remember my preference is concise engineering reports.'));

    expect(frame.intent).toBe('memory_capture');
    expect(frame.memoryScopes?.capture).toBe('operator');
    expect(frame.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'memory_fact', confidence: expect.any(Number) }),
    ]));
    expect(frame.confidence).toBeGreaterThanOrEqual(0.82);
  });

  it('defaults memory query scope to all when no narrower scope is inferred', async () => {
    const frame = await frameFor(service, baseInput('What do you remember?'));

    expect(frame.intent).toBe('memory_query');
    expect(frame.memoryScopes?.query).toBe('all');
  });

  it('inherits research follow-up only without competing primary intent signals', async () => {
    const prior = await frameFor(service, baseInput('Search the web for current Redis news.'));
    const followUp = await frameFor(service, {
      ...baseInput(RESEARCH_FOLLOW_UP_PHRASES[0]),
      previousAssistantNlu: prior,
    });
    const competing = await frameFor(service, {
      ...baseInput('verify that and remember my preference is brief answers'),
      previousAssistantNlu: prior,
    });

    expect(followUp.intent).toBe('research');
    expect(followUp.routingFallbackReason).toBe('research_followup');
    expect(competing.intent).toBe('memory_capture');
  });

  it('matches MCP tools deterministically without using descriptions or capability tags', async () => {
    const frame = await frameFor(service, {
      ...baseInput('create a task in asana'),
      availableTools: [
        {
          name: 'asana_create_task',
          description: 'Create and manage tasks',
          type: 'mcp',
          serverId: 'srv-asana',
          serverDisplayName: 'Asana',
        },
        {
          name: 'generic_planner',
          description: 'Search the web and research deeply',
          type: 'native',
          capabilityTags: ['research'],
        },
      ],
    });

    expect(frame.recommendedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'asana_create_task', type: 'mcp', reason: 'matched MCP server' }),
    ]));
    expect(frame.recommendedTools || []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'generic_planner' }),
    ]));
  });

  it('expires stale pending clarifications with a user-facing fallback reason and explicit clear update', async () => {
    const candidate = await frameFor(service, baseInput('search latest model updates'));
    const result = await service.analyzeTurn({
      ...baseInput('yes'),
      pendingClarification: {
        id: 'clarify-1',
        originalUserContent: 'search latest model updates',
        clarifyingQuestion: 'Which model?',
        candidateFrame: candidate,
        attemptCount: 1,
        createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
        updatedAt: 'old-stamp',
      },
    });

    expect(result.frame.intent).toBe('conversation');
    expect(result.frame.routingFallbackReason).toBe('clarification_expired');
    expect(result.pendingClarificationUpdate).toEqual({ action: 'clear', expectedUpdatedAt: 'old-stamp' });
  });

  it('uses the shared stopword-aware semantic token guard', () => {
    expect(service.normalizeSemanticTokens('can you help me')).toEqual(['help']);
    expect(service.normalizeSemanticTokens('find latest AI research papers')).toEqual(['find', 'latest', 'research', 'papers']);
  });

  it('uses Jaccard similarity for semantic scoring', () => {
    const score = service.scoreSemanticTokens(['find', 'research', 'papers'], ['find', 'latest', 'research']);
    expect(score).toBe(0.5);
    expect(score).toBeLessThan(0.55);
  });

  it('skips semantic-lite for messages below the minimum token count', async () => {
    for (const text of ['help', 'find more', 'search web']) {
      service.resetSemanticScoreEvaluationCount();
      const frame = await frameFor(service, baseInput(text));
      expect(frame.source).not.toBe('semantic');
      expect(service.getSemanticScoreEvaluationCount()).toBe(0);
    }
  });

  it('keeps the semantic catalog large enough and validates held-out recall', () => {
    const counts = new Map<string, number>();
    for (const example of CHAT_NLU_INTENT_EXAMPLES) {
      counts.set(example.intent, (counts.get(example.intent) || 0) + 1);
    }
    for (const [intent, count] of counts) {
      expect(count).toBeGreaterThanOrEqual(15);
      const enriched = CHAT_NLU_INTENT_EXAMPLES.filter((item) =>
        item.intent === intent && (item.secondaryIntents?.length || item.memoryScopes || item.recommendedLane),
      );
      expect(enriched.length).toBeGreaterThanOrEqual(5);
    }

    const intents = Array.from(new Set(CHAT_NLU_INTENT_HELD_OUT_FIXTURES.map((fixture) => fixture.intent)));
    const failures: string[] = [];
    for (const intent of intents) {
      const fixtures = CHAT_NLU_INTENT_HELD_OUT_FIXTURES.filter((fixture) => fixture.intent === intent);
      const matched = fixtures.filter((fixture) => {
        const candidate = (service as any).semanticIntentCandidate(baseInput(fixture.phrase), fixture.phrase);
        return candidate?.intent === intent && candidate.confidence >= 0.55;
      });
      if (matched.length < 3) {
        const failed = fixtures
          .filter((fixture) => !matched.includes(fixture))
          .map((fixture) => `${fixture.phrase} (${fixture.description})`);
        failures.push(`Intent [${intent}] recall failed: [${matched.length}/5] phrases matched. Failed phrases: [${failed.join('; ')}]. Last catalog change to this intent: check git blame on chat-nlu-intent-examples.ts.`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('merges model NLU by replacing only allowed fields and re-deriving the lane', () => {
    const deterministic = {
      schemaVersion: 1 as const,
      intent: 'conversation' as const,
      recommendedLane: 'conversation' as const,
      confidence: 0.86,
      confidenceState: 'direct' as const,
      source: 'deterministic' as const,
      entities: [{ type: 'url' as const, value: 'https://example.com', confidence: 0.95, source: 'deterministic' as const }],
      recommendedTools: [{ name: 'web_search', type: 'native' as const, confidence: 0.8, reason: 'matched research intent' as const }],
    };

    const merged = service.mergeModelNluResultForTest(deterministic, {
      intent: 'research',
      confidence: 0.76,
      confidenceState: 'inferred',
    });

    expect(merged.intent).toBe('research');
    expect(merged.recommendedLane).toBe('research');
    expect(merged.confidence).toBe(0.76);
    expect(merged.source).toBe('model');
    expect(merged.entities).toEqual(deterministic.entities);
    expect(merged.recommendedTools).toEqual(deterministic.recommendedTools);
  });
});
