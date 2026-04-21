import { useEffect, useState } from 'react';
import { FiSearch, FiClock, FiTool, FiActivity, FiDatabase, FiAlertTriangle, FiChevronRight, FiChevronDown } from 'react-icons/fi';

interface TraceNode {
  id: string;
  type: 'action' | 'thought' | 'tool_call' | 'tool_result' | 'error';
  timestamp: string;
  step: number;
  content: string;
  metadata?: Record<string, any>;
  children?: TraceNode[];
}

interface Trace {
  id: string;
  sessionId: string;
  timestamp: string;
  nodes: TraceNode[];
  summary: string;
}

export default function Provenance() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  const loadTraces = async () => {
    setLoading(true);
    try {
      const resp = await fetch('http://localhost:3000/provenance/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await resp.json();
      setTraces(data.results || []);
    } catch (err) {
      console.error('Failed to load traces:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTraces();
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderNode = (node: TraceNode, depth = 0) => {
    const isExpanded = expandedNodes[node.id];
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.id} style={{ marginLeft: depth * 16, borderLeft: depth > 0 ? '1px solid var(--border-glass)' : 'none', paddingLeft: depth > 0 ? '12px' : '0' }}>
        <div 
          onClick={() => hasChildren && toggleExpand(node.id)}
          className="glass-card"
          style={{ 
            padding: '0.8rem', 
            marginBottom: '0.5rem', 
            cursor: hasChildren ? 'pointer' : 'default',
            background: node.type === 'error' ? 'rgba(255, 100, 100, 0.1)' : 'rgba(255, 255, 255, 0.03)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem'
          }}
        >
          <div style={{ marginTop: '0.2rem' }}>
            {node.type === 'tool_call' && <FiTool style={{ color: 'var(--neon-blue)' }} />}
            {node.type === 'tool_result' && <FiDatabase style={{ color: 'var(--neon-green)' }} />}
            {node.type === 'thought' && <FiActivity style={{ color: 'var(--text-muted)' }} />}
            {node.type === 'error' && <FiAlertTriangle style={{ color: '#ff6b6b' }} />}
            {node.type === 'action' && <FiChevronRight style={{ color: '#fff' }} />}
          </div>
          
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 800 }}>
                STEP {node.step} • {node.type.toUpperCase()}
              </span>
              <span className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {new Date(node.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {node.content}
            </div>
            {node.metadata && Object.keys(node.metadata).length > 0 && (
              <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', fontSize: '0.75rem' }}>
                <pre className="mono" style={{ margin: 0, overflowX: 'auto' }}>
                  {JSON.stringify(node.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
          
          {hasChildren && (
            <div style={{ alignSelf: 'center' }}>
              {isExpanded ? <FiChevronDown /> : <FiChevronRight />}
            </div>
          )}
        </div>
        
        {isExpanded && node.children?.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '1.5rem', height: 'calc(100vh - 120px)' }}>
      {/* Sidebar: Trace List */}
      <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-glass)' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1rem' }}>Agent Activity</h2>
          <div style={{ position: 'relative' }}>
            <FiSearch style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search traces..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadTraces()}
              style={{
                width: '100%',
                padding: '0.8rem 1rem 0.8rem 2.4rem',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-glass)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
          </div>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
          {loading && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading traces...</div>}
          
          {!loading && traces.map(trace => (
            <div 
              key={trace.id}
              onClick={() => setSelectedTrace(trace)}
              style={{
                padding: '1rem',
                borderRadius: '14px',
                marginBottom: '0.5rem',
                cursor: 'pointer',
                background: selectedTrace?.id === trace.id ? 'rgba(110, 103, 255, 0.15)' : 'transparent',
                border: `1px solid ${selectedTrace?.id === trace.id ? 'var(--neon-blue)' : 'transparent'}`,
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{trace.id.slice(0, 8)}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <FiClock style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />
                  {new Date(trace.timestamp).toLocaleDateString()}
                </span>
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {trace.summary || 'No summary'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Session: {trace.sessionId}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Content: Trace Detail */}
      <section style={{ overflowY: 'auto' }}>
        {selectedTrace ? (
          <div>
            <header className="glass-card" style={{ marginBottom: '1.5rem', border: '1px solid var(--border-glass)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Trace Details</h1>
                  <p style={{ color: 'var(--text-secondary)' }}>Detailed provenance chain for request <code>{selectedTrace.id}</code></p>
                </div>
                <div className="glass-card" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--neon-green)', boxShadow: '0 0 8px var(--neon-green)' }} />
                  <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 800 }}>COMPLETED</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
                <div>
                  <label className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>SESSION ID</label>
                  <div style={{ fontSize: '0.9rem' }}>{selectedTrace.sessionId}</div>
                </div>
                <div>
                  <label className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>TIMESTAMP</label>
                  <div style={{ fontSize: '0.9rem' }}>{new Date(selectedTrace.timestamp).toLocaleString()}</div>
                </div>
                <div>
                  <label className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>STEPS</label>
                  <div style={{ fontSize: '0.9rem' }}>{selectedTrace.nodes.length}</div>
                </div>
              </div>
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {selectedTrace.nodes.map(node => renderNode(node))}
            </div>
          </div>
        ) : (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <FiActivity style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.2 }} />
              <p>Select a trace from the list to view its execution chain.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
