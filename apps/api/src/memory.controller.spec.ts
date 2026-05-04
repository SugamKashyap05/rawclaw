import { MemoryController } from './memory.controller';

describe('MemoryController PATCH entries', () => {
  const memoryService = {
    updateEntry: jest.fn(),
  };
  const controller = new MemoryController(memoryService as any);

  it('rejects collection changes with the read-only error body', async () => {
    await expect(controller.updateEntry('m1', { collection: 'operator' } as any)).rejects.toMatchObject({
      response: {
        error: 'read_only_field',
        fields: ['collection'],
        message: expect.any(String),
      },
      status: 400,
    });
  });

  it('rejects source changes with the read-only error body', async () => {
    await expect(controller.updateEntry('m1', { source: 'manual' } as any)).rejects.toMatchObject({
      response: {
        error: 'read_only_field',
        fields: ['source'],
        message: expect.any(String),
      },
      status: 400,
    });
  });
});
