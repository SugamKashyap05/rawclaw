import { ChatNluFrame } from '@rawclaw/shared';
import { ChatOrchestratorService } from './chat-orchestrator.service';

const makeService = (): any => new (ChatOrchestratorService as any)(...new Array(16).fill({}));

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
});
