import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { IconType } from 'react-icons';
import {
  FiActivity,
  FiBookOpen,
  FiBox,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiCpu,
  FiDatabase,
  FiEye,
  FiFolder,
  FiLayers,
  FiMessageSquare,
  FiSettings,
  FiShield,
  FiTerminal,
  FiTool,
  FiUsers,
  FiZap,
  FiClock,
  FiPackage,
} from 'react-icons/fi';

interface SidebarCounts {
  agents?: number;
  mcpServers?: number;
  pendingTasks?: number;
}

interface SidebarProps {
  counts?: SidebarCounts;
  variant?: 'default' | 'app-builder';
}

type SidebarBadgeKey = keyof SidebarCounts;
type SidebarItem = {
  to: string;
  label: string;
  icon: IconType;
  badge?: SidebarBadgeKey;
  children?: SidebarItem[];
};

const GROUPS: Array<{ id: string; label: string; items: SidebarItem[] }> = [
  {
    id: 'core',
    label: 'Core',
    items: [
      { to: '/', label: 'Command Center', icon: FiActivity },
      { to: '/chat', label: 'Chat', icon: FiMessageSquare },
      { to: '/memory', label: 'Memory', icon: FiDatabase },
      { to: '/learning', label: 'Learning', icon: FiBookOpen },
      { to: '/agents', label: 'Agents', icon: FiUsers, badge: 'agents' as const },
      { to: '/mcp', label: 'MCP Servers', icon: FiTool, badge: 'mcpServers' as const },
      { to: '/skills', label: 'Skills', icon: FiLayers },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      {
        to: '/app-builder',
        label: 'App Builder',
        icon: FiPackage,
        children: [
          { to: '/app-builder', label: 'Builder', icon: FiMessageSquare },
          { to: '/app-builder/live-preview', label: 'Live Preview', icon: FiEye },
          { to: '/app-builder/projects', label: 'Projects', icon: FiFolder },
          { to: '/app-builder/console', label: 'Console', icon: FiTerminal },
        ],
      },
      { to: '/tasks', label: 'Tasks', icon: FiBox, badge: 'pendingTasks' as const },
      { to: '/operator', label: 'Operator', icon: FiClock },
      { to: '/gateway', label: 'Gateway Runtime', icon: FiZap },
      { to: '/provenance', label: 'Control Room', icon: FiActivity },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { to: '/models', label: 'Models', icon: FiCpu },
      { to: '/integrations', label: 'Integrations', icon: FiShield },
      { to: '/settings', label: 'Settings', icon: FiSettings },
    ],
  },
] as const;

