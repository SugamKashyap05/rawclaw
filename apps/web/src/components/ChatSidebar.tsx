import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { FiPlus, FiClock, FiX, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { api } from '../lib/api';
import { formatDistanceToNow } from 'date-fns';

interface Session {
  id: string;
  title: string | null;
  updatedAt: string;
}

export function ChatSidebar() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { sessionId } = useParams();
  const navigate = useNavigate();

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
