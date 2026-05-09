import {
  AgentProfile,
  MemoryEvent,
  RESERVED_AGENT_DISPLAY_NAMES,
  humanizeAgentId,
  modelShortName,
  resolveAgentDisplayLabelFromProfiles,
} from '@rawclaw/shared';

export const RESERVED_AGENT_LABELS = RESERVED_AGENT_DISPLAY_NAMES;
export { humanizeAgentId, modelShortName };

export function resolveAgentLabel(agentId: string | undefined, agents: AgentProfile[]): string | null {
  return resolveAgentDisplayLabelFromProfiles(agentId, agents, {
    fallback: agentId ? 'Assistant' : 'RawClaw',
  });
}

function summarizeMemoryLabel(summary: string): string {
  const normalized = summary.replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  if (normalized.length <= 36) return normalized;
  return `${normalized.slice(0, 33).trimEnd()}...`;
}

export function summarizeMemoryEvents(events?: MemoryEvent[] | null): string | null {
  if (!events?.length) return null;
  const topSummaries = events
    .map((event) => summarizeMemoryLabel(event.summary))
    .filter(Boolean)
    .slice(0, 3);

  if (topSummaries.length === 0) return 'Used memory';
  const extraCount = Math.max(0, events.length - topSummaries.length);
  return `Used memory: ${topSummaries.join(', ')}${extraCount > 0 ? ` +${extraCount} more` : ''}`;
}
