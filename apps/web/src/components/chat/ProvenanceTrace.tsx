import { ProvenanceTrace as IProvenanceTrace } from '@rawclaw/shared';
import { useState } from 'react';
import { FiActivity, FiTool, FiCheckCircle, FiCpu, FiAlertTriangle, FiZap, FiChevronDown, FiChevronUp } from 'react-icons/fi';

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
        return <FiActivity size={10} />;
      case 'tool_call':
        return <FiTool size={10} />;
      case 'tool_result':
        return <FiCheckCircle size={10} />;
      case 'synthesis':
        return <FiZap size={10} />;
      case 'error':
        return <FiAlertTriangle size={10} />;
      default:
        return <FiCpu size={10} />;
    }
  };

  const getTimeStatus = (ms: number) => {
    if (ms < 500) return { color: '#00ffa3', label: 'Fast' };
    if (ms < 2000) return { color: '#ffcc00', label: 'Norm' };
    return { color: '#ff4d4d', label: 'Slow' };
  };

  return (
    <div
      className="provenance-container"
      style={{
        marginTop: '0.5rem',
        padding: 0,
        background: 'transparent',
        borderRadius: 0,
        border: 'none',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        fontSize: '0.65rem',
      }}
    >
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.35rem 0.5rem',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          fontSize: '0.65rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          userSelect: 'none',
          height: 32,
          maxHeight: 32,
          overflow: 'hidden',
        }}
      >
        <FiActivity style={{ color: 'var(--neon-cyan)' }} size={10} />
        TRACE
        {summary && !isExpanded && (
          <span style={{ 
            color: 'var(--text-muted)', 
            textTransform: 'none', 
            fontWeight: 400, 
            letterSpacing: 'normal',
            marginLeft: '0.3rem',
          }}>
            {summary.brief?.slice(0, 40) || ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.6rem', opacity: 0.5, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {isExpanded ? <FiChevronUp size={10} /> : <FiChevronDown size={10} />}
          {traceId.slice(0, 6)}
        </span>
      </div>

      {isExpanded && (
        <div style={{ display: 'grid', gap: '0.35rem', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
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
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.35rem 0.5rem',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '4px',
                borderLeft: `2px solid ${timing.color}`,
                fontSize: '0.65rem',
              }}
            >
              <span style={{ display: 'flex', color: timing.color }}>{getIcon(stepType)}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: 'var(--text-main)', textTransform: 'capitalize', fontSize: '0.65rem' }}>
                  {stepType.replace('_', ' ')}
                  {toolName ? <span style={{ color: 'var(--neon-cyan)', marginLeft: '0.25rem', fontSize: '0.6rem' }}>({toolName})</span> : null}
                </div>
                {outputSummary ? (
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {outputSummary.slice(0, 60)}
                  </div>
                ) : null}
              </div>

              <div style={{ textAlign: 'right', fontSize: '0.55rem', color: timing.color }}>
                {duration}ms
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
};
