import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { OperatorSnapshot, OperatorTimelineKind } from '@rawclaw/shared';
import { FiPlus, FiClock, FiX, FiChevronLeft, FiChevronRight, FiActivity, FiRefreshCw } from 'react-icons/fi';
import { api } from '../lib/api';
import { fetchOperatorSnapshot } from '../lib/operator';
import { formatDistanceToNow } from 'date-fns';
import { isUserFacingToolName } from './chat/toolVisibility';

interface Session {
  id: string;
  title: string | null;
  updatedAt: string;
}

interface LiveWorkRow {
  id: string;
  label: string;
  detail?: string;
}

const LIVE_WORK_ALLOWED_TIMELINE_KINDS = new Set<OperatorTimelineKind>(['memory_event', 'review']);

const EMPTY_SNAPSHOT: OperatorSnapshot = {
  summary: {
    activeAgents: 0,
    activeSessions: 0,
    activeRoutes: 0,
    currentRuns: 0,
    toolEvents: 0,
    memoryEvents: 0,
    degradedCount: 0,
    subagentCount: 0,
  },
  activeAgents: [],
  activeSessions: [],
  currentRuns: [],
  toolActivity: [],
  timeline: [],
  provenance: [],
  subagentTree: [],
  routes: [],
};

function formatToolRow(toolName: string, phase?: string): string {
  const lowered = toolName.toLowerCase();
  if (!isUserFacingToolName(toolName)) return '';
  if (lowered.includes('web_extract')) return phase === 'start' ? 'Page read running' : 'Page read complete';
  if (lowered.includes('search')) return phase === 'start' ? 'Web search running' : 'Web search complete';
  if (lowered.includes('memory')) return 'Memory captured';
  if (lowered.includes('review')) return 'Review requested changes';
  return '';
}

function isActionableReview(summary?: string | null, detail?: string | null): boolean {
  const combined = `${summary || ''} ${detail || ''}`.toLowerCase();
  if (!combined.trim()) return false;
  if (combined.includes('approved')) return false;
  return combined.includes('reject') || combined.includes('requested changes') || combined.includes('needs revision');
}

function buildLiveWorkRows(snapshot: OperatorSnapshot, sessionId?: string): LiveWorkRow[] {
  if (!sessionId) return [];

  const sessionRuns = snapshot.currentRuns
    .filter((run) => run.sessionId === sessionId || run.parentSessionId === sessionId)
    .filter((run) => ['running', 'queued', 'failed'].includes(String(run.status || '').toLowerCase()))
    .sort((a, b) => {
      const priority = (status?: string | null) => (status === 'running' ? 0 : status === 'queued' ? 1 : 2);
      return priority(a.status) - priority(b.status);
    })
    .slice(0, 3)
    .map((run) => {
      const kind = run.kind === 'app_builder'
        ? 'App Builder'
        : run.kind === 'automation'
          ? 'Automation'
          : run.kind === 'task'
            ? 'Task'
            : run.title || 'Run';
      const statusLabel =
        run.status === 'running'
          ? 'running'
          : run.status === 'queued'
            ? 'queued'
            : run.status === 'failed'
              ? 'needs attention'
              : String(run.status || 'active');
      return {
        id: `run-${run.id}`,
        label: run.status === 'failed' ? 'Run needs attention' : `${kind} ${statusLabel}`,
        detail: run.summary || run.latestError || undefined,
      };
    });

  const toolRows = snapshot.toolActivity
    .filter((item) => item.sessionId === sessionId)
    .map((item) => {
      const label = formatToolRow(item.toolName, item.phase);
      return label ? {
        id: `tool-${item.id}`,
        label,
        detail: item.summary,
      } : null;
    })
    .filter(Boolean) as LiveWorkRow[];

  const timelineRows = snapshot.timeline
    .filter((item) => item.sessionId === sessionId || item.parentSessionId === sessionId)
    // Keep provenance heartbeat rows such as "Answer trace updated" out of LIVE WORK.
    .filter((item) => LIVE_WORK_ALLOWED_TIMELINE_KINDS.has(item.kind))
    .map((item) => {
      if (item.kind === 'memory_event') {
        return {
          id: `timeline-${item.id}`,
          label: item.memoryAction === 'captured' ? 'Memory captured' : 'Memory used',
          detail: item.summary,
        };
      }
      if (item.kind === 'review' && isActionableReview(item.summary, item.detail)) {
        return {
          id: `timeline-${item.id}`,
          label: 'Review requested changes',
          detail: item.detail || item.summary,
        };
      }
      return null;
    })
    .filter(Boolean) as LiveWorkRow[];

  const deduped = [...sessionRuns, ...toolRows, ...timelineRows].filter((row, index, all) => (
    all.findIndex((candidate) => candidate.label === row.label) === index
  ));

  return deduped.slice(0, 6);
}

