import { ChatTransformerService } from './chat-transformer.service';
import { PersistenceTransformerService } from './persistence-transformer.service';

describe('PersistenceTransformerService', () => {
  const createMessage = jest.fn(async () => ({ id: 'msg-1' }));
  let service: PersistenceTransformerService;

  beforeEach(() => {
    createMessage.mockClear();
    service = new PersistenceTransformerService({ createMessage } as any, new ChatTransformerService());
  });

  it('persistence-frame-replay-parity', async () => {
    const persisted = await service.persistAssistantTurn({
      sessionId: 'session-1',
      content: 'Checked 3 sources and anchored the answer.',
      assistantLane: 'research',
      confidenceState: 'grounded',
      toolResults: [{
        tool_name: 'web_search',
        output: { sourceCount: 3, strongestSource: 'Election Commission of India' },
      } as any],
      promptProvenance: {},
      streamStatus: 'completed',
      pipelineMode: 'transform_v1',
    });

    const replay = service.buildReplayFrame({
      content: 'Checked 3 sources and anchored the answer.',
      toolResults: [{
        tool_name: 'web_search',
        output: { sourceCount: 3, strongestSource: 'Election Commission of India' },
      } as any],
      assistantLane: 'research',
      confidenceState: 'grounded',
      streamStatus: 'completed',
    });

    expect(persisted.coworkerActivityFrame).toBeDefined();
    expect(replay.responseMode).toBe(persisted.coworkerActivityFrame?.responseMode);
  });

  it('persistence-degraded-visual-parity', () => {
    const replay = service.buildReplayFrame({
      content: 'Partial answer',
      toolResults: [],
      assistantLane: 'conversation',
      confidenceState: 'limited',
      streamStatus: 'incomplete',
      errorType: 'stream_interrupted',
    });

    expect(replay.visibilityState).toBe('degraded');
    expect(replay.responseMode).toBe('interrupted');
  });

  it('persistence-no-content-healing', () => {
    const error = service.buildPersistenceError('sqlite busy', true);
    expect(error.fallbackBehavior).toBe('log-and-continue');
    expect(error.userFacingMessage).toContain('left unchanged');
  });
});
