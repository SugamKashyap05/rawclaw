import {
  AutomationJob,
  AutomationRun,
  BindingRule,
  GatewayEvent,
  GatewayRouteDetail,
  GatewayRouteSummary,
  GatewayStreamEvent,
  SessionBinding,
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
