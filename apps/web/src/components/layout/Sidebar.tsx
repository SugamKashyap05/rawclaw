import { NavLink } from 'react-router-dom';
import {
  FiActivity,
  FiBox,
  FiCpu,
  FiDatabase,
  FiLayers,
  FiMessageSquare,
  FiSettings,
  FiShield,
  FiTool,
  FiUsers,
} from 'react-icons/fi';

interface SidebarCounts {
  agents?: number;
  mcpServers?: number;
  pendingTasks?: number;
}

interface SidebarProps {
  counts?: SidebarCounts;
}

const ITEMS = [
  { to: '/', label: 'Dashboard', icon: FiActivity },
  { to: '/chat', label: 'Chat', icon: FiMessageSquare },
  { to: '/agents', label: 'Agents', icon: FiUsers, badge: 'agents' as const },
  { to: '/mcp', label: 'MCP Servers', icon: FiTool, badge: 'mcpServers' as const },
  { to: '/skills', label: 'Skills', icon: FiLayers },
  { to: '/memory', label: 'Memory (RAG)', icon: FiDatabase },
  { to: '/models', label: 'Models', icon: FiCpu },
  { to: '/integrations', label: 'Integrations', icon: FiShield },
  { to: '/tasks', label: 'Tasks', icon: FiBox, badge: 'pendingTasks' as const },
  { to: '/settings', label: 'Settings', icon: FiSettings },
];

export function Sidebar({ counts }: SidebarProps) {
  return (
    <aside
      style={{
        width: '280px',
        minWidth: '280px',
        background: 'rgba(8, 8, 14, 0.92)',
        borderRight: '1px solid var(--border-glass)',
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(18px)',
      }}
    >
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-glass)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(135deg, rgba(0,240,255,0.25), rgba(157,0,255,0.2))',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span className="mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              R
            </span>
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>RawClaw v2</div>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.78rem', letterSpacing: '0.25em' }}>
              COMMAND CENTER
            </div>
          </div>
        </div>
      </div>

      <nav style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const badgeValue = item.badge ? counts?.[item.badge] ?? 0 : 0;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.8rem',
                padding: '0.95rem 1rem',
                borderRadius: '18px',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: isActive ? 'rgba(110, 103, 255, 0.16)' : 'transparent',
                border: isActive ? '1px solid rgba(110, 103, 255, 0.25)' : '1px solid transparent',
                textDecoration: 'none',
              })}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                <Icon />
                <span style={{ fontSize: '1.02rem' }}>{item.label}</span>
              </span>
              {item.badge ? (
                <span
                  className="mono"
                  style={{
                    minWidth: '28px',
                    height: '28px',
                    padding: '0 0.45rem',
                    borderRadius: '999px',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'rgba(110, 103, 255, 0.22)',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem',
                  }}
                >
                  {badgeValue}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>

      <div style={{ padding: '1rem 1.25rem 1.4rem', borderTop: '1px solid var(--border-glass)' }}>
        <div className="glass-card" style={{ padding: '1rem' }}>
          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.85rem' }}>
            LIVE COUNTS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            <Metric label="Agents" value={counts?.agents ?? 0} />
            <Metric label="MCP" value={counts?.mcpServers ?? 0} />
            <Metric label="Tasks" value={counts?.pendingTasks ?? 0} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{value}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{label}</div>
    </div>
  );
}
