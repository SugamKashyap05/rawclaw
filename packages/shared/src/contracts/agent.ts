export type AgentExecutionStatus = 'idle' | 'running' | 'paused' | 'error';

export interface AgentProfile {
  id: string;
  name: string;
  description?: string | null;
  systemPrompt: string;
  status: AgentExecutionStatus;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  systemPrompt: string;
  isDefault?: boolean;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
  status?: AgentExecutionStatus;
  isDefault?: boolean;
}
