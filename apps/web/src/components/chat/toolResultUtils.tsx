import { useState } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { ToolResult } from '@rawclaw/shared';

// ─── Shared helpers ───────────────────────────────────

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Format ms into a human-readable string like "1.2s" or "340ms" */
export function formatDuration(ms?: number): string | null {
  if (typeof ms !== 'number') return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Derive execution status from a ToolResult conservatively */
export type ToolExecStatus = 'SUCCESS' | 'FAILED';

export function deriveStatus(result: ToolResult): ToolExecStatus {
  if (result.error) return 'FAILED';
  return 'SUCCESS';
}

const statusColors: Record<ToolExecStatus, string> = {
  SUCCESS: 'var(--success, #10b981)',
  FAILED: 'var(--error, #ef4444)',
};

// ─── Reusable UI pieces ────────────────────────────────

/** Small colored status badge */
export function StatusBadge({ status }: { status: ToolExecStatus }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.5px',
        padding: '0.15rem 0.5rem',
        borderRadius: '4px',
        color: statusColors[status],
        background: status === 'FAILED' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.10)',
      }}
    >
      {status}
    </span>
  );
}

/** Tool result header row: label + badge + duration */
export function ToolResultHeader({
  label,
  result,
}: {
  label: string;
  result: ToolResult;
}) {
  const status = deriveStatus(result);
  const dur = formatDuration(result.duration_ms);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
      <span className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem' }}>
        {label}
      </span>
      <StatusBadge status={status} />
      {dur && (
        <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {dur}
        </span>
      )}
    </div>
  );
}

/** Expandable pre block that collapses when content exceeds `collapsedHeight` */
export function CollapsiblePre({
  children,
  collapsedHeight = 200,
  errorStyle = false,
}: {
  children: string;
  collapsedHeight?: number;
  errorStyle?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = !expanded && children.split('\n').length > 12;

  return (
    <div style={{ position: 'relative' }}>
      <pre
        className="custom-scrollbar"
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          maxHeight: shouldCollapse ? `${collapsedHeight}px` : 'none',
          overflow: shouldCollapse ? 'hidden' : 'auto',
          padding: '0.85rem',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.03)',
          color: errorStyle ? 'var(--error)' : undefined,
          fontSize: '0.82rem',
          lineHeight: 1.5,
        }}
      >
        {children}
      </pre>
      {shouldCollapse && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '0.6rem 0',
            textAlign: 'center',
            background: 'linear-gradient(transparent, rgba(8,8,14,0.95) 60%)',
            border: 'none',
            color: 'var(--neon-cyan)',
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontWeight: 600,
            borderRadius: '0 0 12px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
          }}
        >
          Show more <FiChevronDown size={14} />
        </button>
      )}
      {expanded && children.split('\n').length > 12 && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            width: '100%',
            marginTop: '0.3rem',
            textAlign: 'center',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
          }}
        >
          Collapse <FiChevronUp size={14} />
        </button>
      )}
    </div>
  );
}
