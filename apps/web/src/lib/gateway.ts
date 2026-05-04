import {
  AutomationJob,
  AutomationRun,
  BindingRule,
  GraphIngestionRecord,
  GatewayEvent,
  KnowledgeGraphLineageView,
  GatewayRouteDetail,
  GatewayRouteSummary,
  GatewayStreamEvent,
  KnowledgeEdge,
  KnowledgeNode,
  QueueJobSummary,
  ReflectionProposal,
  ReflectionProposalView,
  SimulationEligibility,
  SessionBinding,
  SimulationRun,
  WorkerStatusSnapshot,
} from '@rawclaw/shared';
import { AUTH_TOKEN_KEY } from './auth';

type RouteListResponse = {
  routes: SessionBinding[];
  summary: GatewayRouteSummary;
};

type RouteDetailResponse = {
  detail: GatewayRouteDetail | null;
};

type RecentEventsResponse = {
  events: GatewayEvent[];
};

type RuleListResponse = {
  rules: BindingRule[];
};

type AutomationJobListResponse = {
  jobs: AutomationJob[];
};

type AutomationRunListResponse = {
  runs: AutomationRun[];
};

type WorkerListResponse = {
  workers: WorkerStatusSnapshot[];
};

type QueueJobListResponse = {
  jobs: QueueJobSummary[];
};

type KnowledgeGraphResponse = {
  graph: {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    ingestions: GraphIngestionRecord[];
    lineage: KnowledgeGraphLineageView;
  };
};

type GraphIngestionResponse = {
  ingestions: GraphIngestionRecord[];
};

type ReflectionProposalListResponse = {
  proposals: ReflectionProposalView[];
};

type ReflectionProposalResponse = {
  proposal: ReflectionProposalView | null;
};

type SimulationRunListResponse = {
  runs: SimulationRun[];
};

type SimulationRunResponse = {
  run: (SimulationRun & { result?: Record<string, unknown> | null; error?: string | null }) | null;
};

const DEFAULT_SUMMARY: GatewayRouteSummary = {
  activeSessions: 0,
  activeRoutes: 0,
  inflightRuns: 0,
  degradedRoutes: 0,
  activeSubagents: 0,
};

function authHeaders(): HeadersInit {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchGatewayRoutes(): Promise<RouteListResponse> {
  const response = await fetch('/api/gateway/routes', {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway routes (${response.status})`);
  }
  const payload = (await response.json()) as Partial<RouteListResponse>;
  return {
    routes: payload.routes || [],
    summary: payload.summary || DEFAULT_SUMMARY,
  };
}

export async function fetchGatewayRouteDetail(routeId: string): Promise<GatewayRouteDetail | null> {
  const response = await fetch(`/api/gateway/routes/${encodeURIComponent(routeId)}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway route detail (${response.status})`);
  }
  const payload = (await response.json()) as RouteDetailResponse;
  return payload.detail || null;
}

export async function fetchRecentGatewayEvents(limit = 50): Promise<GatewayEvent[]> {
  const response = await fetch(`/api/gateway/events/recent?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway events (${response.status})`);
  }
  const payload = (await response.json()) as RecentEventsResponse;
  return payload.events || [];
}

export async function fetchGatewayRules(): Promise<BindingRule[]> {
  const response = await fetch('/api/gateway/rules', {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway rules (${response.status})`);
  }
  const payload = (await response.json()) as Partial<RuleListResponse>;
  return payload.rules || [];
}

export async function fetchGatewayAutomationJobs(): Promise<AutomationJob[]> {
  const response = await fetch('/api/gateway/automations', {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway automation jobs (${response.status})`);
  }
  const payload = (await response.json()) as Partial<AutomationJobListResponse>;
  return payload.jobs || [];
}

export async function fetchRecentAutomationRuns(limit = 20, jobId?: string): Promise<AutomationRun[]> {
  const search = new URLSearchParams();
  search.set('limit', String(limit));
  if (jobId) {
    search.set('jobId', jobId);
  }
  const response = await fetch(`/api/gateway/automation-runs/recent?${search.toString()}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load automation runs (${response.status})`);
  }
  const payload = (await response.json()) as Partial<AutomationRunListResponse>;
  return payload.runs || [];
}

export async function fetchGatewayWorkers(limit = 25): Promise<WorkerStatusSnapshot[]> {
  const response = await fetch(`/api/gateway/workers/recent?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway workers (${response.status})`);
  }
  const payload = (await response.json()) as Partial<WorkerListResponse>;
  return payload.workers || [];
}

export async function fetchRecentQueueJobs(
  queueType: 'subagent' | 'automation' | 'sandbox' | 'builder',
  limit = 20,
): Promise<QueueJobSummary[]> {
  const response = await fetch(
    `/api/gateway/queues/recent?queueType=${encodeURIComponent(queueType)}&limit=${encodeURIComponent(String(limit))}`,
    {
      headers: authHeaders(),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to load ${queueType} queue jobs (${response.status})`);
  }
  const payload = (await response.json()) as Partial<QueueJobListResponse>;
  return payload.jobs || [];
}

export async function fetchGatewayKnowledgeGraph(params?: {
  runId?: string;
  sessionId?: string;
  entity?: string;
  url?: string;
  limit?: number;
}): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; ingestions: GraphIngestionRecord[]; lineage: KnowledgeGraphLineageView }> {
  const search = new URLSearchParams();
  if (params?.runId) search.set('runId', params.runId);
  if (params?.sessionId) search.set('sessionId', params.sessionId);
  if (params?.entity) search.set('entity', params.entity);
  if (params?.url) search.set('url', params.url);
  if (params?.limit) search.set('limit', String(params.limit));
  const response = await fetch(`/api/gateway/knowledge-graph?${search.toString()}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway knowledge graph (${response.status})`);
  }
  const payload = (await response.json()) as Partial<KnowledgeGraphResponse>;
  return payload.graph || {
    nodes: [],
    edges: [],
    ingestions: [],
    lineage: {
      supportingSources: [],
      workerIds: [],
      referencedEntities: [],
      priorRunIds: [],
    },
  };
}

