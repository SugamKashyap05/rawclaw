import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AppSettingsState, SettingsPayload, UpdateSettingsRequest, WorkspaceFilesState } from '@rawclaw/shared';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { generateKeyPairSync } from 'crypto';

const SETTINGS_KEY = 'rawclaw.settings';
const DEFAULT_SETTINGS: AppSettingsState = {
  theme: 'dark',
  language: 'en',
  autoStart: false,
  aiProviders: {
    ollamaUrl: 'http://localhost:11434',
  },
  bots: {
    telegramEnabled: false,
    discordEnabled: false,
  },
  security: {
    verifySignatures: true,
    publicKey: '',
  },
  integrations: {
    githubConnected: false,
    slackConnected: false,
  },
};

@Injectable()
export class SettingsService {
  private readonly rawclawDir = join(homedir(), '.rawclaw');

  constructor(private readonly prisma: PrismaService) {
    this.ensureWorkspace();
  }

  async getPayload(): Promise<SettingsPayload> {
    const settings = await this.getSettings();
    const workspaceFiles = this.getWorkspaceFiles();
    return { settings, workspaceFiles };
  }

  getBootstrapStatus(): {
    initialized: boolean;
    needsSetup: boolean;
    workspaceFiles: { user: boolean; soul: boolean; memory: boolean; tools: boolean };
  } {
    const workspaceFiles = this.getWorkspaceFiles();
    const fileStatus = {
      user: workspaceFiles.user.trim().length > 0,
      soul: workspaceFiles.soul.trim().length > 0,
      memory: workspaceFiles.memory.trim().length > 0,
      tools: workspaceFiles.tools.trim().length > 0,
    };

    const initialized = fileStatus.user;

    return {
      initialized,
      needsSetup: !initialized,
      workspaceFiles: fileStatus,
    };
  }

  async bootstrapWorkspace(payload: {
    user: string;
    soul?: string;
    memory?: string;
    tools?: string;
  }): Promise<SettingsPayload> {
    const current = this.getWorkspaceFiles();
    const next: WorkspaceFilesState = {
      soul: payload.soul ?? current.soul,
      user: payload.user.trim(),
      memory: payload.memory ?? current.memory,
      tools: payload.tools ?? current.tools,
    };

    this.writeWorkspaceFiles(next);
    return this.getPayload();
  }

  async update(payload: UpdateSettingsRequest): Promise<SettingsPayload> {
    const currentSettings = await this.getSettings();
    const mergedSettings = payload.settings
      ? {
          ...currentSettings,
          ...payload.settings,
          aiProviders: {
            ...currentSettings.aiProviders,
            ...(payload.settings.aiProviders ?? {}),
          },
          bots: {
            ...currentSettings.bots,
            ...(payload.settings.bots ?? {}),
          },
          security: {
            ...currentSettings.security,
            ...(payload.settings.security ?? {}),
          },
          integrations: {
            ...currentSettings.integrations,
            ...(payload.settings.integrations ?? {}),
          },
        }
      : currentSettings;

    if (!mergedSettings.security.publicKey) {
      mergedSettings.security.publicKey = this.generatePublicKey();
    }

    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: JSON.stringify(mergedSettings) },
      create: { key: SETTINGS_KEY, value: JSON.stringify(mergedSettings) },
    });

    if (payload.workspaceFiles) {
      const currentFiles = this.getWorkspaceFiles();
      const nextFiles = { ...currentFiles, ...payload.workspaceFiles };
      this.writeWorkspaceFiles(nextFiles);
    }

    return this.getPayload();
  }

  async setBotEnabled(bot: 'telegram' | 'discord', enabled: boolean) {
    const settings = await this.getSettings();
    settings.bots = {
      ...settings.bots,
      telegramEnabled: bot === 'telegram' ? enabled : settings.bots.telegramEnabled,
      discordEnabled: bot === 'discord' ? enabled : settings.bots.discordEnabled,
    };

    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: JSON.stringify(settings) },
      create: { key: SETTINGS_KEY, value: JSON.stringify(settings) },
    });

    return { success: true, bot, enabled };
  }

  async setIntegration(provider: 'github' | 'slack', connected: boolean) {
    const settings = await this.getSettings();
    settings.integrations = {
      ...settings.integrations,
      githubConnected: provider === 'github' ? connected : settings.integrations.githubConnected,
      slackConnected: provider === 'slack' ? connected : settings.integrations.slackConnected,
    };

    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: JSON.stringify(settings) },
      create: { key: SETTINGS_KEY, value: JSON.stringify(settings) },
    });

    return { success: true, provider, connected };
  }

  private async getSettings(): Promise<AppSettingsState> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: SETTINGS_KEY },
    });
    const parsed = setting ? (JSON.parse(setting.value) as AppSettingsState) : DEFAULT_SETTINGS;
    if (!parsed.security.publicKey) {
      parsed.security.publicKey = this.generatePublicKey();
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      aiProviders: { ...DEFAULT_SETTINGS.aiProviders, ...parsed.aiProviders },
      bots: { ...DEFAULT_SETTINGS.bots, ...parsed.bots },
      security: { ...DEFAULT_SETTINGS.security, ...parsed.security },
      integrations: { ...DEFAULT_SETTINGS.integrations, ...parsed.integrations },
    };
  }

  private getWorkspaceFiles(): WorkspaceFilesState {
    return {
      soul: this.readWorkspaceFile('SOUL.md'),
      user: this.readWorkspaceFile('USER.md'),
      memory: this.readWorkspaceFile('MEMORY.md'),
      tools: this.readWorkspaceFile('TOOLS.md'),
    };
  }

  private writeWorkspaceFiles(files: WorkspaceFilesState): void {
    this.ensureWorkspace();
    writeFileSync(join(this.rawclawDir, 'SOUL.md'), files.soul, 'utf8');
    writeFileSync(join(this.rawclawDir, 'USER.md'), files.user, 'utf8');
    writeFileSync(join(this.rawclawDir, 'MEMORY.md'), files.memory, 'utf8');
    writeFileSync(join(this.rawclawDir, 'TOOLS.md'), files.tools, 'utf8');
  }

  private ensureWorkspace(): void {
    if (!existsSync(this.rawclawDir)) {
      mkdirSync(this.rawclawDir, { recursive: true });
    }
  }

  private readWorkspaceFile(name: string): string {
    const filePath = join(this.rawclawDir, name);
    if (!existsSync(filePath)) return '';
    return readFileSync(filePath, 'utf8');
  }

  private generatePublicKey(): string {
    const { publicKey } = generateKeyPairSync('ed25519');
    return publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }
}