export function Sidebar({ counts, variant = 'default' }: SidebarProps) {
  const location = useLocation();
  const isAppBuilder = variant === 'app-builder';
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    core: false,
    build: false,
    system: false,
  });
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({
    '/app-builder': false,
  });

  useEffect(() => {
    const saved = localStorage.getItem('rawclaw_main_sidebar_collapsed');
    if (saved) setIsCollapsed(saved === 'true');
    const savedGroups = localStorage.getItem('rawclaw_main_sidebar_groups');
    if (savedGroups) {
      try {
        setCollapsedGroups(JSON.parse(savedGroups));
      } catch {
        // ignore invalid localStorage payloads
      }
    }
    const savedItems = localStorage.getItem('rawclaw_main_sidebar_items');
    if (savedItems) {
      try {
        setCollapsedItems(JSON.parse(savedItems));
      } catch {
        // ignore invalid localStorage payloads
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('rawclaw_main_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    localStorage.setItem('rawclaw_main_sidebar_groups', JSON.stringify(collapsedGroups));
  }, [collapsedGroups]);

  useEffect(() => {
    localStorage.setItem('rawclaw_main_sidebar_items', JSON.stringify(collapsedItems));
  }, [collapsedItems]);

  const activePath = location.pathname;
  const isAppBuilderRoute = useMemo(() => activePath.startsWith('/app-builder'), [activePath]);

  return (
    <aside
      className={isAppBuilder ? 'app-builder-sidebar' : undefined}
      style={{
        width: isCollapsed ? '72px' : '280px',
        minWidth: isCollapsed ? '72px' : '280px',
        background: isAppBuilder ? 'var(--bg-sidebar, var(--bg-surface))' : 'rgba(8, 8, 14, 0.92)',
        borderRight: `1px solid ${isAppBuilder ? 'var(--border)' : 'var(--border-glass)'}`,
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: isAppBuilder ? 'none' : 'blur(18px)',
        transition: 'width 0.16s ease, min-width 0.16s ease',
      }}
    >
      <div style={{ padding: isCollapsed ? '0.9rem 0.7rem' : '1rem 1.1rem', borderBottom: `1px solid ${isAppBuilder ? 'var(--border)' : 'var(--border-glass)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: isCollapsed ? 'center' : 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: isAppBuilder ? '10px' : '12px',
              display: 'grid',
              placeItems: 'center',
              background: isAppBuilder ? 'var(--accent-light)' : 'linear-gradient(135deg, rgba(0,240,255,0.25), rgba(157,0,255,0.2))',
              border: `1px solid ${isAppBuilder ? 'var(--border)' : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            <span className={isAppBuilder ? undefined : 'mono'} style={{ fontSize: '1.1rem', fontWeight: 800, color: isAppBuilder ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
              R
            </span>
          </div>
          {!isCollapsed && (
            <div>
              <div style={{ fontSize: isAppBuilder ? '1.15rem' : '1.35rem', fontWeight: 800 }}>RawClaw</div>
              <div className={isAppBuilder ? undefined : 'mono'} style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: isAppBuilder ? '0.04em' : '0.2em', textTransform: isAppBuilder ? 'none' : 'uppercase' }}>
                {isAppBuilder ? 'App workspace' : 'OPERATOR CONSOLE'}
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

      <nav style={{ padding: isCollapsed ? '0.7rem 0.45rem' : '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem', flex: 1 }}>
        {GROUPS.map((group) => {
          const isGroupCollapsed = collapsedGroups[group.id];
          return (
            <div key={group.id} style={{ display: 'grid', gap: '0.45rem' }}>
              {!isCollapsed ? (
                <button
                  onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.15rem 0.35rem',
                    cursor: 'pointer',
                  }}
                >
                  <span className="mono" style={{ fontSize: '0.72rem', letterSpacing: '0.18em' }}>
                    {group.label}
                  </span>
                  <FiChevronDown
                    size={14}
                    style={{
                      transform: isGroupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.16s ease',
                    }}
                  />
                </button>
              ) : null}

              {(isCollapsed || !isGroupCollapsed) && group.items.map((item) => {
                const Icon = item.icon;
                const badgeValue = item.badge ? counts?.[item.badge] ?? 0 : 0;
                const isParentActive = item.children?.some((child) => activePath === child.to || activePath.startsWith(`${child.to}/`)) || false;
                const isItemActive = activePath === item.to || activePath.startsWith(`${item.to}/`) || isParentActive;
                const itemCollapsed = collapsedItems[item.to];

                return (
                  <div key={item.to} style={{ display: 'grid', gap: '0.35rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'stretch',
                        gap: '0.35rem',
                      }}
                    >
                      <NavLink
                        to={item.to}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.8rem',
                          padding: isCollapsed ? '0.9rem 0.75rem' : '0.95rem 1rem',
                          color: isItemActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                          background: isItemActive ? (isAppBuilder ? 'var(--accent-light)' : 'rgba(110, 103, 255, 0.16)') : 'transparent',
                          border: isItemActive ? `1px solid ${isAppBuilder ? 'var(--border-accent)' : 'rgba(110, 103, 255, 0.25)'}` : '1px solid transparent',
                          textDecoration: 'none',
                          borderRadius: isAppBuilder ? '12px' : undefined,
                        }}
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
                              background: isAppBuilder ? 'var(--accent-light)' : 'rgba(110, 103, 255, 0.22)',
                              color: isAppBuilder ? 'var(--accent-primary)' : 'var(--text-primary)',
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

                      {!isCollapsed && item.children?.length ? (
                        <button
                          onClick={() => setCollapsedItems((current) => ({ ...current, [item.to]: !current[item.to] }))}
                          aria-label={itemCollapsed ? `Expand ${item.label}` : `Collapse ${item.label}`}
                          style={{
                            border: '1px solid transparent',
                            background: isItemActive ? (isAppBuilder ? 'var(--bg-elevated)' : 'rgba(110, 103, 255, 0.08)') : 'transparent',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            borderRadius: isAppBuilder ? '10px' : '14px',
                            padding: '0 0.65rem',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <FiChevronDown
                            size={14}
                            style={{
                              transform: itemCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                              transition: 'transform 0.16s ease',
                            }}
                          />
                        </button>
                      ) : null}
                    </div>

                    {!isCollapsed && item.children?.length && !itemCollapsed ? (
                      <div style={{ display: 'grid', gap: '0.3rem', paddingLeft: '1.25rem' }}>
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          const childIsActive =
                            child.to === '/app-builder'
                              ? activePath === '/app-builder'
                              : activePath === child.to || activePath.startsWith(`${child.to}/`);
                          return (
                            <NavLink
                              key={child.to}
                              to={child.to + (isAppBuilderRoute && location.search ? location.search : '')}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.7rem 0.85rem',
                                borderRadius: isAppBuilder ? '10px' : '14px',
                                textDecoration: 'none',
                                color: childIsActive ? 'var(--text-primary)' : 'var(--text-muted)',
                                background: childIsActive ? (isAppBuilder ? 'var(--bg-elevated)' : 'rgba(255,255,255,0.05)') : 'transparent',
                                border: childIsActive ? `1px solid ${isAppBuilder ? 'var(--border)' : 'rgba(255,255,255,0.08)'}` : '1px solid transparent',
                              }}
                            >
                              <ChildIcon size={15} />
                              <span style={{ fontSize: '0.94rem' }}>{child.label}</span>
                            </NavLink>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      {!isCollapsed && (
      <div style={{ padding: '1rem 1.25rem 1.4rem', borderTop: `1px solid ${isAppBuilder ? 'var(--border)' : 'var(--border-glass)'}` }}>
        <div className="glass-card" style={{ padding: '1rem' }}>
          <div className={isAppBuilder ? undefined : 'mono'} style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.85rem', letterSpacing: isAppBuilder ? '0.08em' : undefined, textTransform: isAppBuilder ? 'uppercase' : undefined }}>
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
