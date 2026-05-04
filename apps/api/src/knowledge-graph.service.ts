import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  GatewayRunRecord,
  GraphIngestionRecord,
  KnowledgeEdge,
  KnowledgeGraphLineageView,
  KnowledgeNode,
  KnowledgeNodeKind,
  RoleTraceSnapshot,
  ShortTermMemoryEntry,
} from '@rawclaw/shared';
import { createHash, randomUUID } from 'crypto';
import { GatewayEventsService } from './gateway-events.service';
import { PrismaService } from './prisma.service';

type GraphRow = {
  id: string;
  kind: string;
  ref: string;
  label: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type EdgeRow = {
  id: string;
  kind: string;
  from_node_id: string;
  to_node_id: string;
  metadata_json: string | null;
  created_at: string;
};

type IngestionRow = {
  id: string;
  run_id: string;
  session_id: string | null;
  status: 'completed' | 'failed';
  error: string | null;
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class KnowledgeGraphService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeGraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayEvents: GatewayEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async ensureSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        ref TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS knowledge_edges (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        run_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS graph_ingestion_records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        session_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        node_count INTEGER NOT NULL DEFAULT 0,
        edge_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_kind ON knowledge_nodes(kind)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_knowledge_edges_run_id ON knowledge_edges(run_id)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_graph_ingestion_status ON graph_ingestion_records(status, updated_at)`);
  }

  private nodeId(kind: KnowledgeNodeKind, ref: string): string {
    const digest = createHash('sha1').update(`${kind}:${ref}`).digest('hex').slice(0, 20);
    return `kg-node-${digest}`;
  }

  private edgeId(kind: string, fromNodeId: string, toNodeId: string, runId?: string | null): string {
    const digest = createHash('sha1')
      .update(`${kind}:${fromNodeId}:${toNodeId}:${runId || ''}`)
      .digest('hex')
      .slice(0, 20);
    return `kg-edge-${digest}`;
  }

  private parseJson(value: string | null): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private mapNode(row: GraphRow): KnowledgeNode {
    return {
      id: row.id,
      kind: row.kind as KnowledgeNodeKind,
      ref: row.ref,
      label: row.label,
      metadata: this.parseJson(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEdge(row: EdgeRow): KnowledgeEdge {
    return {
      id: row.id,
      kind: row.kind as KnowledgeEdge['kind'],
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      metadata: this.parseJson(row.metadata_json),
      createdAt: row.created_at,
    };
  }

  private mapIngestion(row: IngestionRow): GraphIngestionRecord {
    return {
      id: row.id,
      runId: row.run_id,
      sessionId: row.session_id,
      status: row.status,
      error: row.error,
      nodeCount: Number(row.node_count || 0),
      edgeCount: Number(row.edge_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async buildLineage(
    nodes: KnowledgeNode[],
    edges: KnowledgeEdge[],
    context: { runId?: string; sessionId?: string | null },
  ): Promise<KnowledgeGraphLineageView> {
    const supportingSources = Array.from(
      new Set(
        nodes
          .filter((node) => node.kind === 'url' || node.kind === 'document')
          .map((node) => node.ref || node.label)
          .filter(Boolean),
      ),
    );
    const referencedEntities = Array.from(
      new Set(
        nodes
          .filter((node) => node.kind === 'entity')
          .map((node) => node.label)
          .filter(Boolean),
      ),
    );
    const workerIds = new Set<string>();
    for (const edge of edges) {
      const metadataWorkerId = edge.metadata?.workerId;
      if (typeof metadataWorkerId === 'string' && metadataWorkerId.trim()) {
        workerIds.add(metadataWorkerId.trim());
      }
    }
    for (const node of nodes) {
      if (node.kind !== 'agent') {
        continue;
      }
      const workerId = typeof node.metadata?.workerId === 'string' ? node.metadata.workerId : node.label;
      if (workerId) {
        workerIds.add(String(workerId));
      }
    }

    const priorRunIds = new Set<string>();
    if (referencedEntities.length) {
      for (const entity of referencedEntities.slice(0, 8)) {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ ref: string }>>(
          `
          SELECT DISTINCT run.ref as ref
          FROM knowledge_nodes entity
          JOIN knowledge_edges edge ON edge.to_node_id = entity.id OR edge.from_node_id = entity.id
          JOIN knowledge_nodes run ON (
            (edge.from_node_id = run.id OR edge.to_node_id = run.id)
            AND run.kind = 'run'
          )
          WHERE entity.kind = 'entity' AND entity.label = ?
          ORDER BY run.updated_at DESC
          LIMIT 12
          `,
          entity,
        );
        for (const row of rows) {
          if (!row?.ref || row.ref === context.runId) {
            continue;
          }
          priorRunIds.add(row.ref);
        }
      }
    }

    return {
      runId: context.runId ?? null,
      sessionId: context.sessionId ?? null,
      supportingSources,
      workerIds: [...workerIds],
      referencedEntities,
      priorRunIds: [...priorRunIds],
    };
  }

  private async upsertNode(node: KnowledgeNode): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO knowledge_nodes (id, kind, ref, label, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref) DO UPDATE SET
        kind=excluded.kind,
        label=excluded.label,
        metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at
      `,
      node.id,
      node.kind,
      node.ref,
      node.label,
      node.metadata ? JSON.stringify(node.metadata) : null,
      node.createdAt,
      node.updatedAt,
    );
  }

  private async upsertEdge(edge: KnowledgeEdge, runId?: string | null): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      INSERT OR REPLACE INTO knowledge_edges (id, kind, from_node_id, to_node_id, run_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      edge.id,
      edge.kind,
      edge.fromNodeId,
      edge.toNodeId,
      runId ?? null,
      edge.metadata ? JSON.stringify(edge.metadata) : null,
      edge.createdAt,
    );
  }

  private async storeIngestion(record: GraphIngestionRecord): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO graph_ingestion_records (id, run_id, session_id, status, error, node_count, edge_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status=excluded.status,
        error=excluded.error,
        node_count=excluded.node_count,
        edge_count=excluded.edge_count,
        updated_at=excluded.updated_at
      `,
      record.id,
      record.runId,
      record.sessionId ?? null,
      record.status,
      record.error ?? null,
      record.nodeCount,
      record.edgeCount,
      record.createdAt,
      record.updatedAt,
    );
  }

  private collectUrls(snapshot: RoleTraceSnapshot | null, memory: ShortTermMemoryEntry[]): string[] {
    const urls = new Set<string>();
    const scout = (snapshot?.roleTrace?.['scout'] || null) as Record<string, unknown> | null;
    const provenanceSources = Array.isArray(snapshot?.provenanceTrace?.['sources'])
      ? (snapshot?.provenanceTrace?.['sources'] as unknown[])
      : [];

    for (const source of provenanceSources) {
      if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
        urls.add(source);
      }
    }

    const selectedUrls = Array.isArray(scout?.selectedUrls) ? (scout?.selectedUrls as unknown[]) : [];
    for (const value of selectedUrls) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        urls.add(value);
      }
    }

    for (const entry of memory) {
      if (entry.kind !== 'selected_urls') {
        continue;
      }
      const selected = entry.value?.selectedUrls;
      if (Array.isArray(selected)) {
        for (const value of selected) {
          if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
            urls.add(value);
          }
        }
      }
    }

    return [...urls];
  }

  private collectEntities(run: GatewayRunRecord, snapshot: RoleTraceSnapshot | null): string[] {
    const entitySet = new Set<string>();
    const texts = [
      run.summary || '',
      run.error || '',
      JSON.stringify(snapshot?.roleTrace || {}),
      JSON.stringify(snapshot?.provenanceTrace || {}),
    ]
      .filter(Boolean)
      .join(' ');

    const patterns = [
      /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g,
      /\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\b/g,
      /\b(?:RFC|PEP)\s+\d+\b/gi,
      /\bv?\d+\.\d+(?:\.\d+)*\b/g,
      /\b[a-z0-9-]+\.[a-z]{2,}\b/gi,
    ];

    for (const pattern of patterns) {
      for (const match of texts.match(pattern) || []) {
        const normalized = match.trim();
        if (normalized.length >= 3) {
          entitySet.add(normalized);
        }
      }
    }

    return [...entitySet].slice(0, 24);
  }

  async ingestTerminalRun(params: {
    run: GatewayRunRecord;
    roleTrace?: RoleTraceSnapshot | null;
    memory?: ShortTermMemoryEntry[];
  }): Promise<GraphIngestionRecord> {
    const now = new Date().toISOString();
    const ingestionId = `kg-ingest-${randomUUID()}`;
    const memory = params.memory || [];
    const snapshot = params.roleTrace || null;

    try {
      const nodes: KnowledgeNode[] = [];
      const edges: Array<KnowledgeEdge & { runId?: string | null }> = [];
      const registerNode = (kind: KnowledgeNodeKind, ref: string, label: string, metadata?: Record<string, unknown> | null) => {
        const node: KnowledgeNode = {
          id: this.nodeId(kind, ref),
          kind,
          ref,
          label,
          metadata: metadata ?? null,
          createdAt: now,
          updatedAt: now,
        };
        nodes.push(node);
        return node;
      };
      const registerEdge = (
        kind: KnowledgeEdge['kind'],
        fromNodeId: string,
        toNodeId: string,
        metadata?: Record<string, unknown> | null,
      ) => {
        edges.push({
          id: this.edgeId(kind, fromNodeId, toNodeId, params.run.id),
          kind,
          fromNodeId,
          toNodeId,
          metadata: metadata ?? null,
          createdAt: now,
          runId: params.run.id,
        });
      };

      const runNode = registerNode('run', params.run.id, params.run.summary || params.run.id, {
        kind: params.run.kind,
        status: params.run.status,
        role: params.run.role,
        error: params.run.error ?? null,
      });

      if (params.run.sessionId) {
        const sessionNode = registerNode('session', params.run.sessionId, `Session ${params.run.sessionId}`, {
          bindingId: params.run.bindingId ?? null,
        });
        registerEdge('generated_by', sessionNode.id, runNode.id, {
          bindingId: params.run.bindingId ?? null,
        });
      }

      if (params.run.agentId) {
        const agentNode = registerNode('agent', params.run.agentId, params.run.agentId, null);
        registerEdge('answered_by', runNode.id, agentNode.id, {
          workerId: params.run.workerId ?? null,
        });
      }

      if (params.run.parentRunId) {
        const parentNode = registerNode('run', params.run.parentRunId, params.run.parentRunId, {
          sessionId: params.run.parentSessionId ?? null,
        });
        registerEdge('delegated_to', parentNode.id, runNode.id, null);
      }

      const urls = this.collectUrls(snapshot, memory);
      for (const url of urls) {
        const urlNode = registerNode('url', url, url, null);
        const documentNode = registerNode('document', `document:${url}`, url.replace(/^https?:\/\//i, ''), {
          url,
        });
        registerEdge('derived_from', documentNode.id, urlNode.id, null);
        registerEdge('cites', runNode.id, documentNode.id, null);
        registerEdge('supports', documentNode.id, runNode.id, {
          reason: 'source_url',
        });
      }

      for (const entity of this.collectEntities(params.run, snapshot)) {
        const entityNode = registerNode('entity', entity.toLowerCase(), entity, null);
        registerEdge('mentions', runNode.id, entityNode.id, null);
      }

      if (params.run.metadata && typeof params.run.metadata === 'object') {
        const taskId = String((params.run.metadata as Record<string, unknown>).jobId || '').trim();
        if (taskId) {
          const taskNode = registerNode('task', taskId, taskId, params.run.metadata);
          registerEdge('derived_from', runNode.id, taskNode.id, null);
        }
      }

      for (const entry of memory) {
        const memoryNode = registerNode('memory_item', entry.key, `${entry.kind}:${entry.key.slice(0, 8)}`, {
          kind: entry.kind,
          value: entry.value,
        });
        registerEdge('stored_as_memory', runNode.id, memoryNode.id, {
          memoryKind: entry.kind,
        });
      }

      const dedupedNodes = new Map(nodes.map((node) => [node.id, node]));
      const dedupedEdges = new Map(edges.map((edge) => [edge.id, edge]));

      for (const node of dedupedNodes.values()) {
        await this.upsertNode(node);
      }
      for (const edge of dedupedEdges.values()) {
        await this.upsertEdge(edge, edge.runId ?? params.run.id);
      }

      const record: GraphIngestionRecord = {
        id: ingestionId,
        runId: params.run.id,
        sessionId: params.run.sessionId ?? null,
        status: 'completed',
        error: null,
        nodeCount: dedupedNodes.size,
        edgeCount: dedupedEdges.size,
        createdAt: now,
        updatedAt: now,
      };
      await this.storeIngestion(record);
      await this.gatewayEvents.publish({
        type: 'knowledge_graph.ingested',
        sessionId: params.run.sessionId ?? null,
        bindingId: params.run.bindingId ?? null,
        runId: params.run.id,
        agentId: params.run.agentId ?? null,
        parentSessionId: params.run.parentSessionId ?? null,
        parentRunId: params.run.parentRunId ?? null,
        summary: `Knowledge graph updated for run ${params.run.id}`,
        payload: {
          nodeCount: record.nodeCount,
          edgeCount: record.edgeCount,
          workerId: params.run.workerId ?? null,
        },
      });
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Knowledge graph ingestion failed for run ${params.run.id}: ${message}`);
      const record: GraphIngestionRecord = {
        id: ingestionId,
        runId: params.run.id,
        sessionId: params.run.sessionId ?? null,
        status: 'failed',
        error: message,
        nodeCount: 0,
        edgeCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await this.storeIngestion(record);
      await this.gatewayEvents.publish({
        type: 'knowledge_graph.failed',
        sessionId: params.run.sessionId ?? null,
        bindingId: params.run.bindingId ?? null,
        runId: params.run.id,
        agentId: params.run.agentId ?? null,
        parentSessionId: params.run.parentSessionId ?? null,
        parentRunId: params.run.parentRunId ?? null,
        summary: `Knowledge graph ingestion failed for run ${params.run.id}`,
        payload: {
          error: message,
        },
      });
      return record;
    }
  }

  async listRecentIngestions(limit = 25): Promise<GraphIngestionRecord[]> {
    const rows = await this.prisma.$queryRawUnsafe<IngestionRow[]>(
      `
      SELECT id, run_id, session_id, status, error, node_count, edge_count, created_at, updated_at
      FROM graph_ingestion_records
      ORDER BY updated_at DESC
      LIMIT ?
      `,
      Math.max(1, Math.min(limit, 100)),
    );
    return rows.map((row) => this.mapIngestion(row));
  }

  async getRunGraph(runId: string): Promise<{
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    ingestions: GraphIngestionRecord[];
    lineage: KnowledgeGraphLineageView;
  }> {
    const edgeRows = await this.prisma.$queryRawUnsafe<EdgeRow[]>(
      `
      SELECT id, kind, from_node_id, to_node_id, metadata_json, created_at
      FROM knowledge_edges
      WHERE run_id = ?
      ORDER BY created_at DESC
      `,
      runId,
    );
    const nodeIds = new Set<string>();
    for (const row of edgeRows) {
      nodeIds.add(row.from_node_id);
      nodeIds.add(row.to_node_id);
    }
    const nodes: KnowledgeNode[] = [];
    for (const nodeId of nodeIds) {
      const rows = await this.prisma.$queryRawUnsafe<GraphRow[]>(
        `
        SELECT id, kind, ref, label, metadata_json, created_at, updated_at
        FROM knowledge_nodes
        WHERE id = ?
        LIMIT 1
        `,
        nodeId,
      );
      if (rows[0]) {
        nodes.push(this.mapNode(rows[0]));
      }
    }

    const ingestions = await this.prisma.$queryRawUnsafe<IngestionRow[]>(
      `
      SELECT id, run_id, session_id, status, error, node_count, edge_count, created_at, updated_at
      FROM graph_ingestion_records
      WHERE run_id = ?
      ORDER BY updated_at DESC
      `,
      runId,
    );

    const graph = {
      nodes,
      edges: edgeRows.map((row) => this.mapEdge(row)),
      ingestions: ingestions.map((row) => this.mapIngestion(row)),
      lineage: await this.buildLineage(nodes, edgeRows.map((row) => this.mapEdge(row)), {
        runId,
        sessionId: ingestions[0]?.session_id ?? null,
      }),
    };
    return graph;
  }

  async search(params: {
    runId?: string;
    sessionId?: string;
    entity?: string;
    url?: string;
    limit?: number;
  }): Promise<{
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    ingestions: GraphIngestionRecord[];
    lineage: KnowledgeGraphLineageView;
  }> {
    if (params.runId) {
      return this.getRunGraph(params.runId);
    }

    const limit = Math.max(1, Math.min(params.limit || 25, 100));
    const refs: string[] = [];
    if (params.entity) {
      refs.push(`%${params.entity.toLowerCase()}%`);
    }
    if (params.url) {
      refs.push(`%${params.url}%`);
    }
    if (params.sessionId) {
      refs.push(params.sessionId);
    }

    let nodeRows: GraphRow[] = [];
    if (params.entity) {
      nodeRows = await this.prisma.$queryRawUnsafe<GraphRow[]>(
        `
        SELECT id, kind, ref, label, metadata_json, created_at, updated_at
        FROM knowledge_nodes
        WHERE kind = 'entity' AND (ref LIKE ? OR label LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
        `,
        `%${params.entity.toLowerCase()}%`,
        `%${params.entity}%`,
        limit,
      );
    } else if (params.url) {
      nodeRows = await this.prisma.$queryRawUnsafe<GraphRow[]>(
        `
        SELECT id, kind, ref, label, metadata_json, created_at, updated_at
        FROM knowledge_nodes
        WHERE kind IN ('url', 'document') AND (ref LIKE ? OR label LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
        `,
        `%${params.url}%`,
        `%${params.url}%`,
        limit,
      );
    } else if (params.sessionId) {
      nodeRows = await this.prisma.$queryRawUnsafe<GraphRow[]>(
        `
        SELECT id, kind, ref, label, metadata_json, created_at, updated_at
        FROM knowledge_nodes
        WHERE kind = 'session' AND ref = ?
        LIMIT ?
        `,
        params.sessionId,
        limit,
      );
    } else {
      nodeRows = await this.prisma.$queryRawUnsafe<GraphRow[]>(
        `
        SELECT id, kind, ref, label, metadata_json, created_at, updated_at
        FROM knowledge_nodes
        ORDER BY updated_at DESC
        LIMIT ?
        `,
        limit,
      );
    }

    const nodeIds = nodeRows.map((row) => row.id);
    const edges: KnowledgeEdge[] = [];
    for (const nodeId of nodeIds) {
      const edgeRows = await this.prisma.$queryRawUnsafe<EdgeRow[]>(
        `
        SELECT id, kind, from_node_id, to_node_id, metadata_json, created_at
        FROM knowledge_edges
        WHERE from_node_id = ? OR to_node_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        `,
        nodeId,
        nodeId,
        limit,
      );
      for (const row of edgeRows) {
        edges.push(this.mapEdge(row));
      }
    }

    const mappedNodes = nodeRows.map((row) => this.mapNode(row));
    const mappedEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];
    return {
      nodes: mappedNodes,
      edges: mappedEdges,
      ingestions: await this.listRecentIngestions(limit),
      lineage: await this.buildLineage(mappedNodes, mappedEdges, {
        runId: params.runId,
        sessionId: params.sessionId ?? null,
      }),
    };
  }
}
