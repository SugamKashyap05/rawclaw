import type { ChatNluFrame } from '@rawclaw/shared';
import { IntakeTransformerService } from './intake-transformer.service';

const memoryQueryFrame: ChatNluFrame = {
  schemaVersion: 1,
  intent: 'memory_query',
  recommendedLane: 'memory',
  confidence: 0.92,
  confidenceState: 'direct',
  source: 'deterministic',
  entities: [],
};

const researchFrame: ChatNluFrame = {
  schemaVersion: 1,
  intent: 'research',
  recommendedLane: 'research',
  confidence: 0.95,
  confidenceState: 'direct',
  source: 'deterministic',
  entities: [],
};

describe('IntakeTransformerService', () => {
  let service: IntakeTransformerService;

  beforeEach(() => {
    service = new IntakeTransformerService();
  });

  it('intake-memory-query-policy', () => {
    expect(service.deriveRetrievalPolicy('Summarize memory', memoryQueryFrame)).toEqual({
      web: 'forbidden',
      memory: 'required',
    });
  });

  it('intake-conversation-no-retrieval', () => {
    expect(service.deriveRetrievalPolicy('How are you?')).toEqual({
      web: 'forbidden',
      memory: 'forbidden',
    });
  });

  it('intake-hybrid-memory-web-policy', () => {
    expect(service.deriveRetrievalPolicy('Summarize what we discussed about West Bengal and check if anything changed on the web')).toEqual({
      web: 'allowed',
      memory: 'required',
    });
    expect(service.deriveRetrievalPolicy('Who won West Bengal election 2026?', researchFrame)).toEqual({
      web: 'required',
      memory: 'allowed',
    });
  });

  it('intake-multilingual-valid-input', () => {
    const fixtures = [
      'नमस्ते, आप कैसे हैं?',
      'مرحبا كيف حالك',
      'Hi नमस्ते, can you help?',
      'मुझे याद दिलाओ कि हमने West Bengal के बारे में क्या बात की थी',
    ];
    for (const fixture of fixtures) {
      const result = service.transform({ latestUserContent: fixture, attachments: [], selection: null });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.normalized.latestUserContent.length).toBeGreaterThan(0);
      }
    }
  });

  it('intake-oversize-rejection', () => {
    const result = service.transform({
      latestUserContent: 'x'.repeat(40_001),
      attachments: [],
      selection: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.transformer).toBe('intake');
      expect(result.error.code).toBe('latest_user_too_large');
    }
  });
});
