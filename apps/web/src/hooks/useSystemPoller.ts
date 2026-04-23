import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { ToolConfirmation, TaskRun } from '@rawclaw/shared';

interface SystemPollerData {
  pendingConfirmations: ToolConfirmation[];
  recentRuns: TaskRun[];
  refresh: () => Promise<void>;
  isRefreshing: boolean;
}

/**
 * Centralized polling hook for Chat view to avoid multiple scattered intervals.
 * Polls for system status and pending tool confirmations.
 */
export function useSystemPoller(sessionId?: string, intervalMs = 3000): SystemPollerData {
  const [pendingConfirmations, setPendingConfirmations] = useState<ToolConfirmation[]>([]);
  const [recentRuns, setRecentRuns] = useState<TaskRun[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeSessionRef = useRef<string | undefined>(sessionId);

  // keep ref up to date to avoid extra interval closures
  useEffect(() => {
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  const fetchData = async () => {
    try {
      setIsRefreshing(true);
      const [confRes, runsRes] = await Promise.all([
        activeSessionRef.current 
          ? api.get<ToolConfirmation[]>(`/tools/confirm?sessionId=${activeSessionRef.current}`).catch(() => null)
          : Promise.resolve(null),
        api.get<TaskRun[]>(
          activeSessionRef.current
            ? `/tasks/runs/recent?sessionId=${activeSessionRef.current}`
            : '/tasks/runs/recent'
        ).catch(() => null)
      ]);

      if (confRes?.data) {
        setPendingConfirmations(confRes.data);
      }

      if (runsRes?.data) {
        setRecentRuns(runsRes.data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      // Opt-out if document hidden to save resources
      if (!mounted || document.hidden) return;
      await fetchData();
    };

    void poll();
    const timer = window.setInterval(poll, intervalMs);

    // Also poll on visibility change
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mounted) {
        void fetchData();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);

  return { pendingConfirmations, recentRuns, refresh: fetchData, isRefreshing };
}
