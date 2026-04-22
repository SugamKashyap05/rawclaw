import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ModelInfo, ModelRoutingConfig, ModelsHealthResponse, ProviderConfigState, ProviderHealthInfo, UpdateModelsConfigRequest } from '@rawclaw/shared';

export interface ModelWithPreference extends ModelInfo {
  customName?: string;
  isFavorite: boolean;
  preferenceId?: string;
}

@Injectable()
export class ModelsService {
  private readonly settingsKey = 'rawclaw.models.config';

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getModels(): Promise<ModelWithPreference[]> {
    const agentUrl = this.configService.getOrThrow<string>('AGENT_URL');
    
    // 1. Get models from agent
    let agentModels: ModelInfo[] = [];
    try {
      const res = await firstValueFrom(
        this.httpService.get<{ models: ModelInfo[] }>(`${agentUrl}/api/models`, {
          timeout: 10000 // Increased timeout for Ollama responsiveness
        })
      );
      agentModels = res.data.models;
    } catch (e: any) {
      const message = e.response?.data?.message || e.message;
      console.error(`Failed to fetch models from agent at ${agentUrl}:`, message);
      // No fallback - we want to show real system state
      agentModels = [];
    }

    // 2. Get preferences from DB
    const preferences = await this.prisma.modelPreference.findMany();
    const prefsMap = new Map<string, any>(preferences.map((p: any) => [p.modelId, p]));

    // 3. Merge
    return agentModels.map(model => {
      const pref = prefsMap.get(model.id);
      return {
        ...model,
        customName: pref?.customName || undefined,
        isFavorite: pref?.isFavorite || false,
        preferenceId: pref?.id
      };
    });
  }

  async updatePreference(modelId: string, data: { customName?: string, isFavorite?: boolean, provider?: string }) {
    return this.prisma.modelPreference.upsert({
      where: { modelId },
      update: {
        customName: data.customName,
        isFavorite: data.isFavorite,
      },
      create: {
        modelId,
        customName: data.customName,
        isFavorite: data.isFavorite || false,
        provider: data.provider || 'unknown'
      }
    });
  }

  async deletePreference(id: string) {
    return this.prisma.modelPreference.delete({
      where: { id }
    });
  }

  async getHealth(): Promise<ModelsHealthResponse> {
    const [health, config] = await Promise.all([
      this.fetchProviderHealth(),
      this.getConfig(),
    ]);

    return {
      providers: health,
      routing: config.routing,
      providerConfig: config.providerConfig,
    };
  }

  async updateConfig(payload: UpdateModelsConfigRequest): Promise<ModelsHealthResponse> {
    const current = await this.getConfig();
    const next = {
      routing: {
        ...current.routing,
        ...(payload.routing ?? {}),
      },
      providerConfig: {
        ...current.providerConfig,
      },
    };

    if (payload.providerConfig) {
      for (const [provider, config] of Object.entries(payload.providerConfig)) {
        next.providerConfig[provider] = {
          ...next.providerConfig[provider],
          ...config,
        };
      }
    }

    await this.prisma.appSetting.upsert({
      where: { key: this.settingsKey },
      update: { value: JSON.stringify(next) },
      create: { key: this.settingsKey, value: JSON.stringify(next) },
    });

    return this.getHealth();
  }

  private async fetchProviderHealth(): Promise<Record<string, ProviderHealthInfo>> {
    const agentUrl = this.configService.getOrThrow<string>('AGENT_URL');
    const defaultProviders = {
      ollama: { status: 'down', error: 'Agent unavailable' },
      openai: { status: 'down' },
      anthropic: { status: 'down' },
      google: { status: 'down' },
    };

    try {
      const res = await firstValueFrom(
        this.httpService.get<{ 
          status: string;
          providers?: Record<string, { status: string; error?: string | null }> 
        }>(`${agentUrl}/health`, { timeout: 5000 }),
      );
      
      const health: Record<string, any> = {};
      const agentProviders = res.data.providers || {};
      
      // Map all providers from agent
      for (const [key, info] of Object.entries(agentProviders)) {
        health[key] = {
          status: info.status || 'down',
          error: info.error || null,
        };
      }

      // Ensure standard keys exist
      return {
        ...defaultProviders,
        ...health,
      } as any;
    } catch {
      return defaultProviders as any;
    }
  }

  private isAnthropicUsable(): boolean {
    const key = this.configService.get<string>('ANTHROPIC_API_KEY');
    return !!key && key !== 'your_anthropic_api_key_here';
  }

  private isOpenAIUsable(): boolean {
    const key = this.configService.get<string>('OPENAI_API_KEY');
    return !!key && key !== 'your_openai_api_key_here';
  }

  private isGoogleUsable(): boolean {
    const key = this.configService.get<string>('GOOGLE_API_KEY');
    return !!key && key !== 'your_google_api_key_here';
  }

  public async getConfig(): Promise<{
    routing: ModelRoutingConfig;
    providerConfig: Record<string, ProviderConfigState>;
  }> {
    const saved = await this.prisma.appSetting.findUnique({ where: { key: this.settingsKey } });
    
    const isAnthropic = this.isAnthropicUsable();
    const isOpenAI = this.isOpenAIUsable();
    const isGoogle = this.isGoogleUsable();
    
    // Default model defaults synced with agent's settings.py
    const fallback = {
      routing: {
        low: this.configService.get<string>('DEFAULT_LOW_MODEL') || 'ollama/qwen2.5:1.5b',
        medium: this.configService.get<string>('DEFAULT_MEDIUM_MODEL') || (isAnthropic ? 'anthropic/claude-3-haiku' : 'ollama/llama3.2:3b'),
        high: this.configService.get<string>('DEFAULT_HIGH_MODEL') || (isAnthropic ? 'anthropic/claude-3-5-sonnet' : 'ollama/llama3:8b'),
        outputReviewer: this.configService.get<string>('DEFAULT_REVIEWER_MODEL') || 'ollama/llama3.2:3b',
      },
      providerConfig: {
        openai: { enabled: isOpenAI },
        anthropic: { enabled: isAnthropic },
        google: { enabled: isGoogle },
        ollama: {
          enabled: true,
          baseUrl: this.configService.get<string>('OLLAMA_BASE_URL') || 'http://localhost:11434',
        },
      } as Record<string, ProviderConfigState>,
    };

    if (!saved) return fallback;

    try {
      const parsed = JSON.parse(saved.value) as {
        routing?: Partial<ModelRoutingConfig>;
        providerConfig?: Record<string, ProviderConfigState>;
      };

      const finalRouting: ModelRoutingConfig = {
        low: parsed.routing?.low || fallback.routing.low,
        medium: parsed.routing?.medium || fallback.routing.medium,
        high: parsed.routing?.high || fallback.routing.high,
        outputReviewer: parsed.routing?.outputReviewer || fallback.routing.outputReviewer,
      };

      return {
        routing: finalRouting,
        providerConfig: {
          ...fallback.providerConfig,
          ...(parsed.providerConfig ?? {}),
          ollama: { 
            ...fallback.providerConfig.ollama, 
            ...(parsed.providerConfig?.ollama ?? {}) 
          }
        },
      };
    } catch {
      return fallback;
    }
  }
}
