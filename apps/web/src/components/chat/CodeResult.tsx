import { ToolResult } from '@rawclaw/shared';
import { ToolActivityCard } from './ToolActivityCard';
import { toRecord, asString, CollapsiblePre } from './toolResultUtils';

export function CodeResult({ result, framed = true }: { result: ToolResult; framed?: boolean }) {
  const payload = toRecord(result.output);
  const code = asString(payload.code) || asString(result.input?.code) || 'No code captured.';
  const output = asString(payload.output) || asString(payload.stdout) || JSON.stringify(result.output, null, 2);

  const body = (
    <>
      <CollapsiblePre>{code}</CollapsiblePre>
      <CollapsiblePre>{output}</CollapsiblePre>
    </>
  );

  if (!framed) {
    return body;
  }

  return (
    <ToolActivityCard sourceLabel="Code Execution" status={result.error ? 'failed' : 'success'} durationMs={result.duration_ms}>
      {body}
    </ToolActivityCard>
  );
}
