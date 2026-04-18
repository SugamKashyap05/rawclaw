import { FiServer, FiCpu, FiHash, FiCheckCircle, FiAlertCircle, FiActivity } from 'react-icons/fi';
import { SystemStatusSnapshot } from '@rawclaw/shared';

interface Props {
  sessionId?: string;
  agentName: string | null;
  modelDisplayLabel: string;
  modelMode: 'complexity' | 'direct';
  systemStatus: SystemStatusSnapshot | null;
}

/**
 * Compact status bar showing live harness state at a glance.
 *
 * Provider derivation: we do NOT guess provider from model string.
 * - In complexity routing mode we show "Complexity: <level>"
 * - In direct mode we show the model ID as-is (the backend resolves the provider)
 */
export function HarnessStatusPanel({ sessionId, agentName, modelDisplayLabel, modelMode, systemStatus }: Props) {
  const apiUp = systemStatus?.services?.api === 'ok';
  const agentUp = systemStatus?.services?.agent === 'ok';
  const overallHealth = apiUp && agentUp ? 'ok' : (!apiUp && !agentUp ? 'down' : 'degraded');
  const mcpCount = systemStatus?.counts?.mcpServers ?? 0;
  const pendingTasks = systemStatus?.counts?.pendingTasks ?? 0;

  return (
    <div 
      className="harness-status-panel glass-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.6rem 1rem',
        margin: '0 0 0.75rem 0',
        borderRadius: '8px',
        border: '1px solid var(--border-glass)',
        background: 'rgba(0, 0, 0, 0.2)',
        fontSize: '0.85rem',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        
        {/* Session ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FiHash size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Session:</span>
          <span className="mono" style={{ color: 'var(--text-primary)', fontSize: '0.82rem' }}>
            {sessionId ? sessionId.slice(0, 8) + '\u2026' : 'none'}
          </span>
        </div>

        {/* Agent */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FiCpu size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Agent:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '0.82rem' }}>
            {agentName || 'Default'}
          </span>
        </div>

        {/* Model / Complexity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FiActivity size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            {modelMode === 'complexity' ? 'Route:' : 'Model:'}
          </span>
          <span style={{ color: 'var(--text-primary)', fontSize: '0.82rem' }}>
            {modelDisplayLabel}
          </span>
        </div>

        {/* MCP Servers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FiServer size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>MCPs:</span>
          <span style={{ color: mcpCount > 0 ? 'var(--success, #10b981)' : 'var(--text-primary)', fontWeight: 500, fontSize: '0.82rem' }}>
            {mcpCount}
          </span>
        </div>

        {/* Pending tasks — only show if nonzero */}
        {pendingTasks > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: 'var(--warning, #f59e0b)', fontWeight: 600, fontSize: '0.82rem' }}>
              {pendingTasks} pending
            </span>
          </div>
        )}

      </div>

      {/* Health Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Backend:</span>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          color: overallHealth === 'ok'
            ? 'var(--success, #10b981)'
            : overallHealth === 'degraded'
              ? 'var(--warning, #f59e0b)'
              : 'var(--error, #ef4444)',
        }}>
          {overallHealth === 'ok' ? <FiCheckCircle size={14} /> : <FiAlertCircle size={14} />}
          <span style={{
            fontWeight: 600,
            textTransform: 'uppercase',
            fontSize: '0.72rem',
            letterSpacing: '0.5px',
          }}>{overallHealth}</span>
        </div>
      </div>
    </div>
  );
}
