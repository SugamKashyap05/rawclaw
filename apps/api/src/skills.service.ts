import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SkillDefinition, SkillRunResponse } from '@rawclaw/shared';

type SkillStatusResponse = {
  status: string;
  activeSkillsDir: string;
  researchDir: string;
  installedCount: number;
  installedSkillFiles: string[];
  researchedCount: number;
};

@Injectable()
export class SkillsService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
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
    return response.data;
  }

  async build(payload: { name: string; description: string; tags: string[]; instructions: string }): Promise<Record<string, unknown>> {
    const response = await firstValueFrom(
      this.httpService.post<Record<string, unknown>>(`${this.agentUrl}/api/skills/build`, payload),
    );
    return response.data;
  }
}
