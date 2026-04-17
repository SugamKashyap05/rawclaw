import { Controller, Get, Param } from '@nestjs/common';
import { DocsEntry, DocsIndexResponse } from '@rawclaw/shared';
import { DocsService } from './docs.service';

@Controller('docs')
export class DocsController {
  constructor(private readonly docsService: DocsService) {}

  @Get()
  async getIndex(): Promise<DocsIndexResponse> {
    return this.docsService.getIndex();
  }

  @Get(':slug')
  async getEntry(@Param('slug') slug: string): Promise<DocsEntry> {
    return this.docsService.getEntry(slug);
  }

  @Get('system/context')
  async getSystemContext(): Promise<{ content: string }> {
    return { content: await this.docsService.getSystemContext() };
  }
}
