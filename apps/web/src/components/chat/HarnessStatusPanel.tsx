import { FiServer, FiCpu, FiHash, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { SystemStatusSnapshot } from '@rawclaw/shared';

interface Props {
  sessionId?: string;
  selectedAgentId: string;
  selectedModel: string;
  systemStatus: SystemStatusSnapshot | null;
}

export function HarnessStatusPanel({ sessionId, selectedAgentId, selectedModel, systemStatus }: Props) {
  // Determine global health safely
  const apiUp = systemStatus?.services?.api === 'ok';
  const agentUp = systemStatus?.services?.agent === 'ok';
  const overallHealth = apiUp && agentUp ? 'ok' : (!apiUp && !agentUp ? 'down' : 'degraded');
  const mcpCount = systemStatus?.counts?.mcpServers ?? 0;

  // Determine provider family roughly based on model string
  const providerFamily = selectedModel.includes('claude') ? 'Anthropic' : 
                         selectedModel.includes('gpt') ? 'OpenAI' : 
                         selectedModel.includes('ollama') ? 'Ollama' : 'Unknown';

  return (
    <div 
      className="harness-status-panel glass-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.6rem 1rem',
        margin: '0 0 1rem 0',
        borderRadius: '8px',
        border: '1px solid var(--border-glass)',
        background: 'rgba(0, 0, 0, 0.2)',
        fontSize: '0.85rem'
      }}
    >
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        
        {/* Session ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FiHash style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>Session:</span>
          <span className="mono" style={{ color: 'var(--text-primary)' }}>{sessionId ? sessionId.slice(0,8) + '...' : 'none'}</span>
        </div>

        {/* Agent & Model */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FiCpu style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>Agent:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{selectedAgentId || 'Default'}</span>
          <span style={{ color: 'var(--text-muted)', margin: '0 0.2rem' }}>|</span>
          <span style={{ color: 'var(--text-primary)' }}>{selectedModel.split(':').pop()}</span>
          <span className="mono" style={{ fontSize: '0.75rem', background: 'var(--border-glass)', padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: '0.4rem' }}>
            {providerFamily}
          </span>
        </div>

        {/* MCP Servers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FiServer style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>MCPs:</span>
          <span style={{ color: mcpCount > 0 ? 'var(--neon-green)' : 'var(--text-primary)', fontWeight: 500 }}>{mcpCount}</span>
        </div>

      </div>

      {/* Health Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Backend:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: overallHealth === 'ok' ? 'var(--success)' : (overallHealth === 'degraded' ? 'var(--warning)' : 'var(--error)') }}>
          {overallHealth === 'ok' ? <FiCheckCircle /> : <FiAlertCircle />}
          <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.5px' }}>{overallHealth}</span>
        </div>
      </div>
    </div>
  );
}
