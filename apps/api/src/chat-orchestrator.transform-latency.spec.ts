import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { performance } from 'perf_hooks';
import { of } from 'rxjs';
import type { ChatMessage, ChatNluFrame, ChatRequest, SessionPipelineMode } from '@rawclaw/shared';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { ChatTransformerService } from './chat-transformer.service';
import { EmissionTransformerService } from './emission-transformer.service';
import { IntakeTransformerService } from './intake-transformer.service';
import { PersistenceTransformerService } from './persistence-transformer.service';
import { ContextTransformerService } from './context-transformer.service';

type StreamEvent = Record<string, any>;

const FIXTURES = [
  {
    latestUserContent: 'hi',
    nluFrame: makeConversationFrame(),
  },
  {
    latestUserContent: 'search for who won west bengal election 2026',
    nluFrame: makeResearchFrame(),
  },
] as const;

describe('ChatOrchestratorService transformer latency gate', () => {
  it('keeps first non-heartbeat SSE emission within the pre-stream regression budget', async () => {
    const iterationsPerFixture = 8;
    const warmupIterations = 2;

    const legacySamples = await collectLatencySamples('legacy', iterationsPerFixture, warmupIterations);
    const transformSamples = await collectLatencySamples('transform_v1', iterationsPerFixture, warmupIterations);

    const legacyMedian = percentile(legacySamples, 0.5);
    const legacyP95 = percentile(legacySamples, 0.95);
    const transformMedian = percentile(transformSamples, 0.5);
    const transformP95 = percentile(transformSamples, 0.95);

    expect(Math.max(0, transformMedian - legacyMedian)).toBeLessThanOrEqual(25);
    expect(Math.max(0, transformP95 - legacyP95)).toBeLessThanOrEqual(50);
  });

  it('emits a final activity frame only on the transformer-backed session path', async () => {
    const legacyRun = await runHarnessTurn('legacy', FIXTURES[0].latestUserContent);
    const transformRun = await runHarnessTurn('transform_v1', FIXTURES[0].latestUserContent);
    const transformLastEvent = transformRun.events[transformRun.events.length - 1];

    expect(legacyRun.events.some((event) => event.type === 'activity_frame')).toBe(false);
    expect(transformRun.events.some((event) => event.type === 'activity_frame')).toBe(true);
    expect(transformLastEvent?.type).toBe('done');
  });
});

async function collectLatencySamples(
  mode: SessionPipelineMode,
  iterationsPerFixture: number,
  warmupIterations: number,
): Promise<number[]> {
  const samples: number[] = [];
  const totalIterations = iterationsPerFixture + warmupIterations;

  for (const fixture of FIXTURES) {
    for (let index = 0; index < totalIterations; index += 1) {
      const run = await runHarnessTurn(mode, fixture.latestUserContent);
      if (index >= warmupIterations) {
        samples.push(run.firstNonHeartbeatEventMs);
      }
    }
  }

  return samples;
}

async function runHarnessTurn(mode: SessionPipelineMode, latestUserContent: string): Promise<{
  firstNonHeartbeatEventMs: number;
  events: StreamEvent[];
}> {
  const service = buildHarnessService(mode);
  const response = new MockSseResponse();
  const request = makeRequest(latestUserContent);

  await service.processAndStreamChat(request, response as any, { skipPromptPersistence: true });

  if (response.firstNonHeartbeatEventMs === undefined) {
    throw new Error(`Harness did not capture a non-heartbeat SSE event for mode=${mode}`);
  }

  return {
    firstNonHeartbeatEventMs: response.firstNonHeartbeatEventMs,
    events: response.events,
  };
}

