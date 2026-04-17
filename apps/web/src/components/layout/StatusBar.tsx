import { useEffect, useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import { api } from '../../lib/api';
import { SystemStatusSnapshot } from '@rawclaw/shared';

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

interface StatusBarProps {
  onStatus?: (status: SystemStatusSnapshot) => void;
}

export function StatusBar({ onStatus }: StatusBarProps) {
  const [status, setStatus] = useState<SystemStatusSnapshot>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const response = await api.get<SystemStatusSnapshot>('/system/status');
        if (!mounted) return;
        setStatus(response.data);
        onStatus?.(response.data);
      } catch {
        if (!mounted) return;
        setStatus((current) => ({
          ...current,
          services: {
            ...current.services,
            api: 'down',
          },
          websocket: { connected: false },
        }));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 5000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [onStatus]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const response = await api.get<SystemStatusSnapshot>('/system/status');
      setStatus(response.data);
      onStatus?.(response.data);
    } catch {
      setStatus((current) => ({
        ...current,
        services: { ...current.services, api: 'down' },
        websocket: { connected: false },
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <footer
      style={{
        borderTop: '1px solid var(--border-glass)',
        background: 'rgba(8, 8, 14, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '0.85rem 1.1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
        <StatusChip label="API" status={status.services.api} />
        <StatusChip label="Agent" status={status.services.agent} />
        <StatusChip label="Redis" status={status.services.redis} />
        <StatusChip label="ChromaDB" status={status.services.chroma} />
        <StatusChip label="Prisma / SQLite" status={status.services.database} />
        <StatusChip label="WebSocket" status={status.websocket.connected ? 'ok' : 'down'} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', color: 'var(--text-secondary)' }}>
        <span className="mono" style={{ fontSize: '0.8rem' }}>
          {status.git.branch}
        </span>
        <span style={{ opacity: 0.5 }}>•</span>
        <span style={{ fontSize: '0.82rem' }}>{status.git.lastCommit || 'No commit metadata'}</span>
        <button
          className="btn-ghost"
          onClick={handleRefresh}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.7rem' }}
        >
          <FiRefreshCw className={loading ? 'icon-spin' : undefined} />
          Refresh
        </button>
      </div>
    </footer>
  );
}

function StatusChip({ label, status }: { label: string; status: string }) {
  const normalized = status === 'ok' ? 'ok' : status === 'degraded' ? 'loading' : 'down';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.45rem 0.8rem',
        borderRadius: '999px',
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <span className={`status-dot ${normalized}`} />
      <span style={{ fontSize: '0.9rem' }}>{label}</span>
      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
        {status}
      </span>
    </div>
  );
}
