import { FiRefreshCw } from 'react-icons/fi';
import { SystemStatusSnapshot } from '@rawclaw/shared';

interface StatusBarProps {
  status: SystemStatusSnapshot;
  onRefresh?: () => Promise<void> | void;
  isRefreshing?: boolean;
  variant?: 'default' | 'app-builder';
}

export function StatusBar({ status, onRefresh, isRefreshing = false, variant = 'default' }: StatusBarProps) {
  const isAppBuilder = variant === 'app-builder';

  return (
    <footer
      className={isAppBuilder ? 'app-builder-statusbar' : undefined}
      style={{
        minHeight: isAppBuilder ? '36px' : '32px',
        borderTop: '1px solid var(--border)',
        background: isAppBuilder ? 'var(--bg-surface)' : '#030408',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.8rem',
        padding: '0.35rem 0.9rem',
        flexWrap: 'wrap',
        fontFamily: isAppBuilder ? "'Inter', system-ui, -apple-system, sans-serif" : "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusChip label="API" status={status.services.api} appBuilder={isAppBuilder} />
        <StatusChip label="Agent" status={status.services.agent} appBuilder={isAppBuilder} />
        <StatusChip label="Redis" status={status.services.redis} appBuilder={isAppBuilder} />
        <StatusChip label="ChromaDB" status={status.services.chroma} appBuilder={isAppBuilder} />
        <StatusChip label="Prisma / SQLite" status={status.services.database} appBuilder={isAppBuilder} />
        <StatusChip label="WebSocket" status={status.websocket.connected ? 'ok' : 'down'} appBuilder={isAppBuilder} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-secondary)' }}>
        <span className={isAppBuilder ? undefined : 'mono'} style={{ fontSize: isAppBuilder ? '0.75rem' : '0.68rem', fontWeight: isAppBuilder ? 500 : undefined }}>
          {status.git.branch}
        </span>
        <span style={{ opacity: 0.5 }}>&bull;</span>
        <span style={{ fontSize: isAppBuilder ? '0.75rem' : '0.68rem' }}>{status.git.lastCommit || 'No commit metadata'}</span>
        <button
          className="btn-ghost"
          onClick={() => void onRefresh?.()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.45rem',
            fontSize: isAppBuilder ? '0.75rem' : '0.68rem',
            textTransform: isAppBuilder ? 'none' : 'uppercase',
            letterSpacing: isAppBuilder ? 'normal' : '0.08em',
          }}
        >
          <FiRefreshCw className={isRefreshing ? 'icon-spin' : undefined} />
          Refresh
        </button>
      </div>
    </footer>
  );
}

function StatusChip({ label, status, appBuilder = false }: { label: string; status: string; appBuilder?: boolean }) {
  const normalized = status === 'ok' ? 'ok' : status === 'degraded' ? 'loading' : 'down';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: appBuilder ? '0.2rem 0.5rem' : '0.18rem 0.45rem',
        borderRadius: appBuilder ? '999px' : '4px',
        background: appBuilder ? 'var(--bg-surface)' : 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border)',
      }}
    >
      <span className={`status-dot ${normalized}`} />
      <span style={{ fontSize: appBuilder ? '0.75rem' : '0.68rem' }}>{label}</span>
      <span className={appBuilder ? undefined : 'mono'} style={{ color: 'var(--text-muted)', fontSize: appBuilder ? '0.72rem' : '0.62rem', textTransform: 'lowercase' }}>
        {status}
      </span>
    </div>
  );
}
