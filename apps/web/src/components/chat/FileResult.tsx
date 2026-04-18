import { ToolResult } from '@rawclaw/shared';
import { toRecord, asString, ToolResultHeader, CollapsiblePre } from './toolResultUtils';

export function FileResult({ result }: { result: ToolResult }) {
  const payload = toRecord(result.output);
  const path = asString(payload.path) || asString(result.input?.path) || 'Unknown file';
  const content = asString(payload.content) || JSON.stringify(result.output, null, 2);

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
      <ToolResultHeader label="FILE RESULT" result={result} />
      <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        {path}
      </div>
      <CollapsiblePre>{content}</CollapsiblePre>
    </div>
  );
}
