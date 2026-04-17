import { ToolResult } from '@rawclaw/shared';

export function TerminalResult({ result }: { result: ToolResult }) {
  const payload = toRecord(result.output);
  const command = asString(payload.command) || asString(result.input?.command) || 'Unknown command';
  const stdout = asString(payload.stdout) || asString(payload.output);
  const stderr = asString(payload.stderr) || result.error;
  const exitCode = typeof payload.exit_code === 'number' ? payload.exit_code : typeof payload.exitCode === 'number' ? payload.exitCode : undefined;

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
      <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem' }}>
        TERMINAL RESULT
      </div>
      <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        {command}
      </div>
      {typeof exitCode === 'number' ? (
        <div className="mono" style={{ fontSize: '0.72rem', color: exitCode === 0 ? 'var(--success)' : 'var(--warning)' }}>
          Exit code: {exitCode}
        </div>
      ) : null}
      {stdout ? <pre className="custom-scrollbar" style={panelStyle}>{stdout}</pre> : null}
      {stderr ? <pre className="custom-scrollbar" style={{ ...panelStyle, color: 'var(--error)' }}>{stderr}</pre> : null}
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
