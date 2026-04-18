import { ToolResult } from '@rawclaw/shared';
import { toRecord, asString, ToolResultHeader, CollapsiblePre } from './toolResultUtils';

export function CodeResult({ result }: { result: ToolResult }) {
  const payload = toRecord(result.output);
  const code = asString(payload.code) || asString(result.input?.code) || 'No code captured.';
  const output = asString(payload.output) || asString(payload.stdout) || JSON.stringify(result.output, null, 2);

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.85rem' }}>
      <ToolResultHeader label="CODE EXECUTION" result={result} />
      <CollapsiblePre>{code}</CollapsiblePre>
      <CollapsiblePre>{output}</CollapsiblePre>
    </div>
  );
}
