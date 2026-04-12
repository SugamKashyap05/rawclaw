import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ApiHealth, AgentHealth, ToolHealthStatus } from '@rawclaw/shared';
import { FiBox, FiLink, FiTool, FiAlertTriangle, FiCheck, FiX } from 'react-icons/fi';

interface SystemStatus {
  api: 'ok' | 'degraded' | 'down' | 'loading';
  agent: 'ok' | 'down' | 'loading';
  redis: 'ok' | 'down' | 'loading';
  agent_providers?: Record<string, { status: string }>;
}

interface ToolsHealthResponse {
  health: Record<string, ToolHealthStatus>;
}

interface MCPStatus {
  connected: boolean;
  servers: string[];
  connected_count: number;
}

export default function Dashboard() {
  const [status, setStatus] = useState<SystemStatus>({
    api: 'loading',
    agent: 'loading',
    redis: 'loading'
  });
  const [toolsHealth, setToolsHealth] = useState<Record<string, ToolHealthStatus>>({});
  const [mcpStatus, setMcpStatus] = useState<MCPStatus>({ connected: false, servers: [], connected_count: 0 });

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const [apiRes, agentRes, toolsRes, mcpRes] = await Promise.all([
          axios.get<ApiHealth>('/api/health').catch(() => null),
          axios.get<AgentHealth>('/agent/health').catch(() => null),
          axios.get<ToolsHealthResponse>('/api/tools/health').catch(() => null),
          axios.get<MCPStatus>('/api/mcp/health').catch(() => null),
        ]);

        setStatus({
          api: apiRes?.data?.status || 'down',
          agent: agentRes?.data?.status || 'down',
          redis: apiRes?.data?.services?.redis || 'down',
          agent_providers: (agentRes?.data as any)?.providers
        });

        if (toolsRes?.data?.health) {
          setToolsHealth(toolsRes.data.health);
        }

        if (mcpRes?.data) {
          setMcpStatus(mcpRes.data);
        }
      } catch (err) {
        console.error('Health check failed', err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const getHealthColor = (s: string) => {
    switch (s) {
      case 'ok': return 'var(--success-green)';
      case 'degraded': return 'var(--warning-amber)';
      default: return 'var(--error-red)';
    }
  };

  const toolHealthList = Object.entries(toolsHealth);
  const okTools = toolHealthList.filter(([, h]) => h.status === 'ok').length;
  const degradedTools = toolHealthList.filter(([, h]) => h.status === 'degraded').length;
  const unavailableTools = toolHealthList.filter(([, h]) => h.status === 'unavailable').length;

  return (
    <div className="dashboard">
      <h1>System Overview</h1>
      <div className="dashboard-grid">
        <div className="status-card">
          <div className="service-info">
            <h3>API Gateway</h3>
            <p>Node.js / NestJS</p>
          </div>
          <div className={`status-dot ${status.api}`}></div>
        </div>

        <div className="status-card">
          <div className="service-info">
            <h3>AI Agent</h3>
            <p>Python / FastAPI</p>
          </div>
          <div className={`status-dot ${status.agent}`}></div>
        </div>

        <div className="status-card">
          <div className="service-info">
            <h3>Session Cache</h3>
            <p>Redis Stack</p>
          </div>
          <div className={`status-dot ${status.redis}`}></div>
        </div>

        {status.agent_providers && (
          <div className="status-card">
            <div className="service-info">
              <h3>Model Routing</h3>
              <p>{Object.keys(status.agent_providers).length} Providers Online</p>
            </div>
            <div className="status-dot ok"></div>
          </div>
        )}
      </div>

      {/* Tools Health Summary */}
      <div className="section-card">
        <div className="section-header">
          <h2><FiTool /> Tools Health</h2>
          <Link to="/tools" className="section-link">View All</Link>
        </div>
        <div className="tools-health-row">
          {toolHealthList.length === 0 ? (
            <div className="loading-text">Loading tools...</div>
          ) : (
            toolHealthList.slice(0, 12).map(([name, health]) => (
              <div key={name} className="tool-health-item" title={`${name}: ${health.status}`}>
                <div
                  className="tool-health-dot"
                  style={{ backgroundColor: getHealthColor(health.status) }}
                />
                <span className="tool-health-name">{name}</span>
              </div>
            ))
          )}
        </div>
        <div className="tools-health-summary">
          <span className="summary-ok"><FiCheck /> {okTools} OK</span>
          {degradedTools > 0 && (
            <span className="summary-degraded"><FiAlertTriangle /> {degradedTools} Degraded</span>
          )}
          {unavailableTools > 0 && (
            <span className="summary-unavailable"><FiX /> {unavailableTools} Unavailable</span>
          )}
        </div>
      </div>

      {/* MCP Connection Status */}
      <div className="section-card">
        <div className="section-header">
          <h2><FiLink /> MCP Gateway</h2>
        </div>
        <div className="mcp-status">
          {mcpStatus.connected ? (
            <div className="mcp-connected">
              <FiCheck className="status-icon ok" />
              <span>Connected ({mcpStatus.connected_count} servers)</span>
              <div className="mcp-servers">
                {mcpStatus.servers.map(s => (
                  <span key={s} className="server-tag">{s}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="mcp-disconnected">
              <FiBox className="status-icon muted" />
              <span>Not connected</span>
              <Link to="/tools" className="connect-link">Connect Gateway</Link>
            </div>
          )}
        </div>
      </div>

      {/* Model Providers */}
      <div className="system-logs">
        <h2>Active Model Providers</h2>
        <div className="provider-list">
          {status.agent_providers ? Object.entries(status.agent_providers).map(([name, info]) => (
            <div key={name} className="provider-item">
              <strong>{name.toUpperCase()}</strong>: {info.status}
            </div>
          )) : <p>Loading provider status...</p>}
        </div>
      </div>

      <style>{`
        .dashboard {
          padding: 2rem;
          max-width: 1200px;
          margin: 0 auto;
        }
        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .status-card {
          background: var(--panel-bg);
          border: 1px solid var(--glass-border);
          border-radius: 16px;
          padding: 1.25rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .service-info h3 {
          margin: 0;
          font-size: 1rem;
        }
        .service-info p {
          margin: 0.25rem 0 0 0;
          color: var(--text-muted);
          font-size: 0.875rem;
        }
        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        .status-dot.ok { background: var(--success-green); }
        .status-dot.degraded { background: var(--warning-amber); }
        .status-dot.down, .status-dot.loading { background: var(--error-red); }

        .section-card {
          background: var(--panel-bg);
          border: 1px solid var(--glass-border);
          border-radius: 16px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }
        .section-header h2 {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1rem;
        }
        .section-link {
          color: var(--accent-cyan);
          text-decoration: none;
          font-size: 0.875rem;
        }
        .tools-health-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }
        .tool-health-item {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }
        .tool-health-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .tool-health-name {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .tools-health-summary {
          display: flex;
          gap: 1rem;
          font-size: 0.875rem;
        }
        .summary-ok { color: var(--success-green); }
        .summary-degraded { color: var(--warning-amber); }
        .summary-unavailable { color: var(--error-red); }

        .mcp-status {
          padding: 1rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
        }
        .mcp-connected, .mcp-disconnected {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .status-icon.ok { color: var(--success-green); }
        .status-icon.muted { color: var(--text-muted); }
        .mcp-servers {
          display: flex;
          gap: 0.5rem;
          margin-left: auto;
        }
        .server-tag {
          background: rgba(0, 200, 200, 0.1);
          color: var(--accent-cyan);
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
        }
        .connect-link {
          color: var(--accent-cyan);
          text-decoration: none;
          margin-left: auto;
        }
        .loading-text {
          color: var(--text-muted);
        }

        .system-logs {
          background: var(--panel-bg);
          padding: 2rem;
          border-radius: 16px;
          border: 1px solid var(--glass-border);
        }
        .provider-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }
        .provider-item {
          background: rgba(0,0,0,0.2);
          padding: 1rem;
          border-radius: 8px;
          border-left: 4px solid var(--accent-cyan);
        }
      `}</style>
    </div>
  );
}