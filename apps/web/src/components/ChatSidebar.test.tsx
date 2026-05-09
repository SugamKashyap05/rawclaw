import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OperatorSnapshot } from '@rawclaw/shared';
import { ChatSidebar } from './ChatSidebar';

const apiGet = vi.fn();
const fetchOperatorSnapshot = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
  },
}));

vi.mock('../lib/operator', () => ({
  fetchOperatorSnapshot: (...args: unknown[]) => fetchOperatorSnapshot(...args),
}));

const EMPTY_SNAPSHOT: OperatorSnapshot = {
  summary: {
    activeAgents: 0,
    activeSessions: 0,
    activeRoutes: 0,
    currentRuns: 0,
    toolEvents: 0,
    memoryEvents: 0,
    degradedCount: 0,
    subagentCount: 0,
  },
  activeAgents: [],
  activeSessions: [],
  currentRuns: [],
  toolActivity: [],
  timeline: [],
  provenance: [],
  subagentTree: [],
  routes: [],
};

function renderSidebar(sessionId = 'session-1') {
  return render(
    <MemoryRouter initialEntries={[`/chat/${sessionId}`]}>
      <Routes>
        <Route path="/chat/:sessionId" element={<ChatSidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ChatSidebar live work panel', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset();
    fetchOperatorSnapshot.mockReset();
    apiGet.mockResolvedValue({
      data: [
        { id: 'session-1', title: 'First session', updatedAt: new Date().toISOString() },
        { id: 'session-2', title: 'Second session', updatedAt: new Date().toISOString() },
      ],
    });
  });

  it('filters the operator snapshot client-side to the active session', async () => {
    fetchOperatorSnapshot.mockResolvedValue({
      ...EMPTY_SNAPSHOT,
      currentRuns: [
        {
          id: 'run-1',
          kind: 'app_builder',
          status: 'running',
          title: 'Builder run',
          sessionId: 'session-1',
        },
        {
          id: 'run-2',
          kind: 'automation',
          status: 'queued',
          title: 'Automation run',
          sessionId: 'session-2',
        },
      ],
      toolActivity: [
        {
          id: 'tool-1',
          timestamp: new Date().toISOString(),
          sessionId: 'session-1',
          toolName: 'web_extract',
          phase: 'result',
          summary: 'page read finished',
          source: 'chat_message',
        },
        {
          id: 'tool-2',
          timestamp: new Date().toISOString(),
          sessionId: 'session-1',
          toolName: 'unknown-tool',
          phase: 'result',
          summary: 'internal helper noise',
          source: 'chat_message',
        },
      ],
      timeline: [
        {
          id: 'timeline-1',
          kind: 'provenance',
          timestamp: new Date().toISOString(),
          summary: 'Answer trace updated',
          sessionId: 'session-1',
        },
        {
          id: 'timeline-2',
          kind: 'review',
          timestamp: new Date().toISOString(),
          summary: 'Output reviewer approved the draft.',
          detail: 'approved',
          sessionId: 'session-1',
        },
      ],
    });

    renderSidebar();

    await screen.findByText('First session');
    await waitFor(() => expect(screen.getByText('App Builder running')).toBeInTheDocument());
    expect(screen.getByText('Page read complete')).toBeInTheDocument();
    expect(screen.queryByText('Automation queued')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown Tool')).not.toBeInTheDocument();
    expect(screen.queryByText('Answer trace updated')).not.toBeInTheDocument();
    expect(screen.queryByText(/approved the draft/i)).not.toBeInTheDocument();
  });

  it('shows the gentle live work failure state when snapshot polling fails', async () => {
    fetchOperatorSnapshot.mockRejectedValue(new Error('snapshot unavailable'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSidebar();

    await screen.findByText('First session');
    await waitFor(() => expect(screen.getByText('Checking on your work...')).toBeInTheDocument());
    consoleSpy.mockRestore();
  });
});
