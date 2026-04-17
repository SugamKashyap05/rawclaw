import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  CreateMCPServerRequest,
  MCPServerRecord,
  MCPServerTool,
  TestMCPConnectionRequest,
  TestMCPConnectionResponse,
} from '@rawclaw/shared';
import { PrismaService } from '../prisma.service';

interface AgentMcpServer {
  name: string;
  connected: boolean;
  tool_count: number;
  tools: Array<Record<string, unknown>>;
}

@Injectable()
export class MCPService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get agentUrl(): string {
    return this.configService.get<string>('agentUrl') || 'http://localhost:8000';
  }

  private get dockerMcpUrl(): string | null {
    return process.env.DOCKER_MCP_URL || null;
  }

  private get dockerMcpTransport(): 'stdio' | 'sse' {
    return process.env.DOCKER_MCP_TRANSPORT === 'sse' ? 'sse' : 'stdio';
  }

  private get dockerMcpProfile(): string | null {
    const profile = process.env.DOCKER_MCP_PROFILE?.trim();
    return profile ? profile : null;
  }

  private get dockerMcpCommand(): string {
    if (this.dockerMcpTransport === 'sse') {
      return this.dockerMcpUrl || '';
    }
    return 'docker';
  }

  private get dockerMcpArgs(): string[] {
    if (this.dockerMcpTransport === 'sse') {
      return [];
    }
    const args = ['mcp', 'gateway', 'run'];
    if (this.dockerMcpProfile) {
      args.push('--profile', this.dockerMcpProfile);
    }
    return args;
  }

  private get dockerMcpEnv(): Record<string, string> {
    if (this.dockerMcpTransport !== 'sse') {
      return {};
    }
    const token = process.env.MCP_GATEWAY_AUTH_TOKEN;
    return token ? { MCP_GATEWAY_AUTH_TOKEN: token } : {};
  }

  async listServers(): Promise<MCPServerRecord[]> {
    await this.ensureDockerToolkitOnline();

    const [savedConfigs, liveServers] = await Promise.all([
      this.prisma.mcpServerConfig.findMany({ orderBy: { updatedAt: 'desc' } }),
      this.fetchLiveServers(),
    ]);

    if (savedConfigs.length === 0 && liveServers.length > 0) {
      return liveServers.map((server, index) => ({
        id: `live-${index}`,
        name: server.name,
        type: this.dockerMcpTransport,
        command: this.dockerMcpCommand || 'Docker MCP not configured',
        args: this.dockerMcpArgs,
        env: this.dockerMcpEnv,
        status: server.connected ? 'running' : 'stopped',
        lastError: null,
        tools: this.normalizeTools(server.tools ?? []),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }

    return savedConfigs.map((config) => {
      const live = liveServers.find((server) => server.name === config.name);
      return {
        id: config.id,
        name: config.name,
        type: config.type as MCPServerRecord['type'],
        command: config.command,
        args: this.parseArgs(config.args),
        env: this.parseEnv(config.env),
        status: live?.connected ? 'running' : (config.status as MCPServerRecord['status']),
        lastError: config.lastError,
        tools: this.normalizeTools(live?.tools ?? []),
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      };
    });
  }

  async create(payload: CreateMCPServerRequest): Promise<MCPServerRecord> {
    const created = await this.prisma.mcpServerConfig.create({
      data: {
        name: payload.name.trim(),
        type: payload.type,
        command: payload.command.trim(),
        args: JSON.stringify(payload.args ?? []),
        env: JSON.stringify(payload.env ?? {}),
      },
    });

    return {
      id: created.id,
      name: created.name,
      type: created.type as MCPServerRecord['type'],
      command: created.command,
      args: this.parseArgs(created.args),
      env: this.parseEnv(created.env),
      status: created.status as MCPServerRecord['status'],
      lastError: created.lastError,
      tools: [],
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async start(id: string): Promise<MCPServerRecord> {
    const config = await this.prisma.mcpServerConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException(`MCP server ${id} not found`);

    await this.connectConfig(config);
    return this.requireServer(id);
  }

  async stop(id: string): Promise<MCPServerRecord> {
    const config = await this.prisma.mcpServerConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException(`MCP server ${id} not found`);

    try {
      await firstValueFrom(this.httpService.delete(`${this.agentUrl}/api/mcp/servers/${config.name}`));
    } catch {
      // Best-effort stop
    }

    await this.prisma.mcpServerConfig.update({
      where: { id },
      data: { status: 'stopped', lastError: null },
    });

    return this.requireServer(id);
  }

  async remove(id: string): Promise<{ success: true }> {
    const config = await this.prisma.mcpServerConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException(`MCP server ${id} not found`);

    try {
      await firstValueFrom(this.httpService.delete(`${this.agentUrl}/api/mcp/servers/${config.name}`));
    } catch {
      // Best-effort stop before delete
    }

    await this.prisma.mcpServerConfig.delete({ where: { id } });
    return { success: true };
  }

  async testConnection(payload: TestMCPConnectionRequest): Promise<TestMCPConnectionResponse> {
    const tempName = `test-${Date.now()}`;
    const body =
      payload.type === 'sse'
        ? { name: tempName, transport: 'sse', url: payload.command, env: payload.env ?? {} }
        : {
            name: tempName,
            transport: 'stdio',
            command: payload.command,
            args: payload.args ?? [],
            env: payload.env ?? {},
          };

    try {
      await firstValueFrom(this.httpService.post(`${this.agentUrl}/api/mcp/connect`, body));
      const tools = await this.fetchLiveServers();
      const match = tools.find((server) => server.name === tempName);
      try {
        await firstValueFrom(this.httpService.delete(`${this.agentUrl}/api/mcp/servers/${tempName}`));
      } catch {
        // Ignore cleanup errors
      }
      return {
        success: true,
        message: 'Connection successful',
        discoveredTools: this.normalizeTools(match?.tools ?? []),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        discoveredTools: [],
      };
    }
  }

  async getHealth() {
    await this.ensureDockerToolkitOnline();
    const live = await this.fetchLiveServers();
    return {
      connected: live.some((server) => server.connected),
      servers: live.map((server) => server.name),
      connected_count: live.filter((server) => server.connected).length,
    };
  }

  private async requireServer(id: string): Promise<MCPServerRecord> {
    const servers = await this.listServers();
    const server = servers.find((item) => item.id === id);
    if (!server) throw new NotFoundException(`MCP server ${id} not found`);
    return server;
  }

  private async fetchLiveServers(): Promise<AgentMcpServer[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ servers: AgentMcpServer[] }>(`${this.agentUrl}/api/mcp/servers`),
      );
      return response.data.servers ?? [];
    } catch {
      return [];
    }
  }

  private async ensureDockerToolkitOnline(): Promise<void> {
    if (!this.dockerMcpUrl) {
      if (this.dockerMcpTransport === 'sse') {
        return;
      }
    }

    if (this.dockerMcpTransport === 'sse' && !this.dockerMcpUrl) {
      return;
    }

    const config = await this.ensureDockerToolkitConfig();
    const liveServers = await this.fetchLiveServers();
    const liveDocker = liveServers.find((server) => server.name === config.name);
    if (liveDocker?.connected) {
      if (config.status !== 'running') {
        await this.prisma.mcpServerConfig.update({
          where: { id: config.id },
          data: { status: 'running', lastError: null },
        });
      }
      return;
    }

    await this.connectConfig(config);
  }

  private async ensureDockerToolkitConfig() {
    const existing = await this.prisma.mcpServerConfig.findUnique({
      where: { name: 'docker-toolkit' },
    });
    if (existing) {
      const nextCommand = this.dockerMcpCommand || existing.command;
      const nextArgs = JSON.stringify(this.dockerMcpArgs);
      const nextEnv = JSON.stringify(this.dockerMcpEnv);
      if (
        existing.type !== this.dockerMcpTransport ||
        existing.command !== nextCommand ||
        (existing.args || '[]') !== nextArgs ||
        (existing.env || '{}') !== nextEnv
      ) {
        return this.prisma.mcpServerConfig.update({
          where: { id: existing.id },
          data: {
            type: this.dockerMcpTransport,
            command: nextCommand,
            args: nextArgs,
            env: nextEnv,
          },
        });
      }
      return existing;
    }

    return this.prisma.mcpServerConfig.create({
      data: {
        name: 'docker-toolkit',
        type: this.dockerMcpTransport,
        command: this.dockerMcpCommand,
        args: JSON.stringify(this.dockerMcpArgs),
        env: JSON.stringify(this.dockerMcpEnv),
        status: 'stopped',
      },
    });
  }

  private async connectConfig(config: {
    id: string;
    name: string;
    type: string;
    command: string;
    args: string | null;
    env: string | null;
  }): Promise<void> {
    const body =
      config.type === 'sse'
        ? {
            name: config.name,
            transport: 'sse',
            url: config.command,
            env: this.parseEnv(config.env),
          }
        : {
            name: config.name,
            transport: 'stdio',
            command: config.command,
            args: this.parseArgs(config.args),
            env: this.parseEnv(config.env),
          };

    try {
      await firstValueFrom(this.httpService.post(`${this.agentUrl}/api/mcp/connect`, body));
      await this.prisma.mcpServerConfig.update({
        where: { id: config.id },
        data: { status: 'running', lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start MCP server';
      await this.prisma.mcpServerConfig.update({
        where: { id: config.id },
        data: { status: 'error', lastError: message },
      });
    }
  }

  private parseArgs(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  private parseEnv(raw: string | null): Record<string, string> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ) : {};
    } catch {
      return {};
    }
  }

  private normalizeTools(tools: Array<Record<string, unknown>>): MCPServerTool[] {
    return tools.map((tool) => ({
      name: typeof tool.name === 'string' ? tool.name : 'unknown',
      description: typeof tool.description === 'string' ? tool.description : null,
      input_schema: typeof tool.inputSchema === 'object'
        ? (tool.inputSchema as Record<string, unknown>)
        : typeof tool.input_schema === 'object'
          ? (tool.input_schema as Record<string, unknown>)
          : undefined,
    }));
  }
}
