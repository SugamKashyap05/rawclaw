import * as fs from 'node:fs';
import * as path from 'node:path';
import { GatewayRunRecord, RoleTraceSnapshot, ShortTermMemoryEntry } from '@rawclaw/shared';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { PrismaService } from './prisma.service';

describe('KnowledgeGraphService', () => {
  const dbPath = path.resolve(process.cwd(), 'apps/api/prisma/phase3-knowledge-graph.spec.db');
  let prisma: PrismaService;
  let gatewayEvents: { publish: jest.Mock };
  let service: KnowledgeGraphService;

  beforeAll(async () => {
    fs.rmSync(dbPath, { force: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    gatewayEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    service = new KnowledgeGraphService(prisma, gatewayEvents as any);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    fs.rmSync(dbPath, { force: true });
  });

  it('ingests terminal run lineage into SQLite-backed graph tables', async () => {
    const run: GatewayRunRecord = {
      id: 'run-kg-1',
      kind: 'foreground_chat',
      status: 'completed',
      sessionId: 'session-kg',
      bindingId: 'binding-kg',
      agentId: 'main',
      parentSessionId: null,
      parentRunId: null,
      role: null,
      workerId: 'worker-kg',
      queueType: null,
      jobId: null,
      summary: 'Chennai Super Kings are 6th with 6 points.',
      error: null,
      metadata: { jobId: 'job-kg' },
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    const roleTrace: RoleTraceSnapshot = {
      sessionId: 'session-kg',
      runId: run.id,
      bindingId: 'binding-kg',
      agentId: 'main',
      parentSessionId: null,
      parentRunId: null,
      workerId: 'worker-kg',
      roleTrace: {
        scout: {
          selectedUrls: ['https://www.iplt20.com/matches/points-table'],
          searchQueries: ['IPL 2026 Chennai Super Kings points table wins losses'],
        },
        analyst: {
          mode: 'exact_answer',
        },
      },
      provenanceTrace: {
        sources: ['https://www.iplt20.com/matches/points-table'],
      },
      source: 'foreground',
      updatedAt: new Date().toISOString(),
    };

    const memory: ShortTermMemoryEntry[] = [
      {
        key: 'memory-kg-1',
        sessionId: 'session-kg',
        runId: run.id,
        subagentId: null,
        kind: 'selected_urls',
        value: { selectedUrls: ['https://www.iplt20.com/matches/points-table'] },
        graphNodeIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const ingestion = await service.ingestTerminalRun({ run, roleTrace, memory });
    const graph = await service.getRunGraph(run.id);

    expect(ingestion.status).toBe('completed');
    expect(graph.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(['session', 'run', 'agent', 'url', 'document', 'entity', 'memory_item', 'task']),
    );
    expect(graph.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining(['generated_by', 'answered_by', 'cites', 'supports', 'stored_as_memory']),
    );
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'knowledge_graph.ingested',
      runId: run.id,
    }));
  });
});
