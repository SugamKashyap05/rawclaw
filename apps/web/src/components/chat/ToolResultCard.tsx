import { useMemo, useState } from 'react';
import { ToolResult } from '@rawclaw/shared';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { ToolActivityCard } from './ToolActivityCard';
import {
  buildToolNarrative,
  getToolTrustSignals,
  resolveToolResultStatus,
  shouldExpandToolDetailsByDefault,
  toolResultSourceLabel,
} from './toolResultNarratives';

function signalStyle(tone: 'info' | 'warning' | 'neutral') {
  switch (tone) {
    case 'warning':
      return {
        color: '#f59e0b',
        background: 'rgba(245,158,11,0.12)',
        border: '1px solid rgba(245,158,11,0.2)',
      };
    case 'neutral':
      return {
        color: '#c084fc',
        background: 'rgba(192,132,252,0.12)',
        border: '1px solid rgba(192,132,252,0.2)',
      };
    default:
      return {
        color: 'var(--neon-cyan)',
        background: 'rgba(0,240,255,0.08)',
        border: '1px solid rgba(0,240,255,0.2)',
      };
  }
}

export function ToolResultCard({
  result,
  sourceLabel,
  children,
}: {
  result: ToolResult;
  sourceLabel?: string;
  children: React.ReactNode;
}) {
  const status = resolveToolResultStatus(result);
  const narrative = useMemo(() => buildToolNarrative(result), [result]);
  const trustSignals = useMemo(() => getToolTrustSignals(result), [result]);
  const [expanded, setExpanded] = useState(() => shouldExpandToolDetailsByDefault(result));

  return (
    <ToolActivityCard
      sourceLabel={sourceLabel || toolResultSourceLabel(result)}
      sourceTitle={result.tool_name}
      status={status}
      durationMs={result.duration_ms}
    >
      <div style={{ display: 'grid', gap: '0.85rem' }}>
        <div style={{ color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: 1.55 }}>
          {narrative}
        </div>

        {trustSignals.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
            {trustSignals.map((signal) => {
              const style = signalStyle(signal.tone);
              return (
                <span
                  key={`${signal.label}-${signal.tone}`}
                  className="mono"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontSize: '0.68rem',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    ...style,
                  }}
                >
                  {signal.label}
                </span>
              );
            })}
          </div>
        ) : null}

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.7rem', display: 'grid', gap: '0.65rem' }}>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            style={{
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              background: 'transparent',
              border: 'none',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
            Technical details
          </button>

          {expanded ? <div style={{ display: 'grid', gap: '0.75rem' }}>{children}</div> : null}
        </div>
      </div>
    </ToolActivityCard>
  );
}
