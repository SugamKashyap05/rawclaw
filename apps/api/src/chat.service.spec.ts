import { ChatService } from './chat.service';

function makeMessage(overrides: Partial<any> = {}) {
  return {
    id: 'message-1',
    role: 'user',
    content: 'Please summarize the Times of India homepage.',
    toolCalls: null,
    toolResults: null,
    provenance: null,
    citations: null,
    createdAt: new Date('2026-04-28T09:00:00.000Z'),
    sessionId: 'session-1',
    modelId: null,
    isLocal: null,
    fallbacks: null,
    memoryRecall: null,
    agentId: null,
    streamStatus: 'completed',
    errorType: null,
    errorMessage: null,
    attachments: null,
    durationMs: null,
    promptPackId: null,
    promptVersionHash: null,
    reviewerPromptVersionHash: null,
    workflowPromptIds: null,
    runIds: null,
    ...overrides,
  };
}

describe('ChatService', () => {
  let prisma: any;
  let redis: any;
  let service: ChatService;

  beforeEach(() => {
    prisma = {
      session: {
        upsert: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      message: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'message-created',
          createdAt: new Date('2026-04-28T09:00:00.000Z'),
          sessionId: data.sessionId,
          ...data,
          toolCalls: data.toolCalls ?? null,
          toolResults: data.toolResults ?? null,
          provenance: data.provenance ?? null,
          citations: data.citations ?? null,
          modelId: data.modelId ?? null,
          isLocal: data.isLocal ?? null,
          fallbacks: data.fallbacks ?? null,
          memoryRecall: data.memoryRecall ?? null,
          agentId: data.agentId ?? null,
          streamStatus: data.streamStatus ?? 'completed',
          errorType: data.errorType ?? null,
          errorMessage: data.errorMessage ?? null,
          attachments: data.attachments ?? null,
          durationMs: data.durationMs ?? null,
          promptPackId: data.promptPackId ?? null,
          promptVersionHash: data.promptVersionHash ?? null,
          reviewerPromptVersionHash: data.reviewerPromptVersionHash ?? null,
          workflowPromptIds: data.workflowPromptIds ?? null,
          runIds: data.runIds ?? null,
        })),
      },
      document: {
        findUnique: jest.fn(),
      },
    };

    redis = {};
    service = new ChatService(prisma, redis);
  });

  it('backfills a null session title from the first meaningful user message', async () => {
    await service.createMessage('session-1', 'user', 'Please summarize the Times of India homepage.');

    expect(prisma.session.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        create: expect.objectContaining({
          id: 'session-1',
          title: 'Please summarize the Times of India homepage.',
        }),
      }),
    );
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        title: null,
      },
      data: {
        title: 'Please summarize the Times of India homepage.',
      },
    });
  });

  it('does not use low-signal greetings as the session title', async () => {
    await service.createMessage('session-1', 'user', 'hello');

    expect(prisma.session.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          title: null,
        }),
      }),
    );
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('derives a visible session title from saved user messages when the stored title is null', async () => {
    prisma.session.findMany.mockResolvedValue([
      {
        id: 'session-1',
        title: null,
        metadataJson: null,
        workspaceId: 'default',
        senderIdentifier: 'local',
        createdAt: new Date('2026-04-28T08:59:00.000Z'),
        updatedAt: new Date('2026-04-28T09:01:00.000Z'),
        messages: [
          makeMessage({ id: 'message-greeting', content: 'hello' }),
          makeMessage({ id: 'message-real', content: 'Tell me what is on the Times of India homepage right now.' }),
        ],
      },
    ]);

    const sessions = await service.listSessions();

    expect(sessions[0]?.title).toBe('Tell me what is on the Times of India homepage rig...');
  });

  it('persists per-session chat controls in session metadata', async () => {
    prisma.session.findUnique.mockResolvedValue({
      metadataJson: JSON.stringify({
        chatControls: {
          planMode: false,
          preferredWebMode: 'auto',
          toolUseMode: 'auto',
          permissionMode: 'workspace_default',
          selectedPlugins: [],
          selectedTools: ['web_search'],
        },
      }),
    });

    await service.upsertSessionControls('session-1', {
      planMode: true,
      preferredWebMode: 'read_page',
      selectedTools: ['web_extract'],
    });

    expect(prisma.session.upsert).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      update: {
        metadataJson: JSON.stringify({
          chatControls: {
            planMode: true,
            preferredWebMode: 'read_page',
            toolUseMode: 'auto',
            permissionMode: 'workspace_default',
            selectedPlugins: [],
            selectedTools: ['web_extract'],
          },
        }),
      },
      create: {
        id: 'session-1',
        title: null,
        metadataJson: JSON.stringify({
          chatControls: {
            planMode: true,
            preferredWebMode: 'read_page',
            toolUseMode: 'auto',
            permissionMode: 'workspace_default',
            selectedPlugins: [],
            selectedTools: ['web_extract'],
          },
        }),
      },
    });
  });

  it('latches session pipeline mode on first resolution and keeps it stable', async () => {
    prisma.session.findUnique.mockResolvedValueOnce({ metadataJson: null, title: null });

    const firstMode = await service.resolveSessionPipelineMode('session-1', true);
    expect(firstMode).toBe('transform_v1');
    expect(prisma.session.upsert).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      update: {
        metadataJson: JSON.stringify({
          pipelineMode: 'transform_v1',
        }),
      },
      create: {
        id: 'session-1',
        title: null,
        metadataJson: JSON.stringify({
          pipelineMode: 'transform_v1',
        }),
      },
    });

    prisma.session.findUnique.mockResolvedValueOnce({
      metadataJson: JSON.stringify({ pipelineMode: 'legacy' }),
    });
    const secondMode = await service.resolveSessionPipelineMode('session-1', true);
    expect(secondMode).toBe('legacy');
  });

  it('persists coworker activity frame and transform trace inside message provenance metadata', async () => {
    const created = await service.createMessage('session-1', 'assistant', 'Grounded answer', {
      coworkerActivityFrame: {
        visibilityState: 'clean',
        responseMode: 'grounded',
        workStory: 'Checked 2 sources and used Election Commission of India for the answer.',
        source: {
          agentId: 'research-agent',
          agentLabel: 'Research Agent',
          modelId: 'openai/gpt-4o',
          modelLabel: 'gpt-4o',
          isLocal: false,
        },
      },
      transformTrace: {
        pipelineMode: 'transform_v1',
        stageTimings: [{ stage: 'input_transform', owner: 'api', durationMs: 4 }],
        firstEventLatencyMs: 12,
      },
    });

    const mapped = (service as any).mapToChatMessage(created);
    expect(mapped.coworkerActivityFrame).toEqual(
      expect.objectContaining({
        visibilityState: 'clean',
        responseMode: 'grounded',
      }),
    );
    expect(mapped.transformTrace).toEqual(
      expect.objectContaining({
        pipelineMode: 'transform_v1',
      }),
    );
  });
});
