import { useEffect, useState } from 'react';
import axios from 'axios';
import { ToolInfo } from '@rawclaw/shared';
import { FiTool, FiCheck, FiAlertTriangle, FiX, FiBox, FiLink } from 'react-icons/fi';

interface MCPServer {
  name: string;
  tool_count: number;
}

export default function Tools() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mcpConnected, setMcpConnected] = useState(false);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const [gatewayUrl] = useState('http://localhost:8811');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const fetchTools = async () => {
    try {
      const res = await axios.get<{ tools: ToolInfo[] }>('/api/tools/info');
      setTools(res.data.tools || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tools';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchMCPStatus = async () => {
    try {
      const res = await axios.get<{ connected: boolean; servers: MCPServer[] }>('/api/mcp/servers');
      setMcpConnected(res.data.connected || false);
      setMcpServers(res.data.servers || []);
    } catch {
      setMcpConnected(false);
      setMcpServers([]);
    }
  };

  useEffect(() => {
    fetchTools();
    fetchMCPStatus();
    const interval = setInterval(fetchTools, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fetchMCPStatus();
      setShowConnectPanel(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setConnectError(message);
    } finally {
      setConnecting(false);
    }
  };

  const builtinTools = tools.filter(t => !t.capability_tags.includes('mcp'));
  const mcpTools = tools.filter(t => t.capability_tags.includes('mcp'));

  const getHealthColor = (status: string): string => {
    switch (status) {
      case 'ok': return 'var(--success-green)';
      case 'degraded': return 'var(--warning-amber)';
      default: return 'var(--error-red)';
    }
  };

  const ToolCard = ({ tool }: { tool: ToolInfo }) => (
    <div className="tool-card">
      <div className="tool-card-header">
        <div className="tool-card-title">
          <FiTool />
          <span>{tool.name}</span>
        </div>
        <div
          className="tool-health-dot"
          style={{ backgroundColor: getHealthColor(tool.health_status.status) }}
          title={tool.health_status.reason || tool.health_status.status}
        />
      </div>
      <p className="tool-description">{tool.description}</p>
      <div className="tool-tags">
        {tool.capability_tags.map((tag: string) => (
          <span key={tag} className="tool-tag">{tag}</span>
        ))}
      </div>
      <div className="tool-badges">
        {tool.requires_confirmation && (
          <span className="tool-badge warning">
            <FiAlertTriangle /> Requires Confirmation
          </span>
        )}
        {tool.requires_sandbox && (
          <span className="tool-badge info">
            <FiBox /> Sandboxed
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="tools-page">
      <div className="tools-header">
        <div>
          <h1>Tools</h1>
          <p className="subtitle">Available tools and MCP connections</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowConnectPanel(!showConnectPanel)}
        >
          <FiLink /> Connect MCP Gateway
        </button>
      </div>

      {showConnectPanel && (
        <div className="connect-panel">
          <h3>Connect MCP Gateway</h3>
          <div className="connect-form">
            <label>
              Gateway URL
              <input
                type="text"
                value={gatewayUrl}
                readOnly
                placeholder="http://localhost:8811"
              />
            </label>
            <div className="connect-actions">
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setShowConnectPanel(false)}
              >
                Cancel
              </button>
            </div>
            {connectError && (
              <div className="connect-error">{connectError}</div>
            )}
          </div>
          <details className="advanced-options">
            <summary>Advanced Options</summary>
            <p>MCP gateway connection is configured via DOCKER_MCP_URL environment variable on the agent.</p>
          </details>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <FiX /> {error}
        </div>
      )}

      <div className="tools-grid">
        {/* Built-in Tools Section */}
        <div className="tools-section">
          <h2>Built-in Tools</h2>
          {loading ? (
            <div className="loading">Loading tools...</div>
          ) : builtinTools.length === 0 ? (
            <div className="empty-state">No built-in tools loaded</div>
          ) : (
            <div className="tool-cards-grid">
              {builtinTools.map(tool => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          )}
        </div>

        {/* MCP Tools Section */}
        <div className="tools-section">
          <h2>MCP Tools</h2>
          {!mcpConnected ? (
            <div className="empty-state">
              <FiLink />
              <p>Connect to Docker MCP Gateway to load MCP tools</p>
              <button
                className="btn btn-outline"
                onClick={() => setShowConnectPanel(true)}
              >
                Connect Gateway
              </button>
            </div>
          ) : mcpTools.length === 0 ? (
            <div className="empty-state">
              <FiCheck className="text-success" />
              <p>MCP Gateway connected, but no tools discovered</p>
            </div>
          ) : (
            <div className="tool-cards-grid">
              {mcpTools.map(tool => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          )}
          {mcpConnected && mcpServers.length > 0 && (
            <div className="mcp-servers-list">
              <h3>Connected Servers ({mcpServers.length})</h3>
              {mcpServers.map(server => (
                <div key={server.name} className="mcp-server-item">
                  <FiBox />
                  <span>{server.name}</span>
                  <span className="server-tools">{server.tool_count} tools</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .tools-page {
          padding: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }
        .tools-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 2rem;
        }
        .tools-header h1 {
          margin: 0;
        }
        .subtitle {
          color: var(--text-muted);
          margin: 0.5rem 0 0 0;
        }
        .connect-panel {
          background: var(--panel-bg);
          border: 1px solid var(--glass-border);
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 2rem;
        }
        .connect-panel h3 {
          margin: 0 0 1rem 0;
        }
        .connect-form label {
          display: block;
          margin-bottom: 1rem;
        }
        .connect-form input {
          width: 100%;
          padding: 0.75rem;
          margin-top: 0.5rem;
          background: var(--input-bg);
          border: 1px solid var(--glass-border);
          border-radius: 8px;
          color: var(--text-primary);
        }
        .connect-actions {
          display: flex;
          gap: 1rem;
          margin-top: 1rem;
        }
        .connect-error {
          color: var(--error-red);
          margin-top: 1rem;
        }
        .advanced-options {
          margin-top: 1rem;
          opacity: 0.7;
        }
        .tools-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
        }
        @media (max-width: 900px) {
          .tools-grid {
            grid-template-columns: 1fr;
          }
        }
        .tools-section h2 {
          margin: 0 0 1rem 0;
          font-size: 1.25rem;
        }
        .tool-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem;
        }
        .tool-card {
          background: var(--panel-bg);
          border: 1px solid var(--glass-border);
          border-radius: 12px;
          padding: 1rem;
        }
        .tool-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }
        .tool-card-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
        }
        .tool-health-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        .tool-description {
          color: var(--text-muted);
          font-size: 0.875rem;
          margin: 0.5rem 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tool-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .tool-tag {
          background: rgba(0, 200, 200, 0.1);
          color: var(--accent-cyan);
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
        }
        .tool-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .tool-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
        }
        .tool-badge.warning {
          background: rgba(255, 165, 0, 0.1);
          color: var(--warning-amber);
        }
        .tool-badge.info {
          background: rgba(0, 200, 200, 0.1);
          color: var(--accent-cyan);
        }
        .empty-state {
          text-align: center;
          padding: 2rem;
          color: var(--text-muted);
        }
        .empty-state svg {
          font-size: 2rem;
          margin-bottom: 1rem;
          opacity: 0.5;
        }
        .loading {
          text-align: center;
          padding: 2rem;
          color: var(--text-muted);
        }
        .mcp-servers-list {
          margin-top: 1rem;
          background: rgba(0, 0, 0, 0.2);
          padding: 1rem;
          border-radius: 8px;
        }
        .mcp-servers-list h3 {
          font-size: 0.875rem;
          margin: 0 0 0.5rem 0;
          color: var(--text-muted);
        }
        .mcp-server-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          margin-bottom: 0.5rem;
        }
        .server-tools {
          margin-left: auto;
          color: var(--text-muted);
          font-size: 0.75rem;
        }
        .error-banner {
          background: rgba(255, 0, 0, 0.1);
          color: var(--error-red);
          padding: 1rem;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
      `}</style>
    </div>
  );
}