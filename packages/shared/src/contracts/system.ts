export interface SystemStatusSnapshot {
  services: {
    api: 'ok' | 'degraded' | 'down';
    agent: 'ok' | 'down';
    redis: 'ok' | 'down';
    chroma: 'ok' | 'down';
    database: 'ok' | 'down';
  };
  websocket: {
    connected: boolean;
  };
  git: {
    branch: string;
    lastCommit?: string | null;
  };
  counts: {
    agents: number;
    mcpServers: number;
    pendingTasks: number;
  };
  updatedAt: string;
}
