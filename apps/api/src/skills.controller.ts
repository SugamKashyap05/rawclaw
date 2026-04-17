import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { SkillsService } from './skills.service';
import { SkillDefinition, SkillRunResponse } from '@rawclaw/shared';

@UseGuards(JwtAuthGuard)
@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  list(): Promise<SkillDefinition[]> {
    return this.skillsService.list();
  }

  @Post(':name/run')
  run(@Param('name') name: string, @Body() body: { params?: Record<string, unknown> }): Promise<SkillRunResponse> {
    return this.skillsService.run(name, body.params ?? {});
  }
}
