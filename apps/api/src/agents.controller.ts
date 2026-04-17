import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentProfile, CreateAgentRequest, UpdateAgentRequest } from '@rawclaw/shared';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list(): Promise<AgentProfile[]> {
    return this.agentsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<AgentProfile> {
    return this.agentsService.get(id);
  }

  @Post()
  create(@Body() payload: CreateAgentRequest): Promise<AgentProfile> {
    return this.agentsService.create(payload);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: UpdateAgentRequest): Promise<AgentProfile> {
    return this.agentsService.update(id, payload);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.agentsService.remove(id);
  }
}
