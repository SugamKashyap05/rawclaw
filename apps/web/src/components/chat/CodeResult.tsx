import { ToolResult } from '@rawclaw/shared';

export function CodeResult({ result }: { result: ToolResult }) {
  const payload = toRecord(result.output);
  const code = asString(payload.code) || asString(result.input?.code) || 'No code captured.';
  const output = asString(payload.output) || asString(payload.stdout) || JSON.stringify(result.output, null, 2);

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.85rem' }}>
      <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem' }}>
        CODE EXECUTION
      </div>
      <pre className="custom-scrollbar" style={panelStyle}>{code}</pre>
      <pre className="custom-scrollbar" style={panelStyle}>{output}</pre>
    </div>
  );
}

const panelStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
  overflowX: 'auto' as const,
  maxHeight: '220px',
  padding: '0.85rem',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.03)',
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
