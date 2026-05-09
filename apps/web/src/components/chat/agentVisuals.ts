const RESERVED_AGENT_ACCENTS: Record<string, string> = {
  main: '#60A5FA',
  app_builder: '#F59E0B',
  'app-builder': '#F59E0B',
  research_agent: '#14B8A6',
  'research-agent': '#14B8A6',
  automation_worker: '#FB7185',
  'automation-worker': '#FB7185',
};

const FALLBACK_AGENT_ACCENTS = ['#818CF8', '#34D399', '#22D3EE', '#A78BFA', '#FB923C', '#F472B6'];

function hashAgentId(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (31 * hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function resolveAgentAccent(agentId?: string | null): string {
  if (!agentId) return RESERVED_AGENT_ACCENTS.main;
  const reserved = RESERVED_AGENT_ACCENTS[agentId];
  if (reserved) return reserved;
  return FALLBACK_AGENT_ACCENTS[hashAgentId(agentId) % FALLBACK_AGENT_ACCENTS.length];
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`;
  const int = Number.parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
