import { readFileSync } from 'fs';
import * as path from 'path';
import { EmissionTransformerService } from './emission-transformer.service';

const loadSeedFixtures = (filename: string): string[] => {
  const filePath = path.resolve(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'contracts', 'transformer-fixtures', 'emission', filename);
  return JSON.parse(readFileSync(filePath, 'utf8')) as string[];
};

const mutateSeed = (seed: string, index: number): string => {
  const variants = [
    (value: string) => `${value} **${(index % 4) + 1}.`,
    (value: string) => `${value.replace(/:/g, ': * ')}`,
    (value: string) => `${value}\n\n* Follow-up item`,
    (value: string) => value.replace(/\[([0-9]+)\]/g, '**$1.'),
    (value: string) => `>${value}`,
    (value: string) => `${value}\n{"name":"web_search","arguments":{"q":"test"}}`,
  ];
  return variants[index % variants.length](seed);
};

describe('EmissionTransformerService', () => {
  let service: EmissionTransformerService;

  beforeEach(() => {
    service = new EmissionTransformerService();
  });

  it('emission-markdown-regression-fixtures', () => {
    const regressionFixtures = [
      ...loadSeedFixtures('malformed-lists.json'),
      ...loadSeedFixtures('bold-list-hybrids.json'),
      ...Array.from({ length: 17 }, (_, index) => mutateSeed(loadSeedFixtures('malformed-lists.json')[index % 3], index)),
    ];
    expect(regressionFixtures).toHaveLength(23);

    for (const fixture of regressionFixtures) {
      const transformed = service.toClientVisibleEvent({ type: 'content', content: fixture });
      expect(transformed.type).toBe('content');
      expect(String(transformed.content || '')).not.toContain('**1.');
      expect(String(transformed.content || '')).not.toContain('**2.');
      expect(String(transformed.content || '')).not.toContain('{"name":"web_search"');
    }

    const seedGroups = [
      ...loadSeedFixtures('malformed-lists.json'),
      ...loadSeedFixtures('bold-list-hybrids.json'),
      ...loadSeedFixtures('citations.json'),
      ...loadSeedFixtures('links.json'),
      ...loadSeedFixtures('code-fences.json'),
    ];
    const mutatedFixtures = Array.from({ length: 60 }, (_, index) => mutateSeed(seedGroups[index % seedGroups.length], index));
    expect(mutatedFixtures).toHaveLength(60);
    for (const fixture of mutatedFixtures) {
      const transformed = service.toClientVisibleEvent({ type: 'content', content: fixture });
      expect(String(transformed.content || '')).not.toMatch(/\*\*\d+\./);
    }
  });

  it('emission-stream-allowlist', () => {
    const transformed = service.toClientVisibleEvent({
      type: 'metadata',
      metadata: {
        modelId: 'openai/gpt-4o',
        isLocal: false,
        durationMs: 123,
        internalSecret: 'nope',
        transformStageTimings: [{ stage: 'input_transform', owner: 'api', durationMs: 1 }],
      },
      hidden: 'nope',
    } as any);

    expect(Object.keys(transformed)).toEqual(['type', 'metadata']);
    expect((transformed.metadata as any).modelId).toBe('openai/gpt-4o');
    expect((transformed.metadata as any).internalSecret).toBeUndefined();
    expect((transformed.metadata as any).transformStageTimings).toBeUndefined();
  });

  it('emission-metadata-defaults-to-empty-object-for-metadata-events', () => {
    const transformed = service.toClientVisibleEvent({
      type: 'metadata',
    } as any);

    expect(transformed).toEqual({
      type: 'metadata',
      metadata: {},
    });
  });

  it('emission-preserve-meaning-control-fixtures', () => {
    const controls = [
      ...loadSeedFixtures('citations.json'),
      ...loadSeedFixtures('links.json'),
      ...loadSeedFixtures('code-fences.json'),
      ...Array.from({ length: 11 }, (_, index) => `Control fixture ${index + 1}: https://example.com/${index}`),
    ];
    expect(controls).toHaveLength(20);

    for (const fixture of controls) {
      const transformed = service.toClientVisibleEvent({ type: 'content', content: fixture });
      expect(String(transformed.content || '')).toContain(fixture.split(/\s+/)[0]);
      if (fixture.includes('https://')) {
        expect(String(transformed.content || '')).toContain('https://');
      }
      if (fixture.includes('```')) {
        expect(String(transformed.content || '')).toContain('```');
      }
    }
  });

  it('fails clearly when client-visible stream allowlists are unavailable at runtime', () => {
    jest.resetModules();
    jest.doMock('@rawclaw/shared', () => {
      const actual = jest.requireActual('@rawclaw/shared');
      return {
        ...actual,
        CLIENT_VISIBLE_STREAM_FIELDS: undefined,
        CLIENT_VISIBLE_METADATA_FIELDS: undefined,
      };
    });

    let capturedMessage = '';
    jest.isolateModules(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { EmissionTransformerService: RuntimeEmissionTransformerService } = require('./emission-transformer.service');
        new RuntimeEmissionTransformerService();
      } catch (error) {
        capturedMessage = error instanceof Error ? error.message : String(error);
      }
    });

    jest.dontMock('@rawclaw/shared');
    jest.resetModules();

    expect(capturedMessage).toContain('CLIENT_VISIBLE_STREAM_FIELDS');
  });
});
