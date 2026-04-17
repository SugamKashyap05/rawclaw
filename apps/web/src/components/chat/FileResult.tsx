import { ToolResult } from '@rawclaw/shared';

export function FileResult({ result }: { result: ToolResult }) {
  const payload = toRecord(result.output);
  const path = asString(payload.path) || asString(result.input?.path) || 'Unknown file';
  const content = asString(payload.content) || JSON.stringify(result.output, null, 2);

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
      <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem' }}>
        FILE RESULT
      </div>
      <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        {path}
      </div>
      <pre
        className="custom-scrollbar"
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          maxHeight: '260px',
          padding: '0.85rem',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        {content}
      </pre>
    </div>
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
