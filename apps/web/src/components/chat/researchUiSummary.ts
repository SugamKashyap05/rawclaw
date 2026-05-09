import type { ProvenanceTrace as IProvenanceTrace, ToolResult } from '@rawclaw/shared';

type TraceLike = Partial<IProvenanceTrace> | null | undefined;

function cleanSummary(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (text === 'Determining Action Level...') return '';
  if (text.startsWith('Internal research stages selected these decisions:')) return '';
  if (text.startsWith('{') || text.startsWith('[')) return '';
  return text;
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizeToolContextLabel(toolName: string): string {
  const lower = String(toolName || '').toLowerCase();
  if (!lower) return 'Context tool';
  if (lower === 'skill_grounded-web-summary') return 'Grounded web summary';
  if (lower.includes('search')) return 'Web search';
  if (lower.includes('extract') || lower.includes('fetch') || lower.includes('browser') || lower.includes('navigate')) {
    return 'Page extract';
  }
  return titleCaseWords(lower.replace(/[_-]+/g, ' '));
}

export function buildInitialAnalysisSummary(trace: TraceLike): {
  decisionLevel: string;
  contexts: string[];
  isComplete: boolean;
} {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const summaryCandidate = [...steps]
    .reverse()
    .find((step) => ['analyst', 'scout', 'plan', 'review'].includes(String(step.stepType || '')) && cleanSummary(step.outputSummary));

  const groupedContexts = new Map<string, number>();
  for (const step of steps) {
    if (step.stepType !== 'tool_result' || !step.toolName) continue;
    const label = normalizeToolContextLabel(step.toolName);
    groupedContexts.set(label, (groupedContexts.get(label) || 0) + 1);
  }

  return {
    decisionLevel: cleanSummary(summaryCandidate?.outputSummary) || 'Analyzing the request and deciding the right research path.',
    contexts: [...groupedContexts.entries()].map(([label, count]) => (count > 1 ? `${label} x${count}` : label)),
    isComplete: steps.some((step) => step.stepType === 'synthesis'),
  };
}

export function buildSearchAttemptMeta(results: ToolResult[]): Array<{ attempt: number; total: number } | null> {
  const total = results.filter((result) => String(result.tool_name || '').toLowerCase().includes('search')).length;
  let seen = 0;
  return results.map((result) => {
    if (!String(result.tool_name || '').toLowerCase().includes('search') || total <= 1) {
      return null;
    }
    seen += 1;
    return { attempt: seen, total };
  });
}
