import { GatewayEvent, GatewayHeartbeatEvent, GatewayRouteSummary, GatewayStreamEvent, SessionBinding } from '@rawclaw/shared';

export const EMPTY_GATEWAY_SUMMARY: GatewayRouteSummary = {
  activeSessions: 0,
  activeRoutes: 0,
  inflightRuns: 0,
  degradedRoutes: 0,
  activeSubagents: 0,
  activeAutomationJobs: 0,
  inflightAutomationRuns: 0,
};

export function mergeGatewayEvents(current: GatewayEvent[], incoming: GatewayEvent[], limit = 80): GatewayEvent[] {
  const merged = [...current];
  const knownIds = new Set(current.map((event) => event.id));

  for (const event of incoming) {
    if (!event?.id || knownIds.has(event.id)) {
      continue;
    }
    knownIds.add(event.id);
    merged.push(event);
  }

  return merged
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, limit);
}

export function summarizeGatewayRoutes(routes: SessionBinding[]): GatewayRouteSummary {
  return {
    activeSessions: new Set(routes.map((route) => route.sessionId)).size,
    activeRoutes: routes.length,
    inflightRuns: routes.filter((route) => route.status === 'running').length,
    degradedRoutes: routes.filter((route) => route.status === 'error' || !!route.lastError).length,
    activeSubagents: routes.filter((route) => !!route.parentSessionId).length,
    activeAutomationJobs: 0,
    inflightAutomationRuns: 0,
  };
}

export function isGatewayHeartbeat(event: GatewayStreamEvent): event is GatewayHeartbeatEvent {
  return event.type === 'heartbeat';
}

export function shouldRefreshRoutesForEvent(event: GatewayEvent): boolean {
  return [
    'session.lifecycle',
    'run.started',
    'run.heartbeat',
    'run.finished',
    'run.failed',
    'routing.resolved',
    'routing.conflict',
    'health.degraded',
    'subagent.spawned',
    'subagent.completed',
    'subagent.failed',
    'subagent.queued',
    'subagent.announced_back',
    'automation.job.lifecycle',
    'automation.run.queued',
    'automation.run.started',
    'automation.run.heartbeat',
    'automation.run.completed',
    'automation.run.failed',
  ].includes(event.type);
}

export function isImportantDesktopAlert(event: GatewayEvent): boolean {
  return event.type === 'run.failed'
    || event.type === 'health.degraded'
    || event.type === 'subagent.completed'
    || event.type === 'subagent.failed'
    || event.type === 'automation.run.failed'
    || event.type === 'automation.run.completed';
}

export function buildGatewayAlertRoute(event: GatewayEvent): string {
  if (event.bindingId) {
    return `/gateway?route=${encodeURIComponent(event.bindingId)}`;
  }
  if (event.sessionId) {
    return `/gateway?session=${encodeURIComponent(event.sessionId)}`;
  }
  return '/gateway';
}

export function publishDesktopGatewayAlert(event: GatewayEvent): void {
  if (!isImportantDesktopAlert(event)) {
    return;
  }

  if (typeof window === 'undefined' || window.parent === window) {
    return;
  }

  window.parent.postMessage(
    {
      source: 'rawclaw-web',
      type: 'gateway-runtime-alert',
      title: desktopAlertTitle(event),
      body: event.summary || fallbackSummary(event),
      routePath: buildGatewayAlertRoute(event),
    },
    '*',
  );
}

function desktopAlertTitle(event: GatewayEvent): string {
  if (event.type === 'run.failed') return 'Gateway Run Failed';
  if (event.type === 'health.degraded') return 'Gateway Health Degraded';
  if (event.type === 'subagent.completed') return 'Subagent Completed';
  if (event.type === 'subagent.failed') return 'Subagent Failed';
  if (event.type === 'automation.run.completed') return 'Automation Run Completed';
  if (event.type === 'automation.run.failed') return 'Automation Run Failed';
  return 'Gateway Alert';
}

function fallbackSummary(event: GatewayEvent): string {
  if (event.type === 'run.failed') return 'A gateway run failed and needs operator attention.';
  if (event.type === 'health.degraded') return 'The gateway reported a degraded health signal.';
  if (event.type === 'subagent.completed') return 'A delegated subagent run completed.';
  if (event.type === 'subagent.failed') return 'A delegated subagent run failed.';
  if (event.type === 'automation.run.completed') return 'A gateway automation run completed.';
  if (event.type === 'automation.run.failed') return 'A gateway automation run failed.';
  return 'A new gateway event needs attention.';
}
