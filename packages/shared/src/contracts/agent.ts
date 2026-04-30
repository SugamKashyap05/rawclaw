export type AgentExecutionStatus = 'idle' | 'running' | 'paused' | 'error';

export interface AgentProfile {
  id: string;
  name: string;
  description?: string | null;
  systemPrompt: string;
  promptPackId?: string | null;
  promptOverlay?: string | null;
  effectiveSystemPrompt?: string | null;
  status: AgentExecutionStatus;
  isDefault: boolean;
  modelId?: string | null;
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  systemPrompt: string;
  promptPackId?: string;
  promptOverlay?: string;
  modelId?: string;
  skills?: string[];
  isDefault?: boolean;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
  promptPackId?: string | null;
  promptOverlay?: string | null;
  status?: AgentExecutionStatus;
  modelId?: string;
  skills?: string[];
  isDefault?: boolean;
}
