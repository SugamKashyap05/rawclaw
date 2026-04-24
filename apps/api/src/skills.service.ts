import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SkillDefinition, SkillRunResponse } from '@rawclaw/shared';
import { AgentsService } from './agents.service';

type SkillStatusResponse = {
  status: string;
  activeSkillsDir: string;
  researchDir: string;
  activePluginsDir?: string;
  installedCount: number;
  installedSkillFiles: string[];
  researchedCount: number;
  installedPluginBundleCount?: number;
  installedPluginBundles?: string[];
};

@Injectable()
export class SkillsService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly agentsService: AgentsService,
  ) {}

  private get agentUrl(): string {
    return this.configService.getOrThrow<string>('AGENT_URL');
  }

  async list(): Promise<SkillDefinition[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ skills: SkillDefinition[] }>(`${this.agentUrl}/api/skills`),
      );
      return response.data.skills;
    } catch {
      return [];
    }
  }

  async run(name: string, params: Record<string, unknown>): Promise<SkillRunResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<SkillRunResponse>(`${this.agentUrl}/api/skills/${name}/run`, {
          params,
        }),
      );
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Skill execution failed';
      return {
        success: false,
        error: message,
      };
    }
  }

  async status(): Promise<SkillStatusResponse> {
    const response = await firstValueFrom(
      this.httpService.get<SkillStatusResponse>(`${this.agentUrl}/api/skills/status`),
    );
    return response.data;
  }

  async listResearched(): Promise<{ skills: any[] }> {
    const response = await firstValueFrom(
      this.httpService.get<{ skills: any[] }>(`${this.agentUrl}/api/skills/research`),
    );
    return response.data;
  }

  async clone(repoUrl: string): Promise<Record<string, unknown>> {
    const response = await firstValueFrom(
      this.httpService.post<Record<string, unknown>>(`${this.agentUrl}/api/skills/clone`, {
        repo_url: repoUrl,
      }),
    );
    return response.data;
  }

  async install(sourcePath: string): Promise<Record<string, unknown>> {
    const response = await firstValueFrom(
      this.httpService.post<Record<string, unknown>>(`${this.agentUrl}/api/skills/install`, {
        source_path: sourcePath,
      }),
    );
    const payload = response.data ?? {};
    const autoAssignment = await this.autoAssignInstalledSkills(payload);
    return autoAssignment ? { ...payload, autoAssignment } : payload;
  }

  async build(payload: { name: string; description: string; tags: string[]; instructions: string }): Promise<Record<string, unknown>> {
    const response = await firstValueFrom(
      this.httpService.post<Record<string, unknown>>(`${this.agentUrl}/api/skills/build`, payload),
    );
    return response.data;
  }

  private extractInstalledSkillNames(payload: Record<string, unknown>): string[] {
    const names = new Set<string>();
    const direct = payload.skill_name;
    if (typeof direct === 'string' && direct.trim()) {
      names.add(direct.trim());
    }

    const installed = Array.isArray(payload.installed) ? payload.installed : [];
    for (const entry of installed) {
      if (!entry || typeof entry !== 'object') continue;
      const skillName = (entry as Record<string, unknown>).skill_name;
      if (typeof skillName === 'string' && skillName.trim()) {
        names.add(skillName.trim());
      }
    }
    return [...names];
  }

  private extractCompatibleSkillNames(payload: Record<string, unknown>, fallback: string[]): string[] {
    const compatibility = Array.isArray(payload.compatibility) ? payload.compatibility : [];
    const compatible = new Set<string>();
    for (const entry of compatibility) {
      if (!entry || typeof entry !== 'object') continue;
      const name = (entry as Record<string, unknown>).name;
      const status = (entry as Record<string, unknown>).status;
      if (typeof name === 'string' && typeof status === 'string' && status !== 'incompatible') {
        compatible.add(name);
      }
    }
    return compatible.size ? [...compatible] : fallback;
  }

  private extractAgentTemplates(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    return Array.isArray(payload.agent_templates)
      ? payload.agent_templates.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      : [];
  }

  private async autoAssignInstalledSkills(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const installedSkillNames = this.extractInstalledSkillNames(payload);
    if (!installedSkillNames.length) {
      return null;
    }

    const compatibleSkills = this.extractCompatibleSkillNames(payload, installedSkillNames);
    const agentTemplates = this.extractAgentTemplates(payload);
    const assignmentSummary: Record<string, unknown> = {
      strategy: 'none',
      compatibleSkills,
      skippedSkills: installedSkillNames.filter((skill) => !compatibleSkills.includes(skill)),
      agents: [],
    };

    if (agentTemplates.length) {
      const existingAgents = await this.agentsService.list();
      const assignedAgents: Array<Record<string, unknown>> = [];
      for (const template of agentTemplates) {
        const name = typeof template.name === 'string' ? template.name.trim() : '';
        const systemPrompt = typeof template.systemPrompt === 'string' ? template.systemPrompt.trim() : '';
        if (!name || !systemPrompt) continue;
        const description = typeof template.description === 'string' ? template.description.trim() : '';
        const modelId = typeof template.modelId === 'string' ? template.modelId : undefined;
        const existing = existingAgents.find((agent) => agent.name === name);
        const mergedSkills = existing
          ? [...new Set([...(existing.skills || []), ...compatibleSkills])]
          : compatibleSkills;

        const saved = existing
          ? await this.agentsService.update(existing.id, {
              description: description || existing.description || undefined,
              systemPrompt,
              modelId: modelId ?? existing.modelId ?? undefined,
              skills: mergedSkills,
            })
          : await this.agentsService.create({
              name,
              description,
              systemPrompt,
              modelId,
              skills: mergedSkills,
              isDefault: false,
            });

        assignedAgents.push({
          id: saved.id,
          name: saved.name,
          mode: existing ? 'updated' : 'created',
          assignedSkills: compatibleSkills,
        });
      }

      if (assignedAgents.length) {
        assignmentSummary.strategy = 'agent_templates';
        assignmentSummary.agents = assignedAgents;
        return assignmentSummary;
      }
    }

    const existingAgents = await this.agentsService.list();
    const fallbackAgent = existingAgents.find((agent) => agent.isDefault) ?? existingAgents[0] ?? null;
    if (!fallbackAgent) {
      assignmentSummary.strategy = 'none';
      return assignmentSummary;
    }

    const mergedSkills = [...new Set([...(fallbackAgent.skills || []), ...compatibleSkills])];
    const updated = await this.agentsService.update(fallbackAgent.id, {
      skills: mergedSkills,
    });

    assignmentSummary.strategy = fallbackAgent.isDefault ? 'default_agent' : 'first_available_agent';
    assignmentSummary.agents = [
      {
        id: updated.id,
        name: updated.name,
        mode: 'updated',
        assignedSkills: compatibleSkills,
      },
    ];
    return assignmentSummary;
  }
}
