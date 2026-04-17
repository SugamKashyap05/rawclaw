import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import { SystemStatusSnapshot } from '@rawclaw/shared';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ToolsService } from './tools/tools.service';
import { TasksService } from './tasks/tasks.service';
import { AgentsService } from './agents.service';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class SystemService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly toolsService: ToolsService,
    private readonly tasksService: TasksService,
    private readonly agentsService: AgentsService,
    private readonly prisma: PrismaService,
  ) {}

  async getStatus(): Promise<SystemStatusSnapshot> {
    const [serviceHealth, mcpHealth, recentRuns, runningAgents] = await Promise.all([
      this.getServiceHealth(),
      this.toolsService.getMCPHealth(),
      this.tasksService.listRuns(1, 50),
      this.agentsService.countRunning(),
    ]);

    const pendingTasks = recentRuns.filter((run) => ['queued', 'running'].includes(run.status)).length;

    return {
      services: serviceHealth,
      websocket: {
        connected: true,
      },
      git: {
        branch: this.safeGit('git branch --show-current') || 'unknown',
        lastCommit: this.safeGit('git log -1 --pretty=%h %s') || null,
      },
      counts: {
        agents: runningAgents,
        mcpServers: mcpHealth.connected_count,
        pendingTasks,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private async getServiceHealth(): Promise<SystemStatusSnapshot['services']> {
    const [redisOk, databaseOk, chromaOk] = await Promise.all([
      this.redisService.ping(),
      this.checkDatabase(),
      this.checkChroma(),
    ]);
    let agent: SystemStatusSnapshot['services']['agent'] = 'down';

    try {
      const agentUrl = this.configService.getOrThrow<string>('AGENT_URL');
      const response = await firstValueFrom(this.httpService.get(`${agentUrl}/health`, { timeout: 2000 }));
      agent = response.data?.status === 'ok' ? 'ok' : 'down';
    } catch {
      agent = 'down';
    }

    return {
      api: agent === 'ok' && redisOk && databaseOk ? 'ok' : 'degraded',
      agent,
      redis: redisOk ? 'ok' : 'down',
      chroma: chromaOk ? 'ok' : 'down',
      database: databaseOk ? 'ok' : 'down',
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkChroma(): Promise<boolean> {
    try {
      const host = this.configService.get<string>('CHROMA_HOST') || this.configService.get<string>('chromaHost') || 'localhost';
      const port = this.configService.get<number>('CHROMA_PORT') || this.configService.get<number>('chromaPort') || 8010;
      const response = await firstValueFrom(
        this.httpService.get(`http://${host}:${port}/api/v2/heartbeat`, { timeout: 2000 }),
      );
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  private safeGit(command: string): string {
    try {
      return execSync(command, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      return '';
    }
  }
}
