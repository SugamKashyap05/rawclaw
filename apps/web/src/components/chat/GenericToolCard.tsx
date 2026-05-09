import { ToolResult } from '@rawclaw/shared';
import { ToolActivityCard } from './ToolActivityCard';
import { CollapsiblePre } from './toolResultUtils';

function humanizeToolName(toolName: string): string {
  const cleaned = String(toolName || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!cleaned) return 'Tool Result';
  const titleCased = cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
  return titleCased.length > 20 ? `${titleCased.slice(0, 17).trimEnd()}...` : titleCased;
}

export function GenericToolCard({ result, framed = true }: { result: ToolResult; framed?: boolean }) {
  const output = JSON.stringify(result.output ?? result.error ?? result.input, null, 2);
  const status = result.error ? 'failed' : 'success';
  const sourceLabel = humanizeToolName(result.tool_name);

  const body = <CollapsiblePre>{output}</CollapsiblePre>;

  if (!framed) {
    return body;
  }

  return (
    <ToolActivityCard
      sourceLabel={sourceLabel}
      sourceTitle={result.tool_name}
      status={status}
      durationMs={result.duration_ms}
    >
      {body}
    </ToolActivityCard>
  );
}
