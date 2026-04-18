import { ToolResult } from '@rawclaw/shared';
import { toRecord, asString, ToolResultHeader, CollapsiblePre } from './toolResultUtils';

export function TerminalResult({ result }: { result: ToolResult }) {
  const payload = toRecord(result.output);
  const command = asString(payload.command) || asString(result.input?.command) || 'Unknown command';
  const stdout = asString(payload.stdout) || asString(payload.output);
  const stderr = asString(payload.stderr) || result.error;
  const exitCode = typeof payload.exit_code === 'number' ? payload.exit_code : typeof payload.exitCode === 'number' ? payload.exitCode : undefined;

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
      <ToolResultHeader label="TERMINAL RESULT" result={result} />
      <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        {command}
      </div>
      {typeof exitCode === 'number' ? (
        <div className="mono" style={{ fontSize: '0.72rem', color: exitCode === 0 ? 'var(--success)' : 'var(--warning)' }}>
          Exit code: {exitCode}
        </div>
      ) : null}
      {stdout ? <CollapsiblePre>{stdout}</CollapsiblePre> : null}
      {stderr ? <CollapsiblePre errorStyle>{stderr}</CollapsiblePre> : null}
    </div>
  );
}
