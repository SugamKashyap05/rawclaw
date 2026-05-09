import { ChatController } from './chat.controller';
import type { ChatRequest } from '@rawclaw/shared';

describe('ChatController', () => {
  it('accepts script-equivalent /chat/send payloads without entering the 500 path', async () => {
    const orchestratorService = {
      processAndStreamChat: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ChatController(
      {} as any,
      {} as any,
      {} as any,
      orchestratorService as any,
    );
    const request: ChatRequest = {
      session_id: 'cli-test',
      messages: [{ role: 'user', content: 'hello from script' }],
      model: 'ollama/gemma4:e4b',
      complexity: 'medium',
      stream: true,
    };
    const response = {
      headersSent: false,
      writableEnded: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    const req = {
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      },
    };

    await controller.send(request, response as any, req as any);

    expect(orchestratorService.processAndStreamChat).toHaveBeenCalledTimes(1);
    expect(orchestratorService.processAndStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'cli-test',
        correlation_id: expect.stringMatching(/^rc-\d+-[a-f0-9-]{8}$/),
        correlationId: expect.stringMatching(/^rc-\d+-[a-f0-9-]{8}$/),
        messages: [{ role: 'user', content: 'hello from script' }],
      }),
      response,
    );
    expect(response.status).not.toHaveBeenCalledWith(500);
  });
});
