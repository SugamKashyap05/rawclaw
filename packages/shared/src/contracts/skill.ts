export interface SkillDefinition {
  name: string;
  description: string;
  capabilityTags: string[];
  parameters: Record<string, unknown>;
  skillPath?: string;
}

export interface SkillRunRequest {
  params: Record<string, unknown>;
}

export interface SkillRunResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}
