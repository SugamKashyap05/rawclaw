import { useEffect, useState } from 'react';
import { MCPServerRecord, CreateMCPServerRequest } from '@rawclaw/shared';
import { api } from '../lib/api';
import { FiPlus, FiTrash2, FiActivity, FiCpu, FiPlay, FiSquare, FiAlertCircle, FiChevronDown, FiChevronUp } from 'react-icons/fi';

export default function MCPServers() {
  const [servers, setServers] = useState<MCPServerRecord[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'info' | 'error' } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState<CreateMCPServerRequest>({
    name: '',
    type: 'stdio',
    command: '',
    args: [],
    env: {}
  });
  const [argsRaw, setArgsRaw] = useState('');
  const [envRaw, setEnvRaw] = useState('');

  const applyPreset = (name: string) => {
    if (name === 'DuckDuckGo') {
      setFormData({ name: 'duckduckgo', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-duckduckgo'], env: {} });
      setArgsRaw('-y\n@modelcontextprotocol/server-duckduckgo');
      setEnvRaw('{}');
    } else if (name === 'Filesystem') {
      setFormData({ name: 'filesystem', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Users'], env: {} });
      setArgsRaw('-y\n@modelcontextprotocol/server-filesystem\nC:/Users');
      setEnvRaw('{}');
    } else if (name === 'Google') {
      setFormData({ name: 'google-search', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-google-search'], env: {} });
      setArgsRaw('-y\n@modelcontextprotocol/server-google-search');
      setEnvRaw('{"GOOGLE_API_KEY": "", "GOOGLE_SEARCH_ENGINE_ID": ""}');
    }
  };

  useEffect(() => {
    void loadServers();
    const timer = window.setInterval(() => void loadServers(false), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const loadServers = async (showErrors = true) => {
    try {
      const response = await api.get<MCPServerRecord[]>('/mcp/servers');
      setServers(response.data);
      if (response.data.length === 0 && showErrors) {
        setMessage({ text: 'No MCP servers configured yet.', type: 'info' });
      }
    } catch (error) {
      console.error('Failed to load MCP servers', error);
      if (showErrors) {
        setMessage({ text: 'Unable to reach the MCP service.', type: 'error' });
      }
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId('creating');
    try {
      // Parse args and env
      const args = argsRaw.split('\n').map(a => a.trim()).filter(a => a !== '');
      let env = {};
      try {
        if (envRaw.trim()) env = JSON.parse(envRaw);
      } catch (err) {
        setMessage({ text: 'Invalid JSON for Environment variables.', type: 'error' });
        return;
      }

      await api.post('/mcp/servers', { ...formData, args, env });
      setIsAdding(false);
      setFormData({ name: '', type: 'stdio', command: '', args: [], env: {} });
      setArgsRaw('');
      setEnvRaw('');
      await loadServers();
      setMessage({ text: 'Server added successfully.', type: 'info' });
    } catch (error) {
      console.error('Failed to create MCP server', error);
      setMessage({ text: 'Failed to add MCP server.', type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const runAction = async (id: string, action: 'start' | 'stop') => {
    setBusyId(id);
    try {
      await api.post(`/mcp/servers/${id}/${action}`);
      await loadServers(false);
    } catch (error) {
      console.error(`Failed to ${action} MCP server`, error);
      setMessage({ text: `Failed to ${action} server.`, type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const removeServer = async (id: string) => {
    if (!confirm('Are you sure you want to remove this MCP server?')) return;
    setBusyId(id);
    try {
      await api.delete(`/mcp/servers/${id}`);
      await loadServers();
      setMessage({ text: 'Server removed.', type: 'info' });
    } catch (error) {
      setMessage({ text: 'Failed to remove server.', type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2.4rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #fff 0%, #aaa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            MCP Management
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Manage Model Context Protocol servers to extend agent capabilities with local tools.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn-secondary"
            onClick={async () => {
              setBusyId('refreshing');
              await loadServers();
              setBusyId(null);
            }}
            style={{ padding: '0.8rem 1.2rem' }}
          >
            REFRESH
          </button>
          <button 
            className="btn-primary" 
            onClick={() => setIsAdding(!isAdding)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1.2rem' }}
          >
            <FiPlus /> {isAdding ? 'CANCEL' : 'ADD SERVER'}
          </button>
        </div>
      </header>

      {message && (
        <div style={{ 
          padding: '1rem', 
          borderRadius: '12px', 
          background: message.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
          border: `1px solid ${message.type === 'error' ? 'var(--error)' : 'var(--neon-blue)'}`,
          color: message.type === 'error' ? 'var(--error)' : 'var(--neon-blue)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          {message.type === 'error' ? <FiAlertCircle /> : <FiActivity />}
          {message.text}
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMessage(null)}>×</button>
        </div>
      )}

      {isAdding && (
        <section className="glass-card animate-in" style={{ border: '1px solid var(--neon-blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Add New MCP Server</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>PRESETS:</span>
              {['DuckDuckGo', 'Filesystem', 'Google'].map(name => (
                <button 
                  key={name}
                  onClick={() => applyPreset(name)}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', borderRadius: '4px', fontSize: '0.6rem', color: 'var(--text-primary)', padding: '0.1rem 0.4rem', cursor: 'pointer' }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={handleCreate} style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>SERVER NAME</label>
              <input 
                value={formData.name} 
                onChange={e => setFormData({ ...formData, name: e.target.value })} 
                placeholder="e.g. filesystem-local" 
                required 
                style={fieldStyle} 
              />
            </div>
            <div>
              <label style={labelStyle}>TRANSPORT TYPE</label>
              <select 
                value={formData.type} 
                onChange={e => setFormData({ ...formData, type: e.target.value as 'stdio' | 'sse' })} 
                style={fieldStyle}
              >
                <option value="stdio">Stdio (Local Process)</option>
                <option value="sse">SSE (HTTP Tooling)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>COMMAND / URL</label>
              <input 
                value={formData.command} 
                onChange={e => setFormData({ ...formData, command: e.target.value })} 
                placeholder={formData.type === 'stdio' ? 'e.g. npx' : 'e.g. http://localhost:3001'} 
                required 
                style={fieldStyle} 
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>ARGUMENTS (ONE PER LINE)</label>
              <textarea 
                value={argsRaw} 
                onChange={e => setArgsRaw(e.target.value)} 
                placeholder="-y\n@modelcontextprotocol/server-filesystem\n/path/to/work" 
                rows={3} 
                style={{ ...fieldStyle, fontFamily: 'monospace' }} 
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>ENVIRONMENT VARIABLES (JSON)</label>
              <input 
                value={envRaw} 
                onChange={e => setEnvRaw(e.target.value)} 
                placeholder='{"API_KEY": "secret"}' 
                style={{ ...fieldStyle, fontFamily: 'monospace' }} 
              />
            </div>
            <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button className="btn-primary" type="submit" disabled={busyId === 'creating'}>
                {busyId === 'creating' ? 'ADDING...' : 'CONFIRM ADD'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div style={{ display: 'grid', gap: '1.25rem' }}>
        {servers.map((server) => (
          <div key={server.id} className="glass-card" style={{ 
            padding: '0', 
            overflow: 'hidden',
            border: expandedId === server.id ? '1px solid var(--neon-cyan)' : '1px solid var(--border-glass)'
          }}>
            <div style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <div style={{ 
                width: '48px', 
                height: '48px', 
                borderRadius: '12px', 
                background: server.status === 'running' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: server.status === 'running' ? '#10b981' : 'var(--text-muted)',
                fontSize: '1.5rem'
              }}>
                {server.status === 'running' ? <FiActivity /> : <FiCpu />}
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{server.name}</h3>
                  <span style={{ 
                    fontSize: '0.65rem', 
                    padding: '0.2rem 0.5rem', 
                    borderRadius: '4px', 
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-muted)',
                    letterSpacing: '0.05em'
                  }}>
                    {server.type.toUpperCase()}
                  </span>
                  <span className={`status-dot ${server.status === 'running' ? 'ok' : server.status === 'error' ? 'down' : 'loading'}`} />
                </div>
                <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  {server.command} {server.args?.join(' ')}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  className="btn-secondary" 
                  style={{ padding: '0.6rem 1rem' }}
                  onClick={() => void runAction(server.id, server.status === 'running' ? 'stop' : 'start')}
                  disabled={busyId === server.id}
                >
                  {busyId === server.id ? '...' : server.status === 'running' ? <FiSquare /> : <FiPlay />}
                </button>
                <button 
                  className="btn-secondary" 
                  style={{ padding: '0.6rem 1rem', color: 'var(--error)' }}
                  onClick={() => removeServer(server.id)}
                  disabled={busyId === server.id || server.name === 'docker-toolkit'}
                >
                  <FiTrash2 />
                </button>
                <button 
                  className="btn-secondary" 
                  style={{ padding: '0.6rem 1rem' }}
                  onClick={() => setExpandedId(expandedId === server.id ? null : server.id)}
                >
                  {expandedId === server.id ? <FiChevronUp /> : <FiChevronDown />}
                </button>
              </div>
            </div>

            {expandedId === server.id && (
              <div style={{ 
                padding: '1.25rem', 
                borderTop: '1px solid var(--border-glass)',
                background: 'rgba(0,0,0,0.1)'
              }}>
                {server.lastError && (
                  <div style={{ color: 'var(--error)', marginBottom: '1rem', fontSize: '0.9rem', display: 'flex', gap: '0.5rem' }}>
                    <FiAlertCircle style={{ flexShrink: 0, marginTop: '0.2rem' }} />
                    {server.lastError}
                  </div>
                )}
                
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                      CAPABILITIES / TOOLS ({server.tools.length})
                    </div>
                  </div>
                  
                  {server.tools.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.75rem' }}>
                      {server.tools.map(tool => (
                        <div key={tool.name} style={{ 
                          padding: '0.75rem', 
                          borderRadius: '10px', 
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--border-glass)'
                        }}>
                          <div className="mono" style={{ fontWeight: 700, color: 'var(--neon-cyan)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                            {tool.name}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {tool.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      No active tools discovered from this server.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  fontWeight: 800,
  color: 'var(--text-muted)',
  marginBottom: '0.5rem',
  letterSpacing: '0.1em'
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.8rem 1rem',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid var(--border-glass)',
  color: 'var(--text-primary)',
  fontSize: '0.9rem',
  outline: 'none',
  transition: 'border-color 0.2s',
};
