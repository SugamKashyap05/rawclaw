import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { SystemStatusSnapshot, ToolConfirmation } from '@rawclaw/shared';

interface SystemPollerData {
  status: SystemStatusSnapshot | null;
  pendingConfirmations: ToolConfirmation[];
  refresh: () => Promise<void>;
  isRefreshing: boolean;
}

const EMPTY_STATUS: SystemStatusSnapshot = {
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

/**
 * Centralized polling hook for Chat view to avoid multiple scattered intervals.
 * Polls for system status and pending tool confirmations.
 */
export function useSystemPoller(sessionId?: string, intervalMs = 3000): SystemPollerData {
  const [status, setStatus] = useState<SystemStatusSnapshot>(EMPTY_STATUS);
  const [pendingConfirmations, setPendingConfirmations] = useState<ToolConfirmation[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeSessionRef = useRef<string | undefined>(sessionId);

  // keep ref up to date to avoid extra interval closures
  useEffect(() => {
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  const fetchData = async () => {
    try {
      setIsRefreshing(true);
      const [statusRes, confRes] = await Promise.all([
        api.get<SystemStatusSnapshot>('/system/status').catch(() => null),
        activeSessionRef.current 
          ? api.get<ToolConfirmation[]>(`/tools/confirm?sessionId=${activeSessionRef.current}`).catch(() => null)
          : Promise.resolve(null)
      ]);

      if (statusRes?.data) {
        setStatus(statusRes.data);
      } else if (!statusRes) {
        // Fallback for failed network
        setStatus((cur) => ({
          ...cur,
          services: { ...cur.services, api: 'down' },
          websocket: { connected: false }
        }));
      }

      if (confRes?.data) {
        setPendingConfirmations(confRes.data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      if (!mounted) return;
      await fetchData();
    };

    void poll();
    const timer = window.setInterval(poll, intervalMs);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return { status, pendingConfirmations, refresh: fetchData, isRefreshing };
}
