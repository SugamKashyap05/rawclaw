import React from 'react';
import { ProvenanceTrace as IProvenanceTrace } from '@rawclaw/shared';

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
        return '[P]';
      case 'tool_call':
        return '[T]';
      case 'tool_result':
        return '[R]';
      case 'synthesis':
        return '[S]';
      case 'error':
        return '[!]';
      default:
        return '[*]';
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
          gap: '0.5rem',
          marginBottom: '0.8rem',
          color: 'var(--text-muted)',
          fontWeight: 600,
          letterSpacing: '0.05em',
        }}
      >
        <span style={{ fontSize: '1rem' }}>[TRACE]</span>
        RAWCLAW REASONING TRACE
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
                alignItems: 'center',
                gap: '0.8rem',
                padding: '0.5rem 0.8rem',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                borderLeft: `3px solid ${timing.color}`,
              }}
            >
              <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>{getIcon(stepType)}</span>

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
