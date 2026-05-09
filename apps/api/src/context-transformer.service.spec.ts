import { ContextTransformerService } from './context-transformer.service';

const buildLongMessages = () => {
  const filler = 'This is filler context that keeps the prompt large. '.repeat(1800);
  return [
    { id: 'u-1', role: 'user', content: `Please remember my preference is cobalt blue. ${filler}` },
    { id: 'a-1', role: 'assistant', content: "I will follow up on the West Bengal numbers after I verify them." },
    { id: 'u-2', role: 'user', content: 'What is still unresolved about Project Atlas?' },
    { id: 'a-2', role: 'assistant', content: 'Project Atlas is still waiting on the final seat tally confirmation.' },
    { id: 'u-3', role: 'user', content: 'Okay, thanks.' },
    { id: 'u-4', role: 'user', content: 'Keep Mission Control and Project Atlas in mind for the next turn.' },
    { id: 'a-4', role: 'assistant', content: 'Noted.' },
  ] as any;
};

describe('ContextTransformerService', () => {
  let service: ContextTransformerService;

  beforeEach(() => {
    service = new ContextTransformerService();
  });

  it('context-compaction-preserves-active-state', () => {
    const result = service.compactIfNeeded(buildLongMessages(), 140_000);
    expect('summary' in result).toBe(true);
    if ('summary' in result) {
      expect(result.summary.openCommitments.some((item) => item.text.includes('I will follow up'))).toBe(true);
      expect(result.summary.namedEntities.some((item) => item.text.includes('Project Atlas'))).toBe(true);
      expect(result.summary.unresolvedQuestions.some((item) => item.text.includes('What is still unresolved'))).toBe(true);
    }
  });

  it('context-compaction-reduces-size', () => {
    const result = service.compactIfNeeded(buildLongMessages(), 140_000);
    expect('summary' in result).toBe(true);
    if ('summary' in result) {
      expect(result.compacted).toBe(true);
      expect(result.totalEstimatedChars).toBeLessThan(140_000 * 0.75);
    }
  });

  it('context-no-short-session-compaction', () => {
    const result = service.compactIfNeeded([{ id: 'u-1', role: 'user', content: 'hello' }] as any, 5);
    expect('summary' in result).toBe(true);
    if ('summary' in result) {
      expect(result.compacted).toBe(false);
    }
  });
});
