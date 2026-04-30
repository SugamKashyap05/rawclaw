import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CommandMemoryOverview, MemoryEntry, MemorySearchRequest, MemorySearchResult, MemoryStats } from '@rawclaw/shared';
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

  @Get('overview')
  async getOverview(@Query('sessionId') sessionId?: string): Promise<CommandMemoryOverview> {
    return this.memoryService.getCommandOverview(sessionId);
  }

  @Get('entries')
  async listEntries(
    @Query('collection') collection?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
  ): Promise<MemoryEntry[]> {
    return this.memoryService.listEntries({
      collection,
      source,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Delete('clear')
  async clearMemory(@Query('collection') collection?: string): Promise<{ cleared: number }> {
    return this.memoryService.clear(collection);
  }

  @Delete('entries/:id')
  async deleteEntry(@Param('id') id: string): Promise<{ success: true }> {
    return this.memoryService.deleteEntry(id);
  }
}
