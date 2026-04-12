import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
} from '@nestjs/common';
import { ToolsService } from '../tools/tools.service';

@Controller('mcp')
export class MCPController {
  constructor(private readonly toolsService: ToolsService) {}

  /**
   * GET /api/mcp/servers
   * List all connected MCP servers and their tools.
   */
  @Get('servers')
  async listServers() {
    return this.toolsService.listMCPServers();
  }

  /**
   * GET /api/mcp/health
   * Get health status for MCP connections.
   */
  @Get('health')
  async getHealth() {
    return this.toolsService.getMCPHealth();
  }
}