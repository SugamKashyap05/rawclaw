import { ProvenanceTrace as IProvenanceTrace } from '@rawclaw/shared';
import { FiActivity, FiTool, FiCheckCircle, FiCpu, FiAlertTriangle, FiZap } from 'react-icons/fi';

interface ProvenanceTraceProps {
  trace: Partial<IProvenanceTrace> | null | undefined;
}

export const ProvenanceTrace: React.FC<ProvenanceTraceProps> = ({ trace }) => {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const traceId = typeof trace?.run_id === 'string' && trace.run_id.trim() ? trace.run_id : 'unknown';

  if (!steps.length) {
    return null;
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'plan':
        return <FiActivity />;
      case 'tool_call':
        return <FiTool />;
      case 'tool_result':
        return <FiCheckCircle />;
      case 'synthesis':
        return <FiZap />;
      case 'error':
        return <FiAlertTriangle />;
      default:
        return <FiCpu />;
    }
  };

  const getTimeStatus = (ms: number) => {
    if (ms < 500) return { color: '#00ffa3', label: 'Fast' };
    if (ms < 2000) return { color: '#ffcc00', label: 'Normal' };
    return { color: '#ff4d4d', label: 'Slow' };
  };

  return (
    <div
      className="provenance-container"
      style={{
        marginTop: '1rem',
        padding: '0.8rem',
        background: 'rgba(255, 255, 255, 0.02)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        fontSize: '0.8rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          marginBottom: '1rem',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          fontSize: '0.75rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase'
        }}
      >
        <FiActivity style={{ color: 'var(--neon-cyan)', filter: 'drop-shadow(0 0 5px var(--neon-cyan-glow))' }} />
        REASONING TRACE
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', opacity: 0.5 }}>ID: {traceId.slice(0, 8)}</span>
      </div>

      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {steps.map((step, idx) => {
          const duration = typeof step.duration_ms === 'number' ? step.duration_ms : 0;
          const timing = getTimeStatus(duration);
          const stepType = typeof step.step_type === 'string' ? step.step_type : 'unknown';
          const toolName = typeof step.tool_name === 'string' ? step.tool_name : null;
          const outputSummary = typeof step.output_summary === 'string' ? step.output_summary : '';

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.8rem',
                padding: '0.65rem 0.8rem',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                borderLeft: `2px solid ${timing.color}`,
                transition: 'transform 0.2s',
              }}
            >
              <span style={{ fontSize: '1rem', marginTop: '0.1rem', display: 'flex' }}>{getIcon(stepType)}</span>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, color: 'var(--text-main)', textTransform: 'capitalize' }}>
                  {stepType.replace('_', ' ')}
                  {toolName ? <span style={{ color: 'var(--neon-cyan)', marginLeft: '0.4rem' }}>({toolName})</span> : null}
                </div>
                {outputSummary ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {outputSummary}
                  </div>
                ) : null}
              </div>

              <div style={{ textAlign: 'right', fontSize: '0.7rem' }}>
                <div style={{ color: timing.color, fontWeight: 600 }}>{duration}ms</div>
                <div style={{ color: 'var(--text-muted)', opacity: 0.6 }}>{timing.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
