import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  BootstrapAgentDraftRequest,
  BootstrapAgentDraftResponse,
  BootstrapPreflightResponse,
  BootstrapResetResponse,
  BootstrapSetupRequest,
  BootstrapStatusResponse,
  SettingsPayload,
} from '@rawclaw/shared';
import { PrismaService } from './prisma.service';
import { SettingsService, DEFAULT_WORKSPACE_FILES } from './settings.service';
import { ModelsService } from './models.service';

const BOOTSTRAP_META_KEY = 'rawclaw.bootstrap.state';
const AUTOFILL_MODEL_ID = 'ollama/qwen3-vl:8b';
const AUTOFILL_MODEL_NAME = 'qwen3-vl:8b';

type BootstrapMeta = {
  initialized: boolean;
  initializedAt?: string | null;
  resetAt?: string | null;
  mainAgentId?: string | null;
  mainAgentName?: string | null;
};

type AgentSeed = {
  name: string;
  description: string;
  promptOverlay: string;
};

@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly modelsService: ModelsService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getStatus(): Promise<BootstrapStatusResponse> {
    const workspaceFiles = this.settingsService.readWorkspaceFiles();
    const fileFlags = {
      user: this.isMeaningfulWorkspaceValue(workspaceFiles.user, DEFAULT_WORKSPACE_FILES.user),
      soul: this.isMeaningfulWorkspaceValue(workspaceFiles.soul, DEFAULT_WORKSPACE_FILES.soul),
      memory: this.isMeaningfulWorkspaceValue(workspaceFiles.memory, DEFAULT_WORKSPACE_FILES.memory),
      tools: this.isMeaningfulWorkspaceValue(workspaceFiles.tools, DEFAULT_WORKSPACE_FILES.tools),
    };
    const meta = await this.readBootstrapMeta();
    const initialized = meta?.initialized ?? fileFlags.user;

    return {
      initialized,
      needsSetup: !initialized,
      workspaceFiles: fileFlags,
      bootstrapMeta: {
        initializedAt: meta?.initializedAt ?? null,
        resetAt: meta?.resetAt ?? null,
        mainAgentId: meta?.mainAgentId ?? null,
        mainAgentName: meta?.mainAgentName ?? null,
      },
    };
  }

  async getPreflight(): Promise<BootstrapPreflightResponse> {
    const [health, models] = await Promise.all([
      this.modelsService.getHealth().catch(() => null),
      this.modelsService.getModels().catch(() => []),
    ]);
    const ollamaHealth = health?.providers?.ollama;
    const ollamaModels = models.filter((model) => String(model.provider || '').toLowerCase() === 'ollama');
    const autofillModelReady = ollamaModels.some((model) => model.id === AUTOFILL_MODEL_ID);

    return {
      ollama: {
        status: ollamaHealth?.status === 'ok' ? 'ready' : ollamaHealth?.status === 'degraded' ? 'degraded' : 'down',
        baseUrl:
          health?.providerConfig?.ollama?.baseUrl
          || this.configService.get<string>('OLLAMA_BASE_URL')
          || 'http://localhost:11434',
        error: ollamaHealth?.error || null,
        autofillModel: AUTOFILL_MODEL_ID,
        autofillModelReady,
        availableModelCount: ollamaModels.length,
      },
    };
  }

  async suggestMainAgentDraft(payload: BootstrapAgentDraftRequest): Promise<BootstrapAgentDraftResponse> {
    const name = payload.name?.trim();
    if (!name) {
      throw new BadRequestException('Main agent name is required.');
    }
    const description = payload.description?.trim() || '';
    const fallback = await this.buildFallbackDraft(name, description);
    const baseUrl = await this.resolveOllamaBaseUrl();

    try {
      const prompt = [
        'You are helping bootstrap a local AI workspace.',
        'Return ONLY valid JSON with keys: systemPrompt, promptOverlay, skills.',
        'systemPrompt must be 1-2 short paragraphs in second person, ready to use as an agent system prompt.',
        'promptOverlay must be a short execution style note.',
        'skills must be a JSON array of up to 4 lowercase strings.',
        `Agent name: ${name}`,
        `Agent description: ${description || 'General-purpose main agent for the user.'}`,
        'Do not include markdown fences.',
      ].join('\n');

      const response = await firstValueFrom(
        this.httpService.post<{ response?: string }>(
          `${baseUrl.replace(/\/+$/, '')}/api/generate`,
          {
            model: AUTOFILL_MODEL_NAME,
            prompt,
            stream: false,
            format: 'json',
          },
          { timeout: 30_000 },
        ),
      );

      const parsed = this.parseDraftResponse(response.data?.response || '');
      if (!parsed?.systemPrompt?.trim()) {
        return fallback;
      }

      return {
        name,
        description: description || undefined,
        systemPrompt: this.stripHtml(parsed.systemPrompt),
        promptOverlay: this.stripHtml(parsed.promptOverlay || fallback.promptOverlay || ''),
        skills: this.normalizeSkills(parsed.skills, fallback.skills),
        modelId: fallback.modelId,
        source: 'ai',
        autofillModel: AUTOFILL_MODEL_ID,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Bootstrap autofill fell back to local template: ${message}`);
      return fallback;
    }
  }

  async bootstrapSetup(payload: BootstrapSetupRequest): Promise<{
    settings: SettingsPayload;
    bootstrap: BootstrapStatusResponse;
    createdAgents: { mainAgentId: string; backgroundAgentIds: string[] };
  }> {
    const user = payload.user?.trim();
    const mainName = payload.mainAgent?.name?.trim();
    if (!user) {
      throw new BadRequestException('User context is required.');
    }
    if (!mainName) {
      throw new BadRequestException('Main agent name is required.');
    }
    if (this.getBackgroundAgentSeeds().some((seed) => seed.name.toLowerCase() === mainName.toLowerCase())) {
      throw new BadRequestException('Choose a different main agent name. That one is reserved for a background agent.');
    }

    const mainDescription = payload.mainAgent.description?.trim() || '';
    const mode = payload.mainAgent.mode || 'auto';
    const draft =
      mode === 'manual' && payload.mainAgent.systemPrompt?.trim()
        ? await this.buildFallbackDraft(mainName, mainDescription)
        : await this.suggestMainAgentDraft({ name: mainName, description: mainDescription });
    const config = await this.modelsService.getConfig();
    const defaultModelId = config.routing.medium || AUTOFILL_MODEL_ID;

    const settings = await this.settingsService.bootstrapWorkspace({
      user,
      soul: payload.soul?.trim() || DEFAULT_WORKSPACE_FILES.soul,
      memory: payload.memory?.trim() || DEFAULT_WORKSPACE_FILES.memory,
      tools: payload.tools?.trim() || DEFAULT_WORKSPACE_FILES.tools,
    });

    await this.prisma.agentProfile.updateMany({ data: { isDefault: false } });

    const backgroundAgentIds: string[] = [];
    for (const seed of this.getBackgroundAgentSeeds()) {
      const record = await this.prisma.agentProfile.upsert({
        where: { name: seed.name },
        update: {
          description: seed.description,
          systemPrompt: this.buildBackgroundPrompt(seed),
          promptPackId: 'rawclaw-default',
          promptOverlay: seed.promptOverlay,
          modelId: config.routing.low || defaultModelId,
          isDefault: false,
          status: 'idle',
          skills: JSON.stringify([]),
        },
        create: {
          name: seed.name,
          description: seed.description,
          systemPrompt: this.buildBackgroundPrompt(seed),
          promptPackId: 'rawclaw-default',
          promptOverlay: seed.promptOverlay,
          modelId: config.routing.low || defaultModelId,
          isDefault: false,
          status: 'idle',
          skills: JSON.stringify([]),
        },
      });
      backgroundAgentIds.push(record.id);
    }

    const mainAgent = await this.prisma.agentProfile.upsert({
      where: { name: mainName },
      update: {
        description: mainDescription || null,
        systemPrompt: this.stripHtml(payload.mainAgent.systemPrompt?.trim() || draft.systemPrompt),
        promptPackId: 'rawclaw-default',
        promptOverlay: this.stripHtml(payload.mainAgent.promptOverlay?.trim() || draft.promptOverlay || ''),
        modelId: payload.mainAgent.modelId?.trim() || draft.modelId || defaultModelId,
        isDefault: true,
        status: 'idle',
        skills: JSON.stringify(
          this.normalizeSkills(payload.mainAgent.skills, draft.skills),
        ),
      },
      create: {
        name: mainName,
        description: mainDescription || null,
        systemPrompt: this.stripHtml(payload.mainAgent.systemPrompt?.trim() || draft.systemPrompt),
        promptPackId: 'rawclaw-default',
        promptOverlay: this.stripHtml(payload.mainAgent.promptOverlay?.trim() || draft.promptOverlay || ''),
        modelId: payload.mainAgent.modelId?.trim() || draft.modelId || defaultModelId,
        isDefault: true,
        status: 'idle',
        skills: JSON.stringify(
          this.normalizeSkills(payload.mainAgent.skills, draft.skills),
        ),
      },
    });

    const initializedAt = new Date().toISOString();
    await this.writeBootstrapMeta({
      initialized: true,
      initializedAt,
      resetAt: null,
      mainAgentId: mainAgent.id,
      mainAgentName: mainAgent.name,
    });

    return {
      settings,
      bootstrap: await this.getStatus(),
      createdAgents: {
        mainAgentId: mainAgent.id,
        backgroundAgentIds,
      },
    };
  }

  async factoryReset(): Promise<BootstrapResetResponse> {
    await this.prisma.$transaction([
      this.prisma.childRun.deleteMany(),
      this.prisma.gatewayAutomationRun.deleteMany(),
      this.prisma.gatewayAutomationJob.deleteMany(),
      this.prisma.runStep.deleteMany(),
      this.prisma.taskRun.deleteMany(),
      this.prisma.taskDefinition.deleteMany(),
      this.prisma.toolConfirmation.deleteMany(),
      this.prisma.message.deleteMany(),
      this.prisma.sessionBinding.deleteMany(),
      this.prisma.session.deleteMany(),
      this.prisma.modelPreference.deleteMany(),
      this.prisma.agentProfile.deleteMany(),
      this.prisma.promptImprovementProposal.deleteMany(),
      this.prisma.memoryEntry.deleteMany(),
      this.prisma.harnessProcess.deleteMany(),
      this.prisma.harnessRun.deleteMany(),
      this.prisma.document.deleteMany(),
      this.prisma.importedProjectAdapter.deleteMany(),
      this.prisma.appRegistryRecord.deleteMany(),
      this.prisma.appBuilderRun.deleteMany(),
      this.prisma.appBuilderManifest.deleteMany(),
      this.prisma.appBuilderProject.deleteMany(),
      this.prisma.appBuilderBlobRef.deleteMany(),
      this.prisma.bindingRule.deleteMany(),
      this.prisma.mcpServerConfig.deleteMany(),
      this.prisma.appSetting.deleteMany(),
    ]);

    this.settingsService.resetWorkspaceFiles();
    await this.writeBootstrapMeta({
      initialized: false,
      initializedAt: null,
      resetAt: new Date().toISOString(),
      mainAgentId: null,
      mainAgentName: null,
    });

    return { reset: true, needsSetup: true };
  }

  private async readBootstrapMeta(): Promise<BootstrapMeta | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: BOOTSTRAP_META_KEY } });
    if (!row) return null;
    try {
      return JSON.parse(row.value) as BootstrapMeta;
    } catch {
      return null;
    }
  }

  private async writeBootstrapMeta(meta: BootstrapMeta): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key: BOOTSTRAP_META_KEY },
      update: { value: JSON.stringify(meta) },
      create: { key: BOOTSTRAP_META_KEY, value: JSON.stringify(meta) },
    });
  }

  private async buildFallbackDraft(name: string, description: string): Promise<BootstrapAgentDraftResponse> {
    const config = await this.modelsService.getConfig();
    const modelId = config.routing.medium || AUTOFILL_MODEL_ID;
    const contextLine = description
      ? `Primary responsibility: ${description}.`
      : 'Primary responsibility: be the user’s main general-purpose RawClaw agent.';

    return {
      name,
      description: description || undefined,
      systemPrompt: [
        `You are ${name}, the user’s main RawClaw agent.`,
        contextLine,
        'Work like a reliable senior teammate: stay warm, practical, and honest. Keep momentum, explain important choices briefly, use tools carefully, and adapt your depth to the user’s needs.',
        'When information is missing, ask only the smallest useful question. When the path is clear, act decisively and help the user feel oriented.',
      ].join(' '),
      promptOverlay: 'Prefer conservative defaults, keep the user looped in, and leave the workspace tidier than you found it.',
      modelId,
      skills: ['research', 'planning', 'memory'],
      source: 'fallback',
      autofillModel: AUTOFILL_MODEL_ID,
    };
  }

  private buildBackgroundPrompt(seed: AgentSeed): string {
    return [
      `You are ${seed.name}, a background support agent inside RawClaw.`,
      seed.description,
      'Work quietly, produce concise handoffs, and avoid pretending to be the main voice unless explicitly asked.',
    ].join(' ');
  }

  private getBackgroundAgentSeeds(): AgentSeed[] {
    return [
      {
        name: 'Research Scout',
        description: 'Finds sources, checks claims, and prepares concise evidence handoffs for the main agent.',
        promptOverlay: 'Prioritize source quality, date awareness, and clean evidence summaries.',
      },
      {
        name: 'Memory Keeper',
        description: 'Maintains stable facts about the user, projects, and long-lived constraints.',
        promptOverlay: 'Store only durable, useful memory and keep it tidy.',
      },
      {
        name: 'Task Pilot',
        description: 'Keeps follow-ups, recurring jobs, and operational checklists organized in the background.',
        promptOverlay: 'Think in clear next steps, deadlines, and reliable execution loops.',
      },
    ];
  }

  private normalizeSkills(input: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(input)) return fallback;
    return Array.from(
      new Set(
        input
          .map((value) => String(value || '').trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 6),
      ),
    );
  }

  private parseDraftResponse(raw: string): { systemPrompt?: string; promptOverlay?: string; skills?: string[] } | null {
    const cleaned = String(raw || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    if (!cleaned) return null;
    try {
      return JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  private async resolveOllamaBaseUrl(): Promise<string> {
    const health = await this.modelsService.getHealth().catch(() => null);
    return health?.providerConfig?.ollama?.baseUrl
      || this.configService.get<string>('OLLAMA_BASE_URL')
      || 'http://localhost:11434';
  }

  private isMeaningfulWorkspaceValue(value: string, placeholder: string): boolean {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return normalized !== String(placeholder || '').trim();
  }

  private stripHtml(value: string): string {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
