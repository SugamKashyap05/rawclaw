export interface WorkspaceFilesState {
  soul: string;
  user: string;
  memory: string;
  tools: string;
}

export interface AppSettingsState {
  theme: 'dark' | 'light';
  language: string;
  autoStart: boolean;
  aiProviders: {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
    ollamaUrl?: string;
  };
  bots: {
    telegramToken?: string;
    discordToken?: string;
    telegramEnabled: boolean;
    discordEnabled: boolean;
  };
  security: {
    verifySignatures: boolean;
    publicKey: string;
  };
  integrations: {
    githubConnected: boolean;
    slackConnected: boolean;
  };
}

export interface SettingsPayload {
  settings: AppSettingsState;
  workspaceFiles: WorkspaceFilesState;
}

export interface UpdateSettingsRequest {
  settings?: Partial<AppSettingsState>;
  workspaceFiles?: Partial<WorkspaceFilesState>;
}