export function ChatSidebar() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showLiveWork, setShowLiveWork] = useState(true);
  const [liveSnapshot, setLiveSnapshot] = useState<OperatorSnapshot>(EMPTY_SNAPSHOT);
  const [liveWorkError, setLiveWorkError] = useState(false);
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const liveWorkRows = useMemo(() => buildLiveWorkRows(liveSnapshot, sessionId), [liveSnapshot, sessionId]);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('rawclaw_chat_sidebar_collapsed');
    if (saved) {
      setIsCollapsed(saved === 'true');
    }
    
    // Load cached sessions
    const cachedSessions = localStorage.getItem('rawclaw_sessions_cache');
    if (cachedSessions) {
      try {
        setSessions(JSON.parse(cachedSessions));
      } catch (e) {
        console.error('Failed to parse cached sessions', e);
      }
    }
  }, []);

  // Save collapsed state when it changes
  useEffect(() => {
    localStorage.setItem('rawclaw_chat_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    fetchSessions();
  }, [sessionId]); // Refresh list when session id changes (likely after creation)

  useEffect(() => {
    if (isCollapsed || !sessionId) return;

    let disposed = false;

    const loadLiveWork = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await fetchOperatorSnapshot(80);
        if (!disposed) {
          setLiveSnapshot(next);
          setLiveWorkError(false);
        }
      } catch (err) {
        console.error('Failed to load live work snapshot', err);
        if (!disposed) {
          setLiveWorkError(true);
        }
      }
    };

    void loadLiveWork();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadLiveWork();
      }
    }, 10000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [isCollapsed, sessionId]);

  const fetchSessions = async () => {
    try {
      const res = await api.get<Session[]>('/chat/sessions');
      setSessions(res.data);
      // Update cache
      localStorage.setItem('rawclaw_sessions_cache', JSON.stringify(res.data));
    } catch (err) {
      console.error('Failed to fetch sessions', err);
    }
  };

  const handleNewChat = () => {
    navigate('/chat');
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!window.confirm('Are you sure you want to terminate this session record?')) return;

    try {
      await api.post(`/chat/sessions/${id}/delete`);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (sessionId === id) {
        navigate('/chat');
      }
    } catch (err) {
      console.error('Failed to delete session', err);
    }
  };

  return (
    <div
      className={isCollapsed ? 'chat-sidebar-collapsed' : ''}
      style={{
        width: isCollapsed ? '40px' : '240px',
        minWidth: isCollapsed ? '40px' : '240px',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.3)',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.15s ease',
      }}
    >
      <div style={{
        padding: isCollapsed ? '0.5rem 0' : '0.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        alignItems: 'center',
      }}>
        {!isCollapsed && (
          <button
            onClick={handleNewChat}
            className="btn-primary"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '0.4rem',
              fontSize: '0.7rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            <FiPlus size={12} />
            <span className="mono">NEW</span>
          </button>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="chat-sidebar-toggle"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            padding: '0.3rem',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isCollapsed ? <FiChevronRight size={14} /> : <FiChevronLeft size={14} />}
        </button>
      </div>

      {!isCollapsed && (

      <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem' }}>
        <div className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', paddingLeft: '1rem', marginBottom: '1rem' }}>
          RECENT_SESSIONS
        </div>
        
        {sessions.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            No active sessions found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {sessions.map((session) => (
              <NavLink
                key={session.id}
                to={`/chat/${session.id}`}
                className={({ isActive }) => (isActive ? 'active-session' : '')}
                style={({ isActive }) => ({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  background: isActive ? 'rgba(0, 200, 200, 0.08)' : 'transparent',
                  border: isActive ? '1px solid rgba(0, 200, 200, 0.2)' : '1px solid transparent',
                  transition: 'all 0.2s',
                  position: 'relative',
                  group: 'true'
                })}
              >
                <div style={{ 
                  fontSize: '0.85rem', 
                  color: sessionId === session.id ? 'var(--neon-cyan)' : 'var(--text-primary)',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  paddingRight: '20px'
                }}>
                  {session.title || 'Untitled Session'}
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                    <FiClock size={10} />
                    <span>{formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true })}</span>
                  </div>
                </div>

                <div 
                  onClick={(e) => handleDelete(e, session.id)}
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '0.75rem',
                    opacity: 0.6,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    padding: '2px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                >
                  <FiX size={14} />
                </div>
              </NavLink>
            ))}
          </div>
        )}

        <div style={{ marginTop: '1.1rem', display: 'grid', gap: '0.55rem' }}>
          <button
            type="button"
            onClick={() => setShowLiveWork((current) => !current)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              padding: '0 0.5rem',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <span className="mono" style={{ fontSize: '0.65rem' }}>LIVE WORK</span>
            {showLiveWork ? <FiChevronLeft size={12} style={{ transform: 'rotate(-90deg)' }} /> : <FiChevronRight size={12} style={{ transform: 'rotate(90deg)' }} />}
          </button>

          {showLiveWork ? (
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {liveWorkError ? (
                <div
                  style={{
                    padding: '0.7rem 0.8rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-glass)',
                    background: 'rgba(255,255,255,0.03)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.78rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                  }}
                >
                  <FiRefreshCw size={12} />
                  Checking on your work...
                </div>
              ) : liveWorkRows.length === 0 ? (
                <div
                  style={{
                    padding: '0.7rem 0.8rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-glass)',
                    background: 'rgba(255,255,255,0.03)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.78rem',
                  }}
                >
                  No active work right now.
                </div>
              ) : (
                liveWorkRows.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      padding: '0.7rem 0.8rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border-glass)',
                      background: 'rgba(255,255,255,0.03)',
                      display: 'grid',
                      gap: '0.2rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
                      <FiActivity size={12} color="var(--neon-cyan)" />
                      <span>{row.label}</span>
                    </div>
                    {row.detail ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1.4 }}>
                        {row.detail}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>

      )}

      {!isCollapsed && (
        <style>{`
          .active-session::after {
            content: '';
            position: absolute;
            left: 0;
            top: 20%;
            bottom: 20%;
            width: 2px;
            background: var(--neon-cyan);
            box-shadow: 0 0 10px var(--neon-cyan-glow);
          }
        `}</style>
      )}
    </div>
  );
}
