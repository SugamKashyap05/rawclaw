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
      className="harness-status-panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.25rem 0.75rem',
        margin: '0 0 0.5rem 0',
        borderRadius: 0,
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'transparent',
        fontSize: '0.65rem',
        gap: '0.5rem',
        height: 36,
        maxHeight: 36,
      }}
    >
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        
        {/* Session ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <FiHash size={10} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>S:</span>
          <span className="mono" style={{ color: 'var(--text-primary)' }}>
            {sessionId ? sessionId.slice(0, 6) + '...' : 'none'}
          </span>
        </div>

        {/* Agent */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <FiCpu size={10} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>A:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {agentName || 'Default'}
          </span>
        </div>

        {/* Model / Complexity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <FiActivity size={10} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>
            {modelMode === 'complexity' ? 'Route:' : 'M:'}
          </span>
          <span style={{ color: 'var(--text-primary)' }}>
            {modelDisplayLabel}
          </span>
        </div>

        {/* MCP Servers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <FiServer size={10} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>MCP:</span>
          <span style={{ color: mcpCount > 0 ? 'var(--success, #10b981)' : 'var(--text-primary)', fontWeight: 500 }}>
            {mcpCount}
          </span>
        </div>

        {/* Pending tasks - only show if nonzero */}
        {pendingTasks > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <span style={{ color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>
              {pendingTasks} pend
            </span>
          </div>
        )}

      </div>

      {/* Health Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.6rem' }}>BE:</span>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.15rem',
          color: overallHealth === 'ok'
            ? 'var(--success, #10b981)'
            : overallHealth === 'degraded'
              ? 'var(--warning, #f59e0b)'
              : 'var(--error, #ef4444)',
        }}>
          {overallHealth === 'ok' ? <FiCheckCircle size={11} /> : <FiAlertCircle size={11} />}
          <span style={{
            fontWeight: 600,
            textTransform: 'uppercase',
            fontSize: '0.6rem',
            letterSpacing: '0.5px',
          }}>{overallHealth}</span>
        </div>
      </div>
    </div>
  );
}
