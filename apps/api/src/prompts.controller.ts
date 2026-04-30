import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PromptCatalogService } from './prompt-catalog.service';
import { AgentsService } from './agents.service';

@UseGuards(JwtAuthGuard)
@Controller('prompts')
export class PromptsController {
  constructor(
    private readonly promptCatalog: PromptCatalogService,
    private readonly agentsService: AgentsService,
  ) {}

  @Get('packs')
  listPacks() {
    return this.promptCatalog.listPacks();
  }

  @Get('packs/:id')
  getPack(@Param('id') id: string) {
    return this.promptCatalog.getPack(id);
  }

  @Post('resolve')
  async resolvePrompt(@Body() body: { agentId?: string; latestUserContent?: string; reviewEnabled?: boolean }) {
    const selectedAgent = body.agentId ? await this.agentsService.getOptional(body.agentId) : null;
    const composed = this.promptCatalog.composeChatPrompt({
      systemContext: '',
      workspaceFiles: {},
      selectedAgent,
      latestUserContent: body.latestUserContent || '',
      reviewEnabled: !!body.reviewEnabled,
    });
    return {
      prompt: composed.prompt,
      provenance: composed.provenance,
      templates: composed.templates,
    };
  }
}
