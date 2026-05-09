import type { AgentProfile } from '../contracts/agent';

export const RESERVED_AGENT_DISPLAY_NAMES: Record<string, string> = {
  'default-assistant': 'RawClaw',
  main: 'RawClaw',
  app_builder: 'App Builder',
  'app-builder': 'App Builder',
  research_agent: 'Research Agent',
  'research-agent': 'Research Agent',
  automation_worker: 'Automation',
  'automation-worker': 'Automation',
};

export function humanizeAgentId(value?: string | null): string | null {
  if (!value) return null;
  const reserved = RESERVED_AGENT_DISPLAY_NAMES[value];
  if (reserved) return reserved;
  const cleaned = value.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return null;
  const titleCased = cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
  return titleCased.length > 20 ? `${titleCased.slice(0, 17)}...` : titleCased;
}

export function resolveAgentDisplayLabel(
  agentId?: string | null,
  options: {
    profileName?: string | null;
    fallback?: string | null;
  } = {},
): string | null {
  const profileName = options.profileName?.trim();
  if (profileName) return profileName;
  if (!agentId) return options.fallback ?? 'RawClaw';
  return humanizeAgentId(agentId) || options.fallback || 'Assistant';
}

export function resolveAgentDisplayLabelFromProfiles(
  agentId: string | undefined,
  agents: AgentProfile[],
  options: { fallback?: string | null } = {},
): string | null {
  if (!agentId) return options.fallback ?? 'RawClaw';
  const profileMatch = agents.find((agent) => agent.id === agentId);
  return resolveAgentDisplayLabel(agentId, {
    profileName: profileMatch?.name,
    fallback: options.fallback,
  });
}

export function modelShortName(modelId?: string | null): string | null {
  if (!modelId) return null;
  const parts = modelId.split('/');
  return parts[parts.length - 1] || modelId;
}

export const COWORKER_WORK_STORY_TEMPLATES = {
  direct: 'Answered directly from our conversation.',
  grounded: (sourceCount: number, strongestSource: string) =>
    `Checked ${sourceCount} source${sourceCount === 1 ? '' : 's'} and anchored the answer in ${strongestSource}.`,
  partial: (strongestSource: string) =>
    `I found a promising lead in ${strongestSource}, but I could not fully verify it yet.`,
  degraded: (toolLabel: string, degradationReasonLabel: string) =>
    `I tried ${toolLabel}, but I hit a limit because ${degradationReasonLabel}.`,
} as const;
