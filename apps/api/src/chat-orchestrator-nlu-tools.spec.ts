import { ChatNluFrame } from '@rawclaw/shared';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { ContextTransformerService } from './context-transformer.service';
import { EmissionTransformerService } from './emission-transformer.service';
import { IntakeTransformerService } from './intake-transformer.service';

const makeService = (): any => new (ChatOrchestratorService as any)(
  ...new Array(17).fill({}),
  new EmissionTransformerService(),
  new IntakeTransformerService(),
  {},
  new ContextTransformerService(),
);

const makeTool = (name: string) => ({
  type: 'function',
  function: {
    name,
    description: name,
    parameters: {},
  },
});

const researchFrame: ChatNluFrame = {
  schemaVersion: 1,
  intent: 'research',
  recommendedLane: 'research',
  confidence: 0.88,
  confidenceState: 'direct',
  source: 'deterministic',
  entities: [],
};

const conversationFrame: ChatNluFrame = {
  schemaVersion: 1,
  intent: 'conversation',
  recommendedLane: 'conversation',
  confidence: 0.9,
  confidenceState: 'direct',
  source: 'deterministic',
  entities: [],
};

const memoryQueryFrame: ChatNluFrame = {
  schemaVersion: 1,
  intent: 'memory_query',
  recommendedLane: 'memory',
  confidence: 0.89,
  confidenceState: 'direct',
  source: 'deterministic',
  entities: [],
  memoryScopes: { query: 'all' },
};

