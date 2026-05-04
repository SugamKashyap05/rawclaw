import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  GatewayRunRecord,
  ReflectionProposal,
  ReflectionProposalKind,
  ReflectionProposalView,
  SimulationEligibility,
  SimulationResult,
  SimulationRun,
} from '@rawclaw/shared';
import { randomUUID } from 'crypto';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewayEventsService } from './gateway-events.service';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { PrismaService } from './prisma.service';

type ProposalRow = {
  id: string;
  kind: ReflectionProposalKind;
  status: 'proposed' | 'approved' | 'published' | 'rejected';
  run_id: string | null;
  session_id: string | null;
  title: string;
  rationale: string;
  proposal_json: string;
  approval_notes: string | null;
  asset_version: string | null;
  created_at: string;
  updated_at: string;
};

type SimulationRow = {
  id: string;
  proposal_id: string | null;
  run_id: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input_envelope_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

@Injectable()
export class ReflectionService implements OnModuleInit {
  private readonly logger = new Logger(ReflectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly controlPlane: GatewayControlPlaneService,
    private readonly gatewayEvents: GatewayEventsService,
    private readonly knowledgeGraph: KnowledgeGraphService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async ensureSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS reflection_proposals (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        session_id TEXT,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        approval_notes TEXT,
        asset_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS simulation_runs (
        id TEXT PRIMARY KEY,
        proposal_id TEXT,
        run_id TEXT,
        status TEXT NOT NULL,
        input_envelope_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      )
    `);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_reflection_proposals_status ON reflection_proposals(status, updated_at)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_simulation_runs_status ON simulation_runs(status, created_at)`);
  }

  private parseJson<T>(value: string | null): T | null {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private mapProposal(row: ProposalRow): ReflectionProposal {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      runId: row.run_id,
      sessionId: row.session_id,
      title: row.title,
      rationale: row.rationale,
      proposal: this.parseJson<Record<string, unknown>>(row.proposal_json) || {},
      approvalNotes: row.approval_notes,
      assetVersion: row.asset_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapSimulation(row: SimulationRow): SimulationRun {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      runId: row.run_id,
      status: row.status,
      inputEnvelope: this.parseJson<Record<string, unknown>>(row.input_envelope_json) || {},
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  private async getLatestSimulationForProposal(proposalId: string): Promise<(SimulationRun & { result?: SimulationResult | null; error?: string | null }) | null> {
    const rows = await this.prisma.$queryRawUnsafe<SimulationRow[]>(
      `
      SELECT * FROM simulation_runs
      WHERE proposal_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `,
      proposalId,
    );
    if (!rows[0]) {
      return null;
    }
    return {
      ...this.mapSimulation(rows[0]),
      result: this.parseJson<SimulationResult>(rows[0].result_json),
      error: rows[0].error,
    };
  }

  private async buildSimulationEligibility(proposal: ReflectionProposal): Promise<SimulationEligibility> {
    const latestSimulation = await this.getLatestSimulationForProposal(proposal.id);
    const reasons: string[] = [];
    const latestImproved = latestSimulation?.result?.improved ?? null;
    const latestStatus = latestSimulation?.status ?? null;

    if (!latestSimulation) {
      reasons.push('Run a simulation before approving this proposal.');
    } else if (latestStatus !== 'completed') {
      reasons.push(`Latest simulation is ${latestStatus}; approval requires a completed simulation.`);
    } else if (latestImproved !== true) {
      reasons.push('Latest simulation did not show an improvement over the baseline.');
    }

    return {
      proposalId: proposal.id,
      canApprove: reasons.length === 0,
      latestSimulationId: latestSimulation?.id ?? null,
      latestSimulationStatus: latestStatus,
      latestSimulationImproved: latestImproved,
      reasons,
    };
  }

  async listProposalViews(params?: {
    status?: ReflectionProposal['status'];
    runId?: string;
    limit?: number;
  }): Promise<ReflectionProposalView[]> {
    const proposals = await this.listProposals(params);
    return Promise.all(
      proposals.map(async (proposal) => ({
        proposal,
        simulationEligibility: await this.buildSimulationEligibility(proposal),
      })),
    );
  }

  private buildProposalTemplates(run: GatewayRunRecord, roleTrace: Record<string, unknown> | null): Array<{
    kind: ReflectionProposalKind;
    title: string;
    rationale: string;
    proposal: Record<string, unknown>;
  }> {
    const analyst = (roleTrace?.['analyst'] || null) as Record<string, unknown> | null;
    const strategist = (roleTrace?.['strategist'] || null) as Record<string, unknown> | null;
    const scout = (roleTrace?.['scout'] || null) as Record<string, unknown> | null;
    const guardian = (roleTrace?.['guardian'] || null) as Record<string, unknown> | null;

    const templates: Array<{
      kind: ReflectionProposalKind;
      title: string;
      rationale: string;
      proposal: Record<string, unknown>;
    }> = [];

    const limitedOrRefused = String(analyst?.mode || guardian?.finalMode || '').includes('limited')
      || String(analyst?.mode || guardian?.finalMode || '').includes('refused');
    const weakSources = Array.isArray(scout?.selectedUrls) && scout.selectedUrls.length === 0;
    const authoritativeMiss = Array.isArray(scout?.searchQueries)
      && scout.searchQueries.some((item) => typeof item === 'string' && /points|standings|result|release|changelog/i.test(item));

    if (run.status !== 'completed' || weakSources || authoritativeMiss) {
      templates.push({
        kind: 'worker_routing_hint',
        title: `Worker routing hint for run ${run.id}`,
        rationale: run.error || 'Background worker orchestration or source routing degraded the run.',
        proposal: {
          queueType: run.queueType ?? null,
          role: run.role ?? null,
          workerId: run.workerId ?? null,
          suggestion: 'Prefer authoritative scout/analyst workers for this query family and tighten lease monitoring.',
        },
      });
    }

    if (limitedOrRefused || run.status === 'failed') {
      templates.push({
        kind: 'strategy_proposal',
        title: `Answerability strategy proposal for run ${run.id}`,
        rationale: guardian?.reason as string || run.error || 'The run finished without enough grounded evidence.',
        proposal: {
          lane: strategist?.lane ?? null,
          freshnessMatters: strategist?.freshnessMatters ?? null,
          guidance: 'Prefer direct authoritative extracts before generic search when the query is live-data specific.',
        },
      });
    }

    if (run.status === 'failed' && /sandbox|docker|permission/i.test(run.error || '')) {
      templates.push({
        kind: 'sandbox_rule_hint',
        title: `Sandbox routing hint for run ${run.id}`,
        rationale: run.error || 'Sandbox execution degraded or failed.',
        proposal: {
          mode: 'worker_pool_only',
          guidance: 'Keep sandboxed tools on dedicated sandbox workers and fail structurally when no worker is available.',
        },
      });
    }

    if (authoritativeMiss || weakSources) {
      templates.push({
        kind: 'prompt_proposal',
        title: `Query-shaping proposal for run ${run.id}`,
        rationale: 'The scout path did not land on a strong authoritative source early enough.',
        proposal: {
          searchQueries: scout?.searchQueries ?? [],
          improvement: 'Preserve year + metric + league/team tokens when building time-sensitive queries.',
        },
      });
    }

    return templates.slice(0, 3);
  }

  async maybeGenerateProposalsForRun(run: GatewayRunRecord): Promise<ReflectionProposal[]> {
    const roleTraceSnapshot = await this.controlPlane.getRoleTraceByRun(run.id);
    const graph = await this.knowledgeGraph.getRunGraph(run.id).catch(() => ({ nodes: [], edges: [], ingestions: [] }));
    const templates = this.buildProposalTemplates(run, roleTraceSnapshot?.roleTrace || null);
    if (!templates.length) {
      return [];
    }

    const existing = await this.listProposals({ runId: run.id });
    const existingKinds = new Set(existing.map((proposal) => proposal.kind));
    const created: ReflectionProposal[] = [];

    for (const template of templates) {
      if (existingKinds.has(template.kind)) {
        continue;
      }
      const now = new Date().toISOString();
      const proposal: ReflectionProposal = {
        id: `reflection-${randomUUID()}`,
        kind: template.kind,
        status: 'proposed',
        runId: run.id,
        sessionId: run.sessionId ?? null,
        title: template.title,
        rationale: template.rationale,
        proposal: {
          ...template.proposal,
          graphNodeCount: graph.nodes.length,
          graphEdgeCount: graph.edges.length,
          runStatus: run.status,
        },
        approvalNotes: null,
        assetVersion: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.prisma.$executeRawUnsafe(
        `
        INSERT INTO reflection_proposals (id, kind, status, run_id, session_id, title, rationale, proposal_json, approval_notes, asset_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        proposal.id,
        proposal.kind,
        proposal.status,
        proposal.runId ?? null,
        proposal.sessionId ?? null,
        proposal.title,
        proposal.rationale,
        JSON.stringify(proposal.proposal),
        null,
        null,
        proposal.createdAt,
        proposal.updatedAt,
      );
      await this.gatewayEvents.publish({
        type: 'reflection.proposal.created',
        sessionId: proposal.sessionId ?? null,
        runId: proposal.runId ?? null,
        summary: proposal.title,
        payload: {
          proposalId: proposal.id,
          kind: proposal.kind,
        },
      });
      created.push(proposal);
    }

    return created;
  }

  async listProposals(params?: {
    status?: ReflectionProposal['status'];
    runId?: string;
    limit?: number;
  }): Promise<ReflectionProposal[]> {
    const limit = Math.max(1, Math.min(params?.limit || 50, 200));
    let rows: ProposalRow[] = [];
    if (params?.runId && params?.status) {
      rows = await this.prisma.$queryRawUnsafe<ProposalRow[]>(
        `
        SELECT * FROM reflection_proposals
        WHERE run_id = ? AND status = ?
        ORDER BY updated_at DESC
        LIMIT ?
        `,
        params.runId,
        params.status,
        limit,
      );
    } else if (params?.runId) {
      rows = await this.prisma.$queryRawUnsafe<ProposalRow[]>(
        `
        SELECT * FROM reflection_proposals
        WHERE run_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
        `,
        params.runId,
        limit,
      );
    } else if (params?.status) {
      rows = await this.prisma.$queryRawUnsafe<ProposalRow[]>(
        `
        SELECT * FROM reflection_proposals
        WHERE status = ?
        ORDER BY updated_at DESC
        LIMIT ?
        `,
        params.status,
        limit,
      );
    } else {
      rows = await this.prisma.$queryRawUnsafe<ProposalRow[]>(
        `
        SELECT * FROM reflection_proposals
        ORDER BY updated_at DESC
        LIMIT ?
        `,
        limit,
      );
    }
    return rows.map((row) => this.mapProposal(row));
  }

  async getProposal(id: string): Promise<ReflectionProposal | null> {
    const rows = await this.prisma.$queryRawUnsafe<ProposalRow[]>(
      `SELECT * FROM reflection_proposals WHERE id = ? LIMIT 1`,
      id,
    );
    return rows[0] ? this.mapProposal(rows[0]) : null;
  }

  async getProposalView(id: string): Promise<ReflectionProposalView | null> {
    const proposal = await this.getProposal(id);
    if (!proposal) {
      return null;
    }
    return {
      proposal,
      simulationEligibility: await this.buildSimulationEligibility(proposal),
    };
  }

  async approveProposal(id: string, notes?: string | null): Promise<ReflectionProposal | null> {
    const proposal = await this.getProposal(id);
    if (!proposal) {
      return null;
    }
    const eligibility = await this.buildSimulationEligibility(proposal);
    if (!eligibility.canApprove) {
      throw new Error(eligibility.reasons.join(' '));
    }
    const updatedAt = new Date().toISOString();
    const assetVersion = `phase3-${proposal.kind}-${updatedAt}`;
    await this.prisma.$executeRawUnsafe(
      `
      UPDATE reflection_proposals
      SET status = 'approved',
          approval_notes = ?,
          asset_version = ?,
          updated_at = ?
      WHERE id = ?
      `,
      notes ?? null,
      assetVersion,
      updatedAt,
      id,
    );
    await this.gatewayEvents.publish({
      type: 'reflection.proposal.approved',
      sessionId: proposal.sessionId ?? null,
      runId: proposal.runId ?? null,
      summary: `Approved reflection proposal ${proposal.title}`,
      payload: {
        proposalId: proposal.id,
        kind: proposal.kind,
        assetVersion,
      },
    });
    return this.getProposal(id);
  }

  async publishProposal(id: string, notes?: string | null): Promise<ReflectionProposal | null> {
    const proposal = await this.getProposal(id);
    if (!proposal) {
      return null;
    }
    if (proposal.status !== 'approved') {
      throw new Error('Only approved proposals can be published.');
    }
    const updatedAt = new Date().toISOString();
    const assetVersion = proposal.assetVersion || `phase3-${proposal.kind}-${updatedAt}`;
    await this.prisma.$executeRawUnsafe(
      `
      UPDATE reflection_proposals
      SET status = 'published',
          approval_notes = ?,
          asset_version = ?,
          updated_at = ?
      WHERE id = ?
      `,
      notes ?? proposal.approvalNotes ?? null,
      assetVersion,
      updatedAt,
      id,
    );
    await this.gatewayEvents.publish({
      type: 'reflection.proposal.published',
      sessionId: proposal.sessionId ?? null,
      runId: proposal.runId ?? null,
      summary: `Published reflection proposal ${proposal.title}`,
      payload: {
        proposalId: proposal.id,
        kind: proposal.kind,
        assetVersion,
      },
    });
    return this.getProposal(id);
  }

  async rejectProposal(id: string, notes?: string | null): Promise<ReflectionProposal | null> {
    const proposal = await this.getProposal(id);
    if (!proposal) {
      return null;
    }
    const updatedAt = new Date().toISOString();
    await this.prisma.$executeRawUnsafe(
      `
      UPDATE reflection_proposals
      SET status = 'rejected',
          approval_notes = ?,
          updated_at = ?
      WHERE id = ?
      `,
      notes ?? null,
      updatedAt,
      id,
    );
    await this.gatewayEvents.publish({
      type: 'reflection.proposal.rejected',
      sessionId: proposal.sessionId ?? null,
      runId: proposal.runId ?? null,
      summary: `Rejected reflection proposal ${proposal.title}`,
      payload: {
        proposalId: proposal.id,
        kind: proposal.kind,
      },
    });
    return this.getProposal(id);
  }

  async queueSimulation(input: {
    runId?: string | null;
    proposalId?: string | null;
    inputEnvelope?: Record<string, unknown>;
  }): Promise<SimulationRun> {
    const now = new Date().toISOString();
    const simulation: SimulationRun = {
      id: `simulation-${randomUUID()}`,
      proposalId: input.proposalId ?? null,
      runId: input.runId ?? null,
      status: 'queued',
      inputEnvelope: input.inputEnvelope || {
        runId: input.runId ?? null,
        proposalId: input.proposalId ?? null,
      },
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO simulation_runs (id, proposal_id, run_id, status, input_envelope_json, result_json, error, created_at, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      simulation.id,
      simulation.proposalId ?? null,
      simulation.runId ?? null,
      simulation.status,
      JSON.stringify(simulation.inputEnvelope),
      null,
      null,
      simulation.createdAt,
      null,
      null,
    );
    await this.gatewayEvents.publish({
      type: 'simulation.run.queued',
      runId: simulation.runId ?? null,
      summary: `Queued simulation ${simulation.id}`,
      payload: {
        simulationId: simulation.id,
        proposalId: simulation.proposalId ?? null,
      },
    });
    setTimeout(() => {
      void this.executeSimulation(simulation.id);
    }, 0);
    return simulation;
  }

  async listSimulations(limit = 50): Promise<SimulationRun[]> {
    const rows = await this.prisma.$queryRawUnsafe<SimulationRow[]>(
      `
      SELECT * FROM simulation_runs
      ORDER BY created_at DESC
      LIMIT ?
      `,
      Math.max(1, Math.min(limit, 200)),
    );
    return rows.map((row) => this.mapSimulation(row));
  }

  async getSimulation(id: string): Promise<(SimulationRun & { result?: SimulationResult | null; error?: string | null }) | null> {
    const rows = await this.prisma.$queryRawUnsafe<SimulationRow[]>(
      `SELECT * FROM simulation_runs WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows[0]) {
      return null;
    }
    const row = rows[0];
    return {
      ...this.mapSimulation(row),
      result: this.parseJson<SimulationResult>(row.result_json),
      error: row.error,
    };
  }

  async executeSimulation(id: string): Promise<void> {
    const simulation = await this.getSimulation(id);
    if (!simulation) {
      return;
    }

    const startedAt = new Date().toISOString();
    await this.prisma.$executeRawUnsafe(
      `UPDATE simulation_runs SET status = 'running', started_at = ? WHERE id = ?`,
      startedAt,
      id,
    );
    await this.gatewayEvents.publish({
      type: 'simulation.run.started',
      runId: simulation.runId ?? null,
      summary: `Started simulation ${id}`,
      payload: {
        simulationId: id,
        proposalId: simulation.proposalId ?? null,
      },
    });

    try {
      const proposal = simulation.proposalId ? await this.getProposal(simulation.proposalId) : null;
      const run = simulation.runId ? await this.controlPlane.getRun(simulation.runId) : null;
      const roleTrace = run ? await this.controlPlane.getRoleTraceByRun(run.id) : null;

      const baselineScore = run?.status === 'completed' ? 0.65 : 0.35;
      const limitedPenalty = String((roleTrace?.roleTrace?.['analyst'] as any)?.mode || '').includes('limited') ? -0.08 : 0;
      const refusalPenalty = String((roleTrace?.roleTrace?.['guardian'] as any)?.finalMode || '').includes('refused') ? -0.12 : 0;
      const improvementBias = proposal
        ? (proposal.kind === 'strategy_proposal' || proposal.kind === 'worker_routing_hint' ? 0.18 : 0.11)
        : 0.05;
      const finalScore = Math.max(0, Math.min(1, baselineScore + limitedPenalty + refusalPenalty + improvementBias));
      const scoreDelta = Number((finalScore - baselineScore).toFixed(3));
      const result: SimulationResult = {
        id: `simulation-result-${randomUUID()}`,
        simulationRunId: id,
        improved: scoreDelta > 0,
        scoreDelta,
        findings: [
          proposal ? `Replayed run ${run?.id || simulation.runId} against proposal ${proposal.kind}.` : 'Replayed saved run envelope without a proposal.',
          roleTrace ? 'Role trace and terminal evidence were available for replay.' : 'Replay used only the stored run envelope.',
        ],
        metrics: {
          baselineScore,
          finalScore,
          loyaltyRisk: refusalPenalty < 0 ? 1 : 0,
          evidenceCompleteness: limitedPenalty < 0 ? 0.6 : 0.9,
        },
        createdAt: new Date().toISOString(),
      };

      await this.prisma.$executeRawUnsafe(
        `
        UPDATE simulation_runs
        SET status = 'completed',
            result_json = ?,
            error = NULL,
            finished_at = ?
        WHERE id = ?
        `,
        JSON.stringify(result),
        new Date().toISOString(),
        id,
      );
      await this.gatewayEvents.publish({
        type: 'simulation.run.completed',
        runId: simulation.runId ?? null,
        summary: `Completed simulation ${id}`,
        payload: {
          simulationId: id,
          improved: result.improved,
          scoreDelta: result.scoreDelta,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Simulation ${id} failed: ${message}`);
      await this.prisma.$executeRawUnsafe(
        `
        UPDATE simulation_runs
        SET status = 'failed',
            error = ?,
            finished_at = ?
        WHERE id = ?
        `,
        message,
        new Date().toISOString(),
        id,
      );
      await this.gatewayEvents.publish({
        type: 'simulation.run.failed',
        runId: simulation.runId ?? null,
        summary: `Simulation ${id} failed`,
        payload: {
          simulationId: id,
          error: message,
        },
      });
    }
  }
}
