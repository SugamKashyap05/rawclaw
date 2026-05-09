import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

  @Post('maintenance/dedupe-tool-discovery')
  async dedupeToolDiscovery(@Body() body?: { dryRun?: boolean }) {
    return this.memoryService.dedupeToolDiscovery(Boolean(body?.dryRun));
  }

  @Post('maintenance/prune-sessions')
  async pruneSessions(@Body() body?: { ttlDays?: number; maxEntriesPerSession?: number; dryRun?: boolean }) {
    return this.memoryService.pruneSessionIndex({
      ttlDays: body?.ttlDays,
      maxEntriesPerSession: body?.maxEntriesPerSession,
      dryRun: body?.dryRun,
    });
  }

  @Delete('entries/:id')
  async deleteEntry(@Param('id') id: string): Promise<{ success: true }> {
    return this.memoryService.deleteEntry(id);
  }

  @Patch('entries/:id')
  async updateEntry(
    @Param('id') id: string,
    @Body() body: { content?: string; tags?: string[]; collection?: string; source?: string },
  ): Promise<MemoryEntry> {
    const readOnlyFields = ['collection', 'source'].filter((field) => Object.prototype.hasOwnProperty.call(body || {}, field));
    if (readOnlyFields.length) {
      throw new HttpException({
        error: 'read_only_field',
        fields: readOnlyFields,
        message: `${readOnlyFields.join(', ')} cannot be changed after creation. To move an entry, delete it and re-create it in the target scope.`,
      }, HttpStatus.BAD_REQUEST);
    }
    return this.memoryService.updateEntry(id, {
      content: body.content,
      tags: body.tags,
    });
  }
}
