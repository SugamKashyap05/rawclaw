import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ModelInfo, ModelsHealthResponse, ProviderConfigState, ProviderHealthInfo, UpdateModelsConfigRequest } from '@rawclaw/shared';

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
    try {
      const res = await firstValueFrom(
        this.httpService.get<{ providers?: Record<string, { status: string; error?: string | null }> }>(
          `${agentUrl}/health`,
          { timeout: 5000 },
        ),
      );
      return Object.fromEntries(
        Object.entries(res.data.providers ?? {}).map(([name, info]) => [
          name,
          {
            status: (info.status || 'down') as ModelsHealthResponse['providers'][string]['status'],
            error: info.error ?? null,
          },
        ]),
      );
    } catch {
      return {
        ollama: { status: 'down', error: 'Agent unavailable' },
        anthropic: { status: 'down', error: 'Agent unavailable' },
      };
    }
  }

  private async getConfig(): Promise<{
    routing: { low: string; medium: string; high: string };
    providerConfig: Record<string, ProviderConfigState>;
  }> {
    const saved = await this.prisma.appSetting.findUnique({ where: { key: this.settingsKey } });
    const fallback = {
      routing: {
        low: this.configService.get<string>('DEFAULT_LOW_MODEL') || 'ollama/llama3',
        medium: this.configService.get<string>('DEFAULT_MEDIUM_MODEL') || 'anthropic/claude-3-haiku',
        high: this.configService.get<string>('DEFAULT_HIGH_MODEL') || 'anthropic/claude-3-5-sonnet',
      },
      providerConfig: {
        openai: { enabled: false },
        anthropic: { enabled: true },
        google: { enabled: false },
        ollama: {
          enabled: true,
          baseUrl: 'http://localhost:11434',
        },
      } as Record<string, ProviderConfigState>,
    };

    if (!saved) return fallback;

    try {
      const parsed = JSON.parse(saved.value) as {
        routing?: { low?: string; medium?: string; high?: string };
        providerConfig?: Record<string, ProviderConfigState>;
      };
      return {
        routing: {
          ...fallback.routing,
          ...(parsed.routing ?? {}),
        },
        providerConfig: {
          ...fallback.providerConfig,
          ...(parsed.providerConfig ?? {}),
        },
      };
    } catch {
      return fallback;
    }
  }
}