export async function fetchRecentGraphIngestions(limit = 20): Promise<GraphIngestionRecord[]> {
  const response = await fetch(`/api/gateway/knowledge-graph/ingestions/recent?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load graph ingestions (${response.status})`);
  }
  const payload = (await response.json()) as Partial<GraphIngestionResponse>;
  return payload.ingestions || [];
}

export async function fetchReflectionProposals(params?: {
  status?: 'proposed' | 'approved' | 'published' | 'rejected';
  runId?: string;
  limit?: number;
}): Promise<ReflectionProposalView[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.runId) search.set('runId', params.runId);
  if (params?.limit) search.set('limit', String(params.limit));
  const response = await fetch(`/api/gateway/reflection/proposals?${search.toString()}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load reflection proposals (${response.status})`);
  }
  const payload = (await response.json()) as Partial<ReflectionProposalListResponse>;
  return payload.proposals || [];
}

export async function approveReflectionProposal(id: string, notes?: string): Promise<ReflectionProposal | null> {
  const response = await fetch(`/api/gateway/reflection/proposals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ notes }),
  });
  if (!response.ok) {
    throw new Error(`Failed to approve reflection proposal (${response.status})`);
  }
  const payload = (await response.json()) as Partial<ReflectionProposalResponse>;
  return payload.proposal?.proposal || null;
}

export async function rejectReflectionProposal(id: string, notes?: string): Promise<ReflectionProposal | null> {
  const response = await fetch(`/api/gateway/reflection/proposals/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ notes }),
  });
  if (!response.ok) {
    throw new Error(`Failed to reject reflection proposal (${response.status})`);
  }
  const payload = (await response.json()) as Partial<ReflectionProposalResponse>;
  return payload.proposal?.proposal || null;
}

export async function publishReflectionProposal(id: string, notes?: string): Promise<ReflectionProposal | null> {
  const response = await fetch(`/api/gateway/reflection/proposals/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ notes }),
  });
  if (!response.ok) {
    throw new Error(`Failed to publish reflection proposal (${response.status})`);
  }
  const payload = (await response.json()) as Partial<ReflectionProposalResponse>;
  return payload.proposal?.proposal || null;
}

export async function fetchSimulations(limit = 20): Promise<SimulationRun[]> {
  const response = await fetch(`/api/gateway/simulations?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to load simulations (${response.status})`);
  }
  const payload = (await response.json()) as Partial<SimulationRunListResponse>;
  return payload.runs || [];
}

export function getProposalSimulationEligibility(
  proposal: ReflectionProposalView,
  simulations: SimulationRun[],
): SimulationEligibility {
  const matching = simulations.find((simulation) => simulation.proposalId === proposal.proposal.id);
  return proposal.simulationEligibility || {
    proposalId: proposal.proposal.id,
    canApprove: false,
    latestSimulationId: matching?.id || null,
    latestSimulationStatus: matching?.status || null,
    latestSimulationImproved: null,
    reasons: ['No simulation eligibility was returned by the API.'],
  };
}

export async function queueSimulation(payload: {
  runId?: string | null;
  proposalId?: string | null;
  inputEnvelope?: Record<string, unknown>;
}): Promise<(SimulationRun & { result?: Record<string, unknown> | null; error?: string | null }) | null> {
  const response = await fetch('/api/gateway/simulations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to queue simulation (${response.status})`);
  }
  const created = (await response.json()) as Partial<SimulationRunResponse>;
  return created.run || null;
}

export async function streamGatewayEvents(
  onEvent: (event: GatewayStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/gateway/events/stream', {
    headers: {
      Accept: 'text/event-stream',
      ...authHeaders(),
    },
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to connect gateway event stream (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const lines = chunk
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));

      if (!lines.length) {
        continue;
      }

      const payload = lines
        .map((line) => line.slice(5).trim())
        .join('\n');

      if (!payload) {
        continue;
      }

      try {
        onEvent(JSON.parse(payload) as GatewayStreamEvent);
      } catch {
        continue;
      }
    }
  }
}
