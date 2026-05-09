import { EventEmitter } from 'events';
import { ChatOrchestratorService } from './chat-orchestrator.service';

describe('ChatOrchestratorService SSE writing', () => {
  it('waits for drain when the chat stream response applies backpressure', async () => {
    const service = Object.create(ChatOrchestratorService.prototype) as any;
    service.emissionTransformerService = {
      toClientVisibleEvent: jest.fn((event) => event),
    };
    service.logger = {
      error: jest.fn(),
    };

    const response = new EventEmitter() as any;
    response.writableEnded = false;
    response.write = jest.fn(() => {
      setImmediate(() => response.emit('drain'));
      return false;
    });

    await service.writeClientSseEventWithBackpressure(response, {
      type: 'done',
      correlationId: 'rc-test',
    });

    expect(response.write).toHaveBeenCalledWith('data: {"type":"done","correlationId":"rc-test"}\n\n');
  });
});
