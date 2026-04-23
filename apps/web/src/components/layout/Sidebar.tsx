import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  FiActivity,
  FiBox,
  FiChevronLeft,
  FiChevronRight,
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
  { to: '/provenance', label: 'Provenance', icon: FiActivity },
  { to: '/tasks', label: 'Tasks', icon: FiBox, badge: 'pendingTasks' as const },
  { to: '/settings', label: 'Settings', icon: FiSettings },
];

export function Sidebar({ counts }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('rawclaw_main_sidebar_collapsed');
    if (saved) setIsCollapsed(saved === 'true');
  }, []);

  useEffect(() => {
    localStorage.setItem('rawclaw_main_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  return (
    <aside
      style={{
        width: isCollapsed ? '72px' : '280px',
        minWidth: isCollapsed ? '72px' : '280px',
        background: 'rgba(8, 8, 14, 0.92)',
        borderRight: '1px solid var(--border-glass)',
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(18px)',
        transition: 'width 0.16s ease, min-width 0.16s ease',
      }}
    >
      <div style={{ padding: isCollapsed ? '0.9rem 0.7rem' : '1rem 1.1rem', borderBottom: '1px solid var(--border-glass)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: isCollapsed ? 'center' : 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
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
          {!isCollapsed && (
            <div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>RawClaw v2</div>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.2em' }}>
                COMMAND CENTER
              </div>
            </div>
          )}
          </div>
          <button
            onClick={() => setIsCollapsed((current) => !current)}
            title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            {isCollapsed ? <FiChevronRight size={16} /> : <FiChevronLeft size={16} />}
          </button>
        </div>
      </div>

      <nav style={{ padding: isCollapsed ? '0.7rem 0.45rem' : '1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
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
                padding: isCollapsed ? '0.9rem 0.75rem' : '0.95rem 1rem',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: isActive ? 'rgba(110, 103, 255, 0.16)' : 'transparent',
                border: isActive ? '1px solid rgba(110, 103, 255, 0.25)' : '1px solid transparent',
                textDecoration: 'none',
              })}
              title={isCollapsed ? item.label : undefined}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                <Icon />
                {!isCollapsed && <span style={{ fontSize: '1.02rem' }}>{item.label}</span>}
              </span>
              {item.badge && !isCollapsed ? (
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
              ) : item.badge && isCollapsed ? (
                <span
                  className="mono"
                  style={{
                    minWidth: '10px',
                    height: '10px',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'rgba(110, 103, 255, 0.9)',
                    color: 'transparent',
                    fontSize: '0.1rem',
                    borderRadius: '999px',
                  }}
                >
                  {badgeValue}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>

      {!isCollapsed && (
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
      )}
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
