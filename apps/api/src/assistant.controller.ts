import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AssistantBriefing, AssistantState, AdvisoryItem } from '@rawclaw/shared';
import { AssistantService } from './assistant.service';

@UseGuards(JwtAuthGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Get('state')
  async getState(): Promise<AssistantState> {
    return this.assistantService.getState();
  }

  @Patch('state')
  async updateState(@Body() body: Partial<AssistantState>): Promise<AssistantState> {
    return this.assistantService.updateState(body);
  }

  @Get('briefing')
  async getBriefing(): Promise<AssistantBriefing> {
    return this.assistantService.generateBriefing();
  }

  @Get('advisories')
  async getAdvisories(): Promise<AdvisoryItem[]> {
    return this.assistantService.listAdvisories();
  }
}
