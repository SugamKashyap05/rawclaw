import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SkillDefinition, SkillRunResponse } from '@rawclaw/shared';

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
}
