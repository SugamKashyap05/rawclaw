import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ToolInfo, ToolHealthStatus, ToolSchema } from '@rawclaw/shared';
import { AxiosError } from 'axios';

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
    this.agentUrl = this.configService.getOrThrow<string>('AGENT_URL');
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
      return (error.response?.data as { message?: string } | undefined)?.message || error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }

  /**
   * List all tools with their schemas.
   */
  async listTools(): Promise<ToolsListResponse> {
    try {
      const res = await firstValueFrom(
        this.httpService.get<ToolsListResponse>(`${this.agentUrl}/api/tools`)
      );
      return res.data;
    } catch (error) {
      const msg = this.getErrorMessage(error);
      console.error(`Failed to list tools from agent at ${this.agentUrl}:`, msg);
      return { tools: [], count: 0 };
    }
  }

  /**
   * List all tools with health status.
   */
  async listToolsInfo(): Promise<{ tools: ToolInfo[]; count: number }> {
    try {
      const res = await firstValueFrom(
        this.httpService.get<{ tools: ToolInfo[]; count: number }>(`${this.agentUrl}/api/tools/info`)
      );
      return res.data;
    } catch (error) {
      const msg = this.getErrorMessage(error);
      console.error(`Failed to list tools info at ${this.agentUrl}:`, msg);
      return { tools: [], count: 0 };
    }
  }

  /**
   * Get health status for all tools.
   */
  async getToolsHealth(): Promise<Record<string, ToolHealthStatus>> {
    try {
      const res = await firstValueFrom(
        this.httpService.get<{ health: Record<string, ToolHealthStatus> }>(`${this.agentUrl}/api/tools/health`)
      );
      return res.data.health;
    } catch (error) {
      const msg = this.getErrorMessage(error);
      console.error(`Failed to get tools health at ${this.agentUrl}:`, msg);
      return {};
    }
  }

  /**
   * Get details for a specific tool.
   */
  async getTool(toolName: string): Promise<ToolDetailResponse> {
    try {
      const res = await firstValueFrom(
        this.httpService.get<ToolDetailResponse>(`${this.agentUrl}/api/tools/${toolName}`)
      );
      return res.data;
    } catch (error) {
      console.error(`Failed to get tool ${toolName}:`, this.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * List connected MCP servers.
   */
  async listMCPServers(): Promise<MCPServersResponse> {
    try {
      const res = await firstValueFrom(
        this.httpService.get<MCPServersResponse>(`${this.agentUrl}/api/mcp/servers`)
      );
      return res.data;
    } catch (error) {
      const msg = this.getErrorMessage(error);
      console.error(`Failed to list MCP servers at ${this.agentUrl}:`, msg);
      return { servers: [], connected: false };
    }
  }

  /**
   * Get MCP health status.
   */
  async getMCPHealth(): Promise<MCPHealthResponse> {
    try {
      const res = await firstValueFrom(
        this.httpService.get<MCPHealthResponse>(`${this.agentUrl}/api/mcp/health`)
      );
      return res.data;
    } catch (error) {
      const msg = this.getErrorMessage(error);
      console.error(`Failed to get MCP health at ${this.agentUrl}:`, msg);
      return { connected: false, servers: [], connected_count: 0 };
    }
  }
}
