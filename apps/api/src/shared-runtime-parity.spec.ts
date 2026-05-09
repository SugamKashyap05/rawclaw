import * as path from 'path';

describe('shared runtime parity', () => {
  it('exports emission transformer allowlists from built shared dist', () => {
    const sharedDistPath = path.resolve(__dirname, '..', '..', '..', 'packages', 'shared', 'dist', 'index.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharedDist = require(sharedDistPath);

    expect(sharedDist.CLIENT_VISIBLE_STREAM_FIELDS).toBeDefined();
    expect(sharedDist.CLIENT_VISIBLE_METADATA_FIELDS).toBeDefined();
    expect(sharedDist.TRANSFORMER_PIPELINE_DESCRIPTORS).toBeDefined();
    expect(sharedDist.renderTransformerPipelineMarkdown).toBeDefined();
  });
});
