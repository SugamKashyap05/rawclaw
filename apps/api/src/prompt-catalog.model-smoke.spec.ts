import { PromptCatalogService } from './prompt-catalog.service';

const describeIf =
  process.env.RAWCLAW_ENABLE_MODEL_SMOKE === '1' ? describe : describe.skip;

type SmokeCase = {
  name: string;
  user: string;
  check: (content: string) => boolean;
  mustPass?: boolean;
};

const smokeCases: SmokeCase[] = [
  {
    name: 'greeting',
    user: 'hello there',
    check: (content) => /\b(hello|hi|hey|namaste|good to see you)\b/i.test(content),
  },
  {
    name: 'ambiguity',
    user: 'Do you know exactly what happened in the meeting I had yesterday?',
    check: (content) =>
      /\b(i (?:do not|don't) know|i(?:'| a)m not sure|i can't verify|i need more context|i don't have enough information)\b/i.test(
        content,
      ),
    mustPass: true,
  },
  {
    name: 'task handoff',
    user: 'Help me figure out the next step for debugging a failing build.',
    check: (content) => /\b(next step|start by|first|let's)\b/i.test(content),
  },
];

const blockedClaimPattern =
  /\b(i can access anything|i know everything|i have perfect knowledge|i never make mistakes)\b/i;

async function callOllama(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const rawModel = model.replace(/^ollama\//i, '');
  const baseUrl = (process.env.RAWCLAW_MODEL_SMOKE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: rawModel,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Smoke test request failed for ${model}: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { message?: { content?: string } };
  return payload.message?.content?.trim() || '';
}

describeIf('PromptCatalogService model smoke', () => {
  const service = new PromptCatalogService();
  const configuredModels = (process.env.RAWCLAW_MODEL_SMOKE_MODELS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  it(
    'keeps register stable across three local chat-capable models',
    async () => {
      if (configuredModels.length < 3) {
        throw new Error(
          'Set RAWCLAW_MODEL_SMOKE_MODELS to a comma-separated list of at least 3 local chat-capable models.',
        );
      }

      const prompt = service.composeChatPrompt({
        systemContext: 'System context',
        workspaceFiles: {},
        latestUserContent: smokeCases[0].user,
        assistantLane: 'conversation',
      }).prompt;

      let passedChecks = 0;
      let ambiguityChecksPassed = 0;
      const totalChecks = configuredModels.slice(0, 3).length * smokeCases.length;

      for (const model of configuredModels.slice(0, 3)) {
        for (const smokeCase of smokeCases) {
          const content = await callOllama(model, prompt, smokeCase.user);
          if (blockedClaimPattern.test(content)) {
            throw new Error(`Blocked exaggerated-claim phrase appeared for ${model} on case ${smokeCase.name}: ${content}`);
          }

          const passed = smokeCase.check(content);
          if (passed) {
            passedChecks += 1;
          }
          if (smokeCase.mustPass && passed) {
            ambiguityChecksPassed += 1;
          }
        }
      }

      expect(totalChecks).toBe(9);
      expect(passedChecks).toBeGreaterThanOrEqual(8);
      expect(ambiguityChecksPassed).toBe(3);
    },
    120000,
  );
});
