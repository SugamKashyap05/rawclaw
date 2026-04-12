import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ToolInfo, ToolHealthStatus, MCPConnectionResult, MCPToolInfo } from '@rawclaw/shared';

@Injectable()
export class ToolsService {
  private agentUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.agentUrl = this.configService.get<string>('agentUrl', 'http://localhost:8000');
  }

  /**
   * List all tools with their schemas.
   */
  async listTools(): Promise<{ tools: any[]; count: number }> {
    const res = await firstValueFrom(
      this.httpService.get(`${this.agentUrl}/api/tools`)
    );
    return res.data;
  }

  /**
   * List all tools with health status.
   */
  async listToolsInfo(): Promise<{ tools: ToolInfo[]; count: number }> {
    const res = await firstValueFrom(
      this.httpService.get(`${this.agentUrl}/api/tools/info`)
    );
    return res.data;
  }

  /**
   * Get health status for all tools.
   */
  async getToolsHealth(): Promise<Record<string, ToolHealthStatus>> {
    const res = await firstValueFrom(
      this.httpService.get(`${this.agentUrl}/api/tools/health`)
    );
    return res.data.health;
  }

  /**
   * Get details for a specific tool.
   */
  async getTool(toolName: string): Promise<any> {
    const res = await firstValueFrom(
      this.httpService.get(`${this.agentUrl}/api/tools/${toolName}`)
    );
    return res.data;
  }

  /**
   * List connected MCP servers.
   */
  async listMCPServers(): Promise<any> {
    const res = await firstValueFrom(
      this.httpService.get(`${this.agentUrl}/api/mcp/servers`)
    );
    return res.data;
  }

  /**
   * Get MCP health status.
   */
  async getMCPHealth(): Promise<any> {
    const res = await firstValueFrom(
      this.httpService.get(`${this.agentUrl}/api/mcp/health`)
    );
    return res.data;
  }
}