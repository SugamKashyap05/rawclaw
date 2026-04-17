import { useEffect, useMemo, useState } from 'react';
import { MCPServerRecord } from '@rawclaw/shared';
import { api } from '../lib/api';

export default function MCPServers() {
  const [servers, setServers] = useState<MCPServerRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadServers();
    const timer = window.setInterval(() => void loadServers(false), 8000);
    return () => window.clearInterval(timer);
  }, []);

  const dockerServer = useMemo(
    () => servers.find((server) => server.name === 'docker-toolkit') || servers[0] || null,
    [servers],
  );

  const loadServers = async (showErrors = true) => {
    try {
      const response = await api.get<MCPServerRecord[]>('/mcp/servers');
      setServers(response.data);
      if (!response.data.length) {
        setMessage('RawClaw is still waiting for the Docker MCP toolkit to come online.');
      } else {
        setMessage(null);
      }
    } catch (error) {
      console.error('Failed to load MCP servers', error);
      if (showErrors) {
        setMessage('Unable to reach the MCP service right now.');
      }
    }
  };

  const runAction = async (id: string, action: 'start' | 'stop') => {
    setBusyId(id);
    setMessage(null);
    try {
      await api.post(`/mcp/servers/${id}/${action}`);
      await loadServers(false);
    } catch (error) {
      console.error(`Failed to ${action} MCP server`, error);
      setMessage(action === 'start' ? 'Docker MCP toolkit could not be started.' : 'Docker MCP toolkit could not be stopped.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.5rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Docker MCP Toolkit</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            RawClaw now prefers the local Docker gateway flow and will launch `docker mcp gateway run`
            automatically unless you explicitly switch to SSE mode.
          </p>
        </div>

        {message ? <div style={{ color: 'var(--text-secondary)' }}>{message}</div> : null}

        <div
          style={{
            border: '1px solid var(--border-glass)',
            borderRadius: '18px',
            padding: '1.25rem',
            background: 'rgba(255,255,255,0.03)',
            display: 'grid',
            gap: '0.9rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontWeight: 700, fontSize: '1.05rem' }}>
                <span className={`status-dot ${dockerServer?.status === 'running' ? 'ok' : dockerServer?.status === 'error' ? 'down' : 'loading'}`} />
                {dockerServer?.name || 'docker-toolkit'}
              </div>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                {dockerServer
                  ? `${dockerServer.type.toUpperCase()} | ${dockerServer.command} ${dockerServer.args.join(' ')}`
                  : 'Bootstrapping default Docker toolkit...'}
              </div>
            </div>
            {dockerServer ? (
              <button
                className="btn-primary"
                onClick={() => void runAction(dockerServer.id, dockerServer.status === 'running' ? 'stop' : 'start')}
                disabled={busyId === dockerServer.id}
              >
                {busyId === dockerServer.id ? 'WORKING...' : dockerServer.status === 'running' ? 'RESTART TOOLKIT' : 'START TOOLKIT'}
              </button>
            ) : (
              <button className="btn-primary" onClick={() => void loadServers(false)}>
                REFRESH
              </button>
            )}
          </div>

          {dockerServer?.lastError ? (
            <div style={{ color: 'var(--error)' }}>{dockerServer.lastError}</div>
          ) : null}

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                DISCOVERED TOOLS
              </div>
              <div className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                {dockerServer?.tools.length || 0} LOADED
              </div>
            </div>

            {dockerServer?.tools.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
                {dockerServer.tools.map((tool) => (
                  <div
                    key={tool.name}
                    style={{
                      border: '1px solid var(--border-glass)',
                      borderRadius: '14px',
                      padding: '0.9rem',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <div className="mono" style={{ fontSize: '0.78rem', marginBottom: '0.35rem', color: 'var(--neon-cyan)' }}>
                      {tool.name}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.5 }}>
                      {tool.description || 'Docker MCP exposed this tool without a description.'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>
                {dockerServer?.status === 'running'
                  ? 'The toolkit is connected, but it has not reported any tools yet.'
                  : 'The toolkit is not connected yet, so no tools are available.'}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
