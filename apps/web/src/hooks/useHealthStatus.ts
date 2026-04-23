import { useEffect, useState } from 'react';
import { SystemStatusSnapshot } from '@rawclaw/shared';
import { api } from '../lib/api';
import { DEFAULT_SYSTEM_STATUS } from '../lib/constants';

interface HealthStatusData {
  status: SystemStatusSnapshot;
  refresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function useHealthStatus(intervalMs = 5000): HealthStatusData {
  const [status, setStatus] = useState<SystemStatusSnapshot>(DEFAULT_SYSTEM_STATUS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      setIsRefreshing(true);
      const response = await api.get<SystemStatusSnapshot>('/system/status');
      setStatus(response.data);
    } catch {
      setStatus((current) => ({
        ...current,
        services: {
          ...current.services,
          api: 'degraded',
        },
        websocket: { connected: false },
      }));
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      if (!mounted || document.hidden) return;
      await fetchStatus();
    };

    void poll();
    const timer = window.setInterval(() => void poll(), intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mounted) {
        void fetchStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);

  return { status, refresh: fetchStatus, isRefreshing };
}
