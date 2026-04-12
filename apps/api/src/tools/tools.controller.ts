import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ToolsService } from './tools.service';
import { ToolInfo, ToolHealthStatus } from '@rawclaw/shared';

@Controller('tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  /**
   * GET /api/tools
   * List all registered tools with their schemas.
   */
  @Get()
  async listTools() {
    return this.toolsService.listTools();
  }

  /**
   * GET /api/tools/info
   * List all tools with health status.
   */
  @Get('info')
  async listToolsInfo(): Promise<{ tools: ToolInfo[]; count: number }> {
    return this.toolsService.listToolsInfo();
  }

  /**
   * GET /api/tools/health
   * Get health status for all tools.
   */
  @Get('health')
  async getToolsHealth(): Promise<Record<string, ToolHealthStatus>> {
    return this.toolsService.getToolsHealth();
  }

  /**
   * GET /api/tools/:name
   * Get details for a specific tool.
   */
  @Get(':name')
  async getTool(@Param('name') name: string) {
    return this.toolsService.getTool(name);
  }
}