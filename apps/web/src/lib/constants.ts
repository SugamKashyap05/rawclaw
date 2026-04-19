import { SystemStatusSnapshot } from '@rawclaw/shared';

export const DEFAULT_SYSTEM_STATUS: SystemStatusSnapshot = {
  services: {
    api: 'down',
    agent: 'down',
    redis: 'down',
    chroma: 'down',
    database: 'down',
  },
  websocket: { connected: false },
  git: { branch: 'unknown', lastCommit: null },
  counts: { agents: 0, mcpServers: 0, pendingTasks: 0 },
  updatedAt: new Date(0).toISOString(),
};