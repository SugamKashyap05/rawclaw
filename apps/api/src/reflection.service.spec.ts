import * as fs from 'node:fs';
import * as path from 'node:path';
import { GatewayRunRecord } from '@rawclaw/shared';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { PrismaService } from './prisma.service';
import { ReflectionService } from './reflection.service';

describe('ReflectionService', () => {
  const dbPath = path.resolve(process.cwd(), 'apps/api/prisma/phase3-reflection.spec.db');
  let prisma: PrismaService;
  let gatewayEvents: { publish: jest.Mock };
  let knowledgeGraph: KnowledgeGraphService;
  let controlPlane: any;
  let service: ReflectionService;

  beforeAll(async () => {
    fs.rmSync(dbPath, { force: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    gatewayEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    knowledgeGraph = new KnowledgeGraphService(prisma, gatewayEvents as any);
    await knowledgeGraph.onModuleInit();
    controlPlane = {
      getRoleTraceByRun: jest.fn().mockResolvedValue({
        roleTrace: {
          strategist: { lane: 'research', freshnessMatters: true },
          scout: {
            selectedUrls: [],
            searchQueries: ['IPL 2026 Chennai Super Kings points table wins losses'],
          },
          analyst: { mode: 'exact_answer' },
          guardian: { finalMode: 'approved_answer', reason: 'improved routing candidate' },
        },
      }),
      getRun: jest.fn(),
    };
    service = new ReflectionService(prisma, controlPlane, gatewayEvents as any, knowledgeGraph);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    fs.rmSync(dbPath, { force: true });
  });

  it('creates approval-gated proposals and records simulation results', async () => {
    const run: GatewayRunRecord = {
      id: 'run-reflect-1',
      kind: 'foreground_chat',
      status: 'failed',
      sessionId: 'session-reflect',
      bindingId: 'binding-reflect',
      agentId: 'main',
      parentSessionId: null,
      parentRunId: null,
      role: null,
      workerId: 'worker-reflect',
      queueType: 'subagent',
      jobId: 'job-reflect',
      summary: 'Could not verify a strong final answer.',
      error: 'Search results were weak and extraction failed.',
      metadata: { lane: 'research' },
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    controlPlane.getRun.mockResolvedValue(run);

    const proposals = await service.maybeGenerateProposalsForRun(run);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.map((proposal) => proposal.kind)).toEqual(
      expect.arrayContaining(['worker_routing_hint', 'strategy_proposal']),
    );

    const simulation = await service.queueSimulation({
      runId: run.id,
      proposalId: proposals[0].id,
      inputEnvelope: { runId: run.id, proposalId: proposals[0].id },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const storedSimulation = await service.getSimulation(simulation.id);

    expect(storedSimulation?.status).toBe('completed');
    expect(storedSimulation?.result).toEqual(
      expect.objectContaining({
        simulationRunId: simulation.id,
      }),
    );

    const approved = await service.approveProposal(proposals[0].id, 'Operator approved for rollout.');
    expect(approved?.status).toBe('approved');
    expect(approved?.assetVersion).toContain('phase3-');

    const published = await service.publishProposal(proposals[0].id, 'Operator published the tested change.');
    expect(published?.status).toBe('published');
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reflection.proposal.created',
    }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reflection.proposal.approved',
    }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reflection.proposal.published',
    }));
    expect(gatewayEvents.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'simulation.run.completed',
    }));
  });
});
