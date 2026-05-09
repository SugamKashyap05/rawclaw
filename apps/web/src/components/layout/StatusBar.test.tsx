import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SystemStatusSnapshot } from '@rawclaw/shared';
import { StatusBar } from './StatusBar';

const baseStatus: SystemStatusSnapshot = {
  services: {
    api: 'down',
    agent: 'down',
    redis: 'down',
    chroma: 'down',
    database: 'down',
  },
  websocket: { connected: false },
  git: { branch: 'main', lastCommit: null },
  counts: { agents: 0, mcpServers: 0, pendingTasks: 0 },
  updatedAt: new Date(0).toISOString(),
};

describe('StatusBar', () => {
  it('shows neutral loading labels before the first health poll completes', () => {
    render(<StatusBar status={baseStatus} isInitializing />);
    expect(screen.getAllByText('loading').length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText('down')).not.toBeInTheDocument();
  });
});
