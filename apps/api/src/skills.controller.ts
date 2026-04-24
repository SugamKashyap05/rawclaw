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

  @Get('status')
  status() {
    return this.skillsService.status();
  }

  @Get('research')
  listResearched() {
    return this.skillsService.listResearched();
  }

  @Post('clone')
  clone(@Body() body: { repo_url: string }) {
    return this.skillsService.clone(body.repo_url);
  }

  @Post('install')
  install(@Body() body: { source_path: string }) {
    return this.skillsService.install(body.source_path);
  }

  @Post('build')
  build(@Body() body: { name: string; description: string; tags: string[]; instructions: string }) {
    return this.skillsService.build(body);
  }

  @Post(':name/run')
  run(@Param('name') name: string, @Body() body: { params?: Record<string, unknown> }): Promise<SkillRunResponse> {
    return this.skillsService.run(name, body.params ?? {});
  }
}
