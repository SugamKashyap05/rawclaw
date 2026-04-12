import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ToolInfo, ToolHealthStatus, ToolSchema } from '@rawclaw/shared';

export interface ToolsListResponse {
  tools: ToolSchema[];
  count: number;
}

export interface MCPServersResponse {
  servers: { name: string; connected: boolean; tool_count: number; tools: unknown[] }[];
  connected: boolean;
}

export interface MCPHealthResponse {
  connected: boolean;
  servers: string[];
  connected_count: number;
  message?: string;
}

export interface ToolDetailResponse {
  tool: ToolSchema;
}

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
  async listTools(): Promise<ToolsListResponse> {
    const res = await firstValueFrom(
      this.httpService.get<ToolsListResponse>(`${this.agentUrl}/api/tools`)
    );
    return res.data;
  }

  /**
   * List all tools with health status.
   */
  async listToolsInfo(): Promise<{ tools: ToolInfo[]; count: number }> {
    const res = await firstValueFrom(
      this.httpService.get<{ tools: ToolInfo[]; count: number }>(`${this.agentUrl}/api/tools/info`)
    );
    return res.data;
  }

  /**
   * Get health status for all tools.
   */
  async getToolsHealth(): Promise<Record<string, ToolHealthStatus>> {
    const res = await firstValueFrom(
      this.httpService.get<{ health: Record<string, ToolHealthStatus> }>(`${this.agentUrl}/api/tools/health`)
    );
    return res.data.health;
  }

  /**
   * Get details for a specific tool.
   */
  async getTool(toolName: string): Promise<ToolDetailResponse> {
    const res = await firstValueFrom(
      this.httpService.get<ToolDetailResponse>(`${this.agentUrl}/api/tools/${toolName}`)
    );
    return res.data;
  }

  /**
   * List connected MCP servers.
   */
  async listMCPServers(): Promise<MCPServersResponse> {
    const res = await firstValueFrom(
      this.httpService.get<MCPServersResponse>(`${this.agentUrl}/api/mcp/servers`)
    );
    return res.data;
  }

  /**
   * Get MCP health status.
   */
  async getMCPHealth(): Promise<MCPHealthResponse> {
    const res = await firstValueFrom(
      this.httpService.get<MCPHealthResponse>(`${this.agentUrl}/api/mcp/health`)
    );
    return res.data;
  }
}