describe('ChatOrchestratorService NLU tool scoring', () => {
  it('uses NLU research boosts to keep web tools inside the request cap', () => {
    const service = makeService();
    const tools = [
      ...Array.from({ length: 18 }, (_, index) => makeTool(`utility_${index}`)),
      makeTool('web_search'),
    ];

    const selected = service.selectRelevantTools('tell me about this', tools, { toolUseMode: 'auto', preferredWebMode: 'auto' }, null, researchFrame);

    expect(selected.map((tool: any) => tool.function.name)).toContain('web_search');
    expect(selected.length).toBeLessThanOrEqual(16);
  });

  it('does not let NLU add tools outside explicit selected-tool mode', () => {
    const service = makeService();
    const tools = [makeTool('read_file'), makeTool('web_search'), makeTool('browser_open')];

    const selected = service.selectRelevantTools(
      'search latest release notes',
      tools,
      { toolUseMode: 'manual', preferredWebMode: 'auto', selectedTools: ['read_file'] },
      null,
      researchFrame,
    );

    expect(selected.map((tool: any) => tool.function.name)).toEqual(['read_file']);
  });

  it('keeps grounded research tools selected for plain who-won election queries', () => {
    const service = makeService();
    const tools = [makeTool('skill_grounded-web-summary'), makeTool('web_search'), makeTool('read_file')];

    const selected = service.selectRelevantTools(
      'search for who won the west bengal election in 2026 and who will be the next cm of bengal',
      tools,
      { toolUseMode: 'auto', preferredWebMode: 'auto', selectedTools: [] },
      null,
      researchFrame,
    );

    expect(selected.map((tool: any) => tool.function.name)).toEqual(
      expect.arrayContaining(['skill_grounded-web-summary', 'web_search']),
    );
  });

  it('blocks external retrieval tools for direct conversational turns even when a grounded skill is assigned', () => {
    const service = makeService();
    const tools = [makeTool('skill_grounded-web-summary'), makeTool('web_search'), makeTool('read_file')];

    const selected = service.selectRelevantTools(
      'How are you?',
      tools,
      { toolUseMode: 'auto', preferredWebMode: 'auto', selectedTools: [] },
      { skills: ['grounded-web-summary'] },
      conversationFrame,
      { web: 'forbidden', memory: 'forbidden' },
    );

    expect(selected).toEqual([]);
  });

  it('returns no automatic tools when a plain conversational turn has no positive tool matches', () => {
    const service = makeService();
    const tools = [makeTool('browser_close'), makeTool('browser_console_messages'), makeTool('browser_click')];

    const selected = service.selectRelevantTools(
      'Please remember that my favorite snack is samosa and reply naturally.',
      tools,
      { toolUseMode: 'auto', preferredWebMode: 'auto', selectedTools: [] },
      null,
      conversationFrame,
      { web: 'forbidden', memory: 'allowed' },
    );

    expect(selected).toEqual([]);
  });

  it('keeps summarize memory on the memory/session path instead of surfacing grounded web tools', () => {
    const service = makeService();
    const tools = [makeTool('skill_grounded-web-summary'), makeTool('web_search'), makeTool('read_file')];

    const selected = service.selectRelevantTools(
      'Summarize memory',
      tools,
      { toolUseMode: 'auto', preferredWebMode: 'auto', selectedTools: [] },
      { skills: ['grounded-web-summary'] },
      memoryQueryFrame,
      { web: 'forbidden', memory: 'required' },
    );

    expect(selected).toEqual([]);
  });

  it('normalizes malformed markdown before the stream reaches the client', () => {
    const service = makeService();
    const sanitized = service.sanitizeAssistantContentChunk(
      'Depending on the context, "HII" can refer to a few different things: **1.\n\nIt was formed in 2011 and consists of three main divisions: * Newport News Shipbuilding (Virginia) * Ingalls Shipbuilding (Mississippi) **2.',
      true,
    );

    expect(sanitized).not.toContain('**1.');
    expect(sanitized).not.toContain('**2.');
    expect(sanitized).toContain('1.');
    expect(sanitized).toContain('\n- Newport News Shipbuilding');
    expect(sanitized).toContain('\n- Ingalls Shipbuilding');
  });

  it('detects conversation confabulation candidates for direct turns', () => {
    const service = makeService();
    const signal = service.detectConversationSafetySignal({
      content: 'If you are referring to the "How are you?" initiative mentioned in my records, it is a public program.',
      toolResults: [{ tool_name: 'web_search' }],
      assistantLane: 'conversation',
      nluFrame: conversationFrame,
      memoryEvents: [],
    });

    expect(signal).toEqual({
      confabulatedMemoryCandidate: true,
      reasons: ['external_retrieval_on_direct_turn', 'memory_claim_without_recall'],
    });
  });

  it('estimates context budget components exactly and preserves the total invariant', () => {
    const service = makeService();
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    const tools = [makeTool('web_search'), makeTool('read_file')];
    const budget = service.estimateContextChars(messages, 'system prompt', tools, 3);

    expect(budget.systemPromptChars).toBe('system prompt'.length);
    expect(budget.messageHistoryChars).toBe('hello'.length + 'world'.length);
    expect(budget.toolDefinitionChars).toBe(tools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0));
    expect(budget.otherChars).toBe(3);
    expect(budget.totalEstimatedChars).toBe(
      budget.systemPromptChars + budget.messageHistoryChars + budget.toolDefinitionChars + budget.otherChars,
    );
  });

  it('runs context compaction before heuristic truncation when the prompt is large enough', () => {
    const service = makeService();
    const filler = 'This is filler context that keeps the prompt large. '.repeat(2800);
    const messages = [
      { id: 'u-1', role: 'user', content: `Please remember my preference is cobalt blue. ${filler}` },
      { id: 'a-1', role: 'assistant', content: 'I will follow up on Project Atlas after I verify the final seat tally.' },
      { id: 'u-2', role: 'user', content: 'What is still unresolved about Project Atlas?' },
      { id: 'a-2', role: 'assistant', content: 'Project Atlas is still pending final confirmation.' },
      { id: 'u-3', role: 'user', content: 'Keep Mission Control in mind for the next turn.' },
      { id: 'a-3', role: 'assistant', content: 'Noted.' },
    ];

    const compacted = service.budgetContext(messages as any);

    expect(compacted.some((message: any) => message.id === 'context-summary')).toBe(true);
    expect(compacted.some((message: any) => message.content === '[... History Truncated ...]')).toBe(false);
  });

  it('normalizes supported chat task schedule presets into cron expressions', () => {
    const service = makeService();
    const parsed = service.tryExtractTaskDescription(`create a task named "Morning Brief" to collect release notes daily at 9 am.`);

    expect(parsed).toEqual(
      expect.objectContaining({
        name: 'Morning Brief',
        description: 'collect release notes',
        schedule: '0 9 * * *',
        manualOnlyFallback: false,
      }),
    );
  });

  it('falls back to manual-only chat task creation for unsupported time phrases like tomorrow', () => {
    const service = makeService();
    const parsed = service.tryExtractTaskDescription(`create a task named "Quick Check" to scan the changelog tomorrow.`);

    expect(parsed).toEqual(
      expect.objectContaining({
        name: 'Quick Check',
        description: 'scan the changelog',
        schedule: undefined,
        manualOnlyFallback: true,
      }),
    );
  });
});