function buildHarnessService(mode: SessionPipelineMode): ChatOrchestratorService {
  const chatTransformerService = new ChatTransformerService();

  const httpService = {
    get: jest.fn((url: string) => {
      if (url.endsWith('/api/tools')) {
        return of({
          data: {
            tools: [
              {
                name: 'web_search',
                description: 'Search the web',
                parameters: {},
                capability_tags: ['web'],
              },
              {
                name: 'skill_grounded-web-summary',
                description: 'Summarize grounded web research',
                parameters: {},
                capability_tags: ['skill', 'web'],
              },
            ],
          },
        });
      }

      return of({ data: {} });
    }),
    post: jest.fn(() => {
      const stream = new PassThrough();
      setImmediate(() => {
        stream.write(`${JSON.stringify({ type: 'heartbeat', ts: Date.now() })}\n`);
        stream.write(
          `${JSON.stringify({
            type: 'metadata',
            metadata: {
              modelId: 'openai/gpt-4o',
              isLocal: false,
              durationMs: 4,
            },
          })}\n`,
        );
        stream.write(`${JSON.stringify({ type: 'content', content: 'Hello from the synthetic agent stub.' })}\n`);
        stream.write(`${JSON.stringify({ type: 'done' })}\n`);
        stream.end();
      });
      return of({ data: stream });
    }),
  };

  const chatService = {
    getSession: jest.fn().mockResolvedValue(null),
    resolveSessionPipelineMode: jest.fn().mockResolvedValue(mode),
    upsertSessionControls: jest.fn().mockResolvedValue(undefined),
    getMessages: jest.fn().mockResolvedValue([]),
    getPendingNluClarification: jest.fn().mockResolvedValue(null),
    createMessage: jest.fn().mockResolvedValue(undefined),
  };

  const assistantService = {
    getState: jest.fn().mockResolvedValue({}),
    formatStateForPrompt: jest.fn().mockReturnValue(''),
    ingestUserTurn: jest.fn().mockResolvedValue({ memoryEvents: [], advisoryEvents: [] }),
    queryMemoryForNlu: jest.fn().mockResolvedValue({ promptText: null, memoryEvents: [] }),
    buildTurnAdvisories: jest.fn().mockResolvedValue([]),
  };

  const agentsService = {
    getOptional: jest.fn().mockResolvedValue({
      id: 'default-assistant',
      name: 'RawClaw',
      modelId: 'openai/gpt-4o',
      skills: [],
    }),
  };

  const modelsService = {
    getConfig: jest.fn().mockResolvedValue({ routing: {} }),
  };

  const docsService = {
    getSystemContext: jest.fn().mockResolvedValue('You are RawClaw.'),
  };

  const settingsService = {
    getPayload: jest.fn().mockResolvedValue({
      settings: { chatDefaults: {} },
      workspaceFiles: [],
    }),
  };

  const promptCatalog = {
    resolveAssistantLane: jest.fn((content: string) =>
      content.toLowerCase().includes('search for') ? 'research' : 'conversation',
    ),
    composeChatPrompt: jest.fn().mockReturnValue({
      prompt: 'System prompt.',
      templates: {
        reviewer: null,
        repair: null,
      },
      provenance: {
        promptPackId: 'default',
        promptVersionHash: 'prompt-v1',
        reviewerPromptVersionHash: null,
        workflowPromptIds: [],
      },
    }),
  };

  const gatewayRoutingService = {
    resolveBinding: jest.fn().mockResolvedValue({
      binding: {
        id: 'binding-1',
        sessionId: 'session-1',
        workspaceId: 'default',
        senderIdentifier: 'web',
        surfaceType: 'chat',
        threadKey: null,
        channelKey: null,
        agentId: 'default-assistant',
      },
      routing: null,
    }),
    markRunStarted: jest.fn().mockResolvedValue(undefined),
    markRunFinished: jest.fn().mockResolvedValue(undefined),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    emitToolActivity: jest.fn().mockResolvedValue(undefined),
    emitHealthDegraded: jest.fn().mockResolvedValue(undefined),
  };

  const gatewayControlPlane = {
    createRun: jest.fn().mockResolvedValue(undefined),
    markRunTerminal: jest.fn().mockResolvedValue(undefined),
    markRunHeartbeat: jest.fn().mockResolvedValue(undefined),
    updateRun: jest.fn().mockResolvedValue(undefined),
    captureRoleTraceFromProvenance: jest.fn().mockResolvedValue(undefined),
  };

  const chatNluService = {
    analyzeTurn: jest.fn(async ({ latestUserContent }: { latestUserContent: string }) => ({
      frame: latestUserContent.toLowerCase().includes('search for') ? makeResearchFrame() : makeConversationFrame(),
    })),
  };

  const service = new ChatOrchestratorService(
    httpService as any,
    chatService as any,
    { get: jest.fn((key: string) => (key === 'agentUrl' ? 'http://agent' : undefined)) } as any,
    docsService as any,
    agentsService as any,
    modelsService as any,
    {} as any,
    {
      document: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      message: {
        findFirst: jest.fn(),
      },
    } as any,
    settingsService as any,
    {} as any,
    promptCatalog as any,
    { createProposal: jest.fn().mockResolvedValue(undefined) } as any,
    assistantService as any,
    gatewayRoutingService as any,
    gatewayControlPlane as any,
    chatNluService as any,
    chatTransformerService,
    new EmissionTransformerService(),
    new IntakeTransformerService(),
    new PersistenceTransformerService(chatService as any, chatTransformerService),
    new ContextTransformerService(),
  );

  jest.spyOn(service as any, 'handleDirectActionIfApplicable').mockResolvedValue(false);

  return service;
}

function makeRequest(latestUserContent: string): ChatRequest {
  return {
    session_id: 'session-1',
    workspace_id: 'default',
    sender_identifier: 'web',
    agent_id: 'default-assistant',
    stream: true,
    model: 'openai/gpt-4o',
    messages: [
      {
        role: 'user',
        content: latestUserContent,
      } as ChatMessage,
    ],
  };
}

function makeConversationFrame(): ChatNluFrame {
  return {
    schemaVersion: 1,
    intent: 'conversation',
    recommendedLane: 'conversation',
    confidence: 0.92,
    confidenceState: 'direct',
    source: 'deterministic',
    entities: [],
  };
}

function makeResearchFrame(): ChatNluFrame {
  return {
    schemaVersion: 1,
    intent: 'research',
    recommendedLane: 'research',
    confidence: 0.93,
    confidenceState: 'direct',
    source: 'deterministic',
    entities: [],
  };
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index] ?? 0;
}

class MockSseResponse extends EventEmitter {
  writableEnded = false;
  statusCode = 200;
  headers: Record<string, unknown> = {};
  events: StreamEvent[] = [];
  firstNonHeartbeatEventMs: number | undefined;
  private readonly startedAt = performance.now();
  private buffer = '';

  setHeader(name: string, value: unknown): this {
    this.headers[name] = value;
    return this;
  }

  getHeader(name: string): unknown {
    return this.headers[name];
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(payload: unknown): this {
    this.writableEnded = true;
    this.events.push({ type: 'json', payload });
    return this;
  }

  write(chunk: unknown): boolean {
    this.buffer += String(chunk ?? '');
    this.drainBuffer();
    return true;
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }
    this.writableEnded = true;
    this.drainBuffer();
    return this;
  }

  private drainBuffer(): void {
    const packets = this.buffer.split('\n\n');
    this.buffer = packets.pop() || '';

    for (const packet of packets) {
      const trimmed = packet.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (!payload) {
        continue;
      }
      const event = JSON.parse(payload) as StreamEvent;
      this.events.push(event);
      if (event.type !== 'heartbeat' && this.firstNonHeartbeatEventMs === undefined) {
        this.firstNonHeartbeatEventMs = performance.now() - this.startedAt;
      }
    }
  }
}
