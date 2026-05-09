import type { SettingsPayload } from './settings';

export interface BootstrapWorkspaceFileFlags {
  user: boolean;
  soul: boolean;
  memory: boolean;
  tools: boolean;
}

export interface BootstrapStatusResponse {
  initialized: boolean;
  needsSetup: boolean;
  workspaceFiles: BootstrapWorkspaceFileFlags;
  bootstrapMeta: {
    initializedAt?: string | null;
    resetAt?: string | null;
    mainAgentId?: string | null;
    mainAgentName?: string | null;
  };
}

export interface BootstrapPreflightResponse {
  ollama: {
    status: 'ready' | 'degraded' | 'down';
    baseUrl: string;
    error?: string | null;
    autofillModel: string;
    autofillModelReady: boolean;
    availableModelCount: number;
  };
}

export type BootstrapAgentMode = 'auto' | 'manual';

export interface BootstrapAgentDraftRequest {
  name: string;
  description?: string;
}

export interface BootstrapAgentDraftResponse {
  name: string;
  description?: string;
  systemPrompt: string;
  promptOverlay?: string;
  modelId: string;
  skills: string[];
  source: 'ai' | 'fallback';
  autofillModel: string;
}

export interface BootstrapMainAgentInput {
  name: string;
  description?: string;
  mode?: BootstrapAgentMode;
  systemPrompt?: string;
  promptOverlay?: string;
  modelId?: string;
  skills?: string[];
}

export interface BootstrapSetupRequest {
  user: string;
  soul?: string;
  memory?: string;
  tools?: string;
  mainAgent: BootstrapMainAgentInput;
}

export interface BootstrapSetupResponse {
  access_token: string;
  initialized: true;
  settings: SettingsPayload;
  bootstrap: BootstrapStatusResponse;
  createdAgents: {
    mainAgentId: string;
    backgroundAgentIds: string[];
  };
}

export interface BootstrapResetResponse {
  reset: true;
  needsSetup: true;
}
