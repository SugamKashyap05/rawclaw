import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import {
  renderTransformerPipelineMarkdown,
  TRANSFORMER_PIPELINE_DESCRIPTORS,
  TRANSFORMER_TEST_REGISTRIES,
} from '@rawclaw/shared';
import { TRANSFORMER_ACCEPTANCE_REGISTRIES } from './transformer-acceptance';

describe('Transformer pipeline manifest enforcement', () => {
  it('requires every descriptor to declare owners, forbidden behaviors, and covered acceptance cases', () => {
    for (const descriptor of TRANSFORMER_PIPELINE_DESCRIPTORS) {
      expect(descriptor.owner.contractOwner).toBeTruthy();
      expect(descriptor.owner.runtimeOwner).toBeTruthy();
      expect(descriptor.owner.rolloutOwner).toBeTruthy();
      expect(descriptor.owner.ciSuite).toBeTruthy();
      expect(descriptor.forbiddenBehaviors.length).toBeGreaterThan(0);
      expect(descriptor.acceptanceCases.length).toBeGreaterThan(0);

      for (const forbiddenBehavior of descriptor.forbiddenBehaviors) {
        expect(
          descriptor.acceptanceCases.some((acceptanceCase) => acceptanceCase.kind === 'negative'),
        ).toBe(true);
        expect(forbiddenBehavior).toBeTruthy();
      }
    }
  });

  it('fails loudly when a registry module is missing or does not export covered acceptance IDs', () => {
    for (const [boundaryName, relativeModulePath] of Object.entries(TRANSFORMER_TEST_REGISTRIES)) {
      const absoluteModulePath = path.resolve(__dirname, '..', '..', '..', relativeModulePath);
      expect(existsSync(absoluteModulePath)).toBe(true);
      const registryModule = (TRANSFORMER_ACCEPTANCE_REGISTRIES as Record<string, any>)[boundaryName];
      expect(registryModule).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(registryModule, 'COVERED_ACCEPTANCE_CASE_IDS')).toBe(true);
      expect(Array.isArray(registryModule.COVERED_ACCEPTANCE_CASE_IDS)).toBe(true);
    }
  });

  it('requires every acceptance case to map to a covered test registry ID', () => {
    const coveredIds = new Set(
      Object.values(TRANSFORMER_ACCEPTANCE_REGISTRIES).flatMap((registryModule: any) => registryModule.COVERED_ACCEPTANCE_CASE_IDS),
    );
    for (const descriptor of TRANSFORMER_PIPELINE_DESCRIPTORS) {
      for (const acceptanceCase of descriptor.acceptanceCases) {
        expect(coveredIds.has(acceptanceCase.id)).toBe(true);
      }
    }
  });

  it('keeps the checked-in markdown spec in sync with the manifest snapshot', () => {
    const docPath = path.resolve(__dirname, '..', '..', '..', 'packages', 'shared', 'docs', 'transformer-pipeline.md');
    expect(existsSync(docPath)).toBe(true);
    const expected = renderTransformerPipelineMarkdown(TRANSFORMER_PIPELINE_DESCRIPTORS);
    const actual = readFileSync(docPath, 'utf8');
    expect(actual).toBe(expected);
  });
});
