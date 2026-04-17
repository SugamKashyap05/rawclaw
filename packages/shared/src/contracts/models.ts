export interface ProviderHealthInfo {
  status: 'ok' | 'degraded' | 'error' | 'unconfigured' | 'down';
  error?: string | null;
}

export interface ModelRoutingConfig {
  low: string;
  medium: string;
  high: string;
}

export interface ProviderConfigState {
  enabled: boolean;
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
