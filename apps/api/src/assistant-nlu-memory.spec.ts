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
});
