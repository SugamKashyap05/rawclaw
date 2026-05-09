import { ChatNluFrame } from '@rawclaw/shared';
import { AssistantService } from './assistant.service';

const memoryQueryFrame: ChatNluFrame = {
  schemaVersion: 1,
  intent: 'memory_query',
  recommendedLane: 'memory',
  confidence: 0.86,
  confidenceState: 'direct',
  source: 'deterministic',
  entities: [],
  memoryScopes: { query: 'all' },
};

describe('AssistantService NLU memory query', () => {
  it('searches all memory scopes and dedupes results', async () => {
    const memoryService = {
      search: jest.fn(async ({ collection }: any) => {
        if (collection === 'session') {
          return [{ id: 'shared', content: 'Session note', preview: 'Session note', collection: 'session', score: 0.7, tags: [], source: null, createdAt: '', updatedAt: '' }];
        }
        if (collection === 'operator') {
          return [{ id: 'operator-1', content: 'Operator prefers concise reports', preview: 'Operator prefers concise reports', collection: 'operator', score: 0.9, tags: [], source: null, createdAt: '', updatedAt: '' }];
        }
        return [{ id: 'shared', content: 'Session note', preview: 'Session note', collection: 'session', score: 0.6, tags: [], source: null, createdAt: '', updatedAt: '' }];
      }),
    };
    const service = new AssistantService({} as any, memoryService as any, {} as any, {} as any);

    const result = await service.queryMemoryForNlu('s1', 'what do you remember?', memoryQueryFrame);

    expect(memoryService.search).toHaveBeenCalledWith(expect.objectContaining({ collection: 'session', source: 'session:s1' }));
    expect(memoryService.search).toHaveBeenCalledWith(expect.objectContaining({ collection: 'operator' }));
    expect(result.promptText).toContain('Operator prefers concise reports');
    expect(result.promptText?.match(/Session note/g)).toHaveLength(1);
    expect(result.memoryEvents).toEqual([
      expect.objectContaining({ action: 'recalled' }),
    ]);
  });

  it('forces session-scoped capture when the prompt says remember this for later in this chat', async () => {
    const prisma = {
      appSetting: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => null),
      },
    };
    const memoryService = {
      add: jest.fn(async (payload: any) => ({
        id: 'memory-1',
        content: payload.content,
        collection: payload.collection,
        source: payload.source ?? null,
        tags: payload.tags ?? [],
        createdAt: '',
        updatedAt: '',
      })),
    };
    const service = new AssistantService(prisma as any, memoryService as any, {} as any, {} as any);

    const frame: ChatNluFrame = {
      schemaVersion: 1,
      intent: 'memory_capture',
      recommendedLane: 'memory',
      confidence: 0.91,
      confidenceState: 'direct',
      source: 'deterministic',
      entities: [{ type: 'memory_fact', value: 'launch color is cobalt', confidence: 0.91, source: 'deterministic' }],
      memoryScopes: { capture: 'operator' },
    };

    await service.ingestUserTurn('s1', 'Remember this for later in this chat: the launch color is cobalt', frame);

    expect(memoryService.add).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'session',
      source: 'session:s1',
    }));
    expect(memoryService.add).not.toHaveBeenCalledWith(expect.objectContaining({ collection: 'operator' }));
  });

  it.each([
    'Remember this for later in this chat: the launch color is cobalt',
    'Keep this in mind: use the staging URL for this chat',
    "Don't forget the fallback port is 4173",
    'Note this for later: the release train is delayed',
    'Remind me to review the dashboard tomorrow',
    'Remind me to check the logs next week',
    'Later today, remember the operator code is bluebird',
    'Use this in this session: the demo tenant is northstar',
    'The error is on line 47 in this session',
    'Keep this in mind, the stack trace is from the auth worker',
  ])('keeps temporary memory as session scope for "%s"', async (content) => {
    const prisma = {
      appSetting: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => null),
      },
    };
    const memoryService = {
      add: jest.fn(async (payload: any) => ({
        id: 'memory-session',
        content: payload.content,
        collection: payload.collection,
        source: payload.source ?? null,
        tags: payload.tags ?? [],
        createdAt: '',
        updatedAt: '',
      })),
    };
    const service = new AssistantService(prisma as any, memoryService as any, {} as any, {} as any);

    const frame: ChatNluFrame = {
      schemaVersion: 1,
      intent: 'memory_capture',
      recommendedLane: 'memory',
      confidence: 0.92,
      confidenceState: 'direct',
      source: 'deterministic',
      entities: [{ type: 'memory_fact', value: 'temporary fact', confidence: 0.92, source: 'deterministic' }],
      memoryScopes: { capture: 'operator' },
    };

    await service.ingestUserTurn('s-memory', content, frame);

    expect(memoryService.add).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'session',
      source: 'session:s-memory',
    }));
  });

  it('rejects ambiguous auto-extraction instead of promoting it to operator memory', async () => {
    const prisma = {
      appSetting: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => null),
      },
    };
    const memoryService = {
      add: jest.fn(async (payload: any) => ({
        id: 'memory-ambiguous',
        content: payload.content,
        collection: payload.collection,
        source: payload.source ?? null,
        tags: payload.tags ?? [],
        createdAt: '',
        updatedAt: '',
      })),
    };
    const service = new AssistantService(prisma as any, memoryService as any, {} as any, {} as any);

    const frame: ChatNluFrame = {
      schemaVersion: 1,
      intent: 'memory_capture',
      recommendedLane: 'memory',
      confidence: 0.91,
      confidenceState: 'direct',
      source: 'deterministic',
      entities: [{ type: 'memory_fact', value: 'launch color is cobalt', confidence: 0.91, source: 'deterministic' }],
      memoryScopes: { capture: 'operator' },
    };

    await service.ingestUserTurn('s-ambiguous', 'The launch color is cobalt', frame);

    expect(memoryService.add).not.toHaveBeenCalled();
  });

  it('strips reminder clauses before promoting mission memory', async () => {
    const prisma = {
      appSetting: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => null),
      },
    };
    const memoryService = {
      add: jest.fn(async (payload: any) => ({
        id: 'memory-2',
        content: payload.content,
        collection: payload.collection,
        source: payload.source ?? null,
        tags: payload.tags ?? [],
        createdAt: '',
        updatedAt: '',
      })),
    };
    const service = new AssistantService(prisma as any, memoryService as any, {} as any, {} as any);

    await service.ingestUserTurn(
      's2',
      'We are working on the RawClaw JARVIS rollout remind me to review the operator dashboard tomorrow',
      null,
    );

    expect(memoryService.add).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'mission',
      content: 'Mission summary: the RawClaw JARVIS rollout',
    }));
    expect(memoryService.add).not.toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('remind me to review the operator dashboard tomorrow'),
      collection: 'mission',
    }));
  });
});
