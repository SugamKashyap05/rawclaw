import { ProvenanceTrace as IProvenanceTrace } from '@rawclaw/shared';
import { useState } from 'react';
import { FiActivity, FiTool, FiCheckCircle, FiCpu, FiAlertTriangle, FiZap, FiChevronDown, FiChevronUp, FiLink } from 'react-icons/fi';

interface ProvenanceTraceProps {
  trace: Partial<IProvenanceTrace> | null | undefined;
}

export const ProvenanceTrace: React.FC<ProvenanceTraceProps> = ({ trace }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const summary = trace?.summary;
  const traceId = typeof trace?.runId === 'string' ? trace.runId : (typeof (trace as any)?.run_id === 'string' ? (trace as any).run_id : 'unknown');

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
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: isExpanded ? '0 0.2rem 1rem 0.2rem' : '0 0.2rem',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          fontSize: '0.75rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <FiActivity style={{ color: 'var(--neon-cyan)', filter: 'drop-shadow(0 0 5px var(--neon-cyan-glow))' }} />
        REASONING TRACE
        {summary && !isExpanded && (
          <span style={{ 
            color: 'var(--text-muted)', 
            textTransform: 'none', 
            fontWeight: 400, 
            letterSpacing: 'normal',
            marginLeft: '0.4rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '320px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <span style={{ opacity: 0.5 }}>|</span>
            {summary.brief}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', opacity: 0.5, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {trace?.runIds && trace.runIds.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3rem', marginRight: '0.5rem' }}>
              {trace.runIds.slice(0, 2).map(rid => (
                <span key={rid} title={`Linked Task Run: ${rid}`} style={{ 
                  background: 'rgba(0, 255, 163, 0.1)', 
                  color: '#00ffa3', 
                  padding: '1px 5px', 
                  borderRadius: '4px', 
                  fontSize: '0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  border: '1px solid rgba(0, 255, 163, 0.2)'
                }}>
                  <FiLink size={8} /> {rid.slice(0, 6)}
                </span>
              ))}
            </div>
          )}
          {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
          ID: {traceId.slice(0, 8)}
        </span>
      </div>

      {isExpanded && (
        <div style={{ display: 'grid', gap: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
          {steps.map((step, idx) => {
            const rawStep = step as any;
            const duration = typeof step.durationMs === 'number' ? step.durationMs : (typeof rawStep.duration_ms === 'number' ? rawStep.duration_ms : 0);
            const timing = getTimeStatus(duration);
            const stepType = typeof step.stepType === 'string' ? step.stepType : (typeof rawStep.step_type === 'string' ? rawStep.step_type : 'unknown');
            const toolName = typeof step.toolName === 'string' ? step.toolName : (typeof rawStep.tool_name === 'string' ? rawStep.tool_name : null);
            const outputSummary = typeof step.outputSummary === 'string' ? step.outputSummary : (typeof rawStep.output_summary === 'string' ? rawStep.output_summary : '');

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
      )}
    </div>
  );
};
