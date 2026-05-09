import React from 'react';
import { formatDuration } from './toolResultUtils';

export type ToolActivityStatus = 'success' | 'failed' | 'degraded' | 'skipped';

const STATUS_META: Record<
  ToolActivityStatus,
  { label: string; color: string; background: string; border: string }
> = {
  success: {
    label: 'SUCCESS',
    color: 'var(--success, #10b981)',
    background: 'rgba(16,185,129,0.10)',
    border: '1px solid rgba(16,185,129,0.18)',
  },
  failed: {
    label: 'FAILED',
    color: 'var(--error, #ef4444)',
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.2)',
  },
  degraded: {
    label: 'DEGRADED',
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.12)',
    border: '1px solid rgba(245,158,11,0.2)',
  },
  skipped: {
    label: 'SKIPPED',
    color: '#c084fc',
    background: 'rgba(192,132,252,0.12)',
    border: '1px solid rgba(192,132,252,0.2)',
  },
};

export function ToolActivityCard({
  sourceLabel,
  sourceTitle,
  status,
  durationMs,
  children,
}: {
  sourceLabel: string;
  sourceTitle?: string;
  status: ToolActivityStatus;
  durationMs?: number | null;
  children: React.ReactNode;
}) {
  const durationLabel = typeof durationMs === 'number' && durationMs > 0 ? formatDuration(durationMs) : null;
  const meta = STATUS_META[status];

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span
          className="mono"
          title={sourceTitle || sourceLabel}
          style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem' }}
        >
          {sourceLabel}
        </span>
        <span
          className="mono"
          style={{
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.5px',
            padding: '0.15rem 0.5rem',
            borderRadius: '4px',
            color: meta.color,
            background: meta.background,
            border: meta.border,
          }}
        >
          {meta.label}
        </span>
        {durationLabel ? (
          <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {durationLabel}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
