import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MCPService } from './mcp.service';
import {
  CreateMCPServerRequest,
  MCPServerRecord,
  TestMCPConnectionRequest,
  TestMCPConnectionResponse,
} from '@rawclaw/shared';

@UseGuards(JwtAuthGuard)
@Controller('mcp')
export class MCPController {
  constructor(private readonly mcpService: MCPService) {}

  @Get('servers')
  listServers(): Promise<MCPServerRecord[]> {
    return this.mcpService.listServers();
  }

  @Post('servers')
  create(@Body() payload: CreateMCPServerRequest): Promise<MCPServerRecord> {
    return this.mcpService.create(payload);
  }

  @Post('servers/test')
  testConnection(@Body() payload: TestMCPConnectionRequest): Promise<TestMCPConnectionResponse> {
    return this.mcpService.testConnection(payload);
  }

  @Post('servers/:id/start')
  start(@Param('id') id: string): Promise<MCPServerRecord> {
    return this.mcpService.start(id);
  }

  @Post('servers/:id/stop')
  stop(@Param('id') id: string): Promise<MCPServerRecord> {
    return this.mcpService.stop(id);
  }

  @Delete('servers/:id')
  remove(@Param('id') id: string) {
    return this.mcpService.remove(id);
  }

  @Get('health')
  getHealth() {
    return this.mcpService.getHealth();
  }
}
