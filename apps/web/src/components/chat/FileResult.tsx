import { ToolResult } from '@rawclaw/shared';
import { ToolActivityCard } from './ToolActivityCard';
import { toRecord, asString, CollapsiblePre } from './toolResultUtils';

export function FileResult({ result, framed = true }: { result: ToolResult; framed?: boolean }) {
  const payload = toRecord(result.output);
  const path = asString(payload.path) || asString(result.input?.path) || 'Unknown file';
  const content = asString(payload.content) || JSON.stringify(result.output, null, 2);

  const body = (
    <>
      <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        {path}
      </div>
      <CollapsiblePre>{content}</CollapsiblePre>
    </>
  );

  if (!framed) {
    return body;
  }

  return (
    <ToolActivityCard sourceLabel="File Result" status={result.error ? 'failed' : 'success'} durationMs={result.duration_ms}>
      {body}
    </ToolActivityCard>
  );
}
