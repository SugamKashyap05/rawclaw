import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { MemoryEntry, MemorySearchRequest, MemorySearchResult, MemoryStats } from '@rawclaw/shared';
import { MemoryService } from './memory.service';

@UseGuards(JwtAuthGuard)
@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('stats')
  async getStats(): Promise<MemoryStats> {
    return this.memoryService.getStats();
  }

  @Post('add')
  async addMemory(
    @Body() body: { content: string; tags?: string[]; source?: string; collection?: string },
  ): Promise<MemoryEntry> {
    return this.memoryService.add(body);
  }

  @Post('search')
  async searchMemory(@Body() body: MemorySearchRequest): Promise<{ results: MemorySearchResult[] }> {
    return { results: await this.memoryService.search(body) };
  }

  @Delete('clear')
  async clearMemory(@Query('collection') collection?: string): Promise<{ cleared: number }> {
    return this.memoryService.clear(collection);
  }
}
