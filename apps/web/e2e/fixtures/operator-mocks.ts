import { expect, Page } from '@playwright/test';
import type { GatewayEvent, GatewayRouteSummary, OperatorSnapshot, RunActionResult, SystemStatusSnapshot } from '@rawclaw/shared';
import {
  makeRecentGatewayEvents,
  makeRunActionResult,
  makeSystemStatus,
} from './operator-fixtures';

type OperatorHarnessOptions = {
  snapshotSequence: OperatorSnapshot[];
  recentGatewayEvents?: GatewayEvent[];
  systemStatus?: SystemStatusSnapshot;
  streamHeartbeat?: boolean;
  runActionResults?: {
    cancel?: RunActionResult;
    retry?: RunActionResult;
  };
};

export async function mountOperatorHarness(page: Page, options: OperatorHarnessOptions): Promise<void> {
  const snapshots = [...options.snapshotSequence];
  const defaultRecentEvents = options.recentGatewayEvents || makeRecentGatewayEvents();
  const systemStatus = options.systemStatus || makeSystemStatus();
  const streamHeartbeat = options.streamHeartbeat ?? true;
  const actionResults = options.runActionResults || {};

  await page.addInitScript(() => {
    localStorage.setItem('rawclaw_access_token', 'e2e-token');
    localStorage.setItem('rawclaw_session_id', 'rawclaw-client');
  });

  await page.route('**/api/auth/bootstrap/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        initialized: true,
        needsSetup: false,
        workspaceFiles: {
          user: true,
          soul: true,
          memory: true,
          tools: true,
        },
      }),
    });
  });

  await page.route('**/api/auth/token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'e2e-token' }),
    });
  });

  await page.route('**/api/system/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(systemStatus),
    });
  });

  await page.route('**/api/operator/snapshot**', async (route) => {
    const next = snapshots.length > 1 ? snapshots.shift()! : snapshots[0];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(next),
    });
  });

  await page.route('**/api/gateway/routes', async (route) => {
    const snapshot = snapshots[0];
    const summary: GatewayRouteSummary = {
      activeSessions: snapshot.activeSessions.length,
      activeRoutes: snapshot.routes.length,
      inflightRuns: snapshot.currentRuns.filter((run) => run.status === 'running').length,
      degradedRoutes: snapshot.summary.degradedCount,
      activeSubagents: snapshot.summary.subagentCount,
      activeAutomationJobs: snapshot.currentRuns.filter((run) => run.kind === 'automation').length,
      inflightAutomationRuns: snapshot.currentRuns.filter((run) => run.kind === 'automation' && run.status === 'running').length,
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        routes: snapshot.routes,
        summary,
      }),
    });
  });

  await page.route('**/api/gateway/events/recent**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: defaultRecentEvents }),
    });
  });

  await page.route('**/api/gateway/events/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: streamHeartbeat
        ? `data: ${JSON.stringify({ type: 'heartbeat', timestamp: '2026-04-27T10:08:00.000Z' })}\n\n`
        : '',
    });
  });

  await page.route('**/api/operator/runs/*/cancel', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        actionResults.cancel
        || makeRunActionResult('cancel_run', extractTargetId(route.request().url())),
      ),
    });
  });

  await page.route('**/api/operator/runs/*/retry', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        actionResults.retry
        || makeRunActionResult('retry_run', extractTargetId(route.request().url()), {
          replacementRunId: 'replacement-run-1',
        }),
      ),
    });
  });
}

export async function openOperator(page: Page): Promise<void> {
  await page.goto('/operator');
  await expect(page.getByRole('heading', { name: 'Unified Operator Surface' })).toBeVisible();
}

function extractTargetId(url: string): string {
  const match = url.match(/\/operator\/runs\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : 'unknown-run';
}
