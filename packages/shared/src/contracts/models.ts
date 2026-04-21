export interface ProviderHealthInfo {
  status: 'ok' | 'degraded' | 'error' | 'unconfigured' | 'down';
  error?: string | null;
}

export interface ModelRoutingConfig {
  low: string;
  medium: string;
  high: string;
  outputReviewer: string;
}

export interface ProviderConfigState {
  enabled: boolean;
  agent_id?: string;
  /** Optional secondary agent to review output before finalizing */
  output_reviewer_id?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface ModelsHealthResponse {
  providers: Record<string, ProviderHealthInfo>;
  routing: ModelRoutingConfig;
  providerConfig: Record<string, ProviderConfigState>;
}

export interface UpdateModelsConfigRequest {
  routing?: Partial<ModelRoutingConfig>;
  providerConfig?: Record<string, Partial<ProviderConfigState>>;
}
