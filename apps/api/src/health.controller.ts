import { Controller, Get } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';
import { HealthStatus, RAWCLAW_VERSION } from '@rawclaw/shared';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(
    private readonly redisService: RedisService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  async getHealth(): Promise<HealthStatus> {
    const redisOk = await this.redisService.ping();
    let agentOk = false;
    let dbOk = false;
    
    // 1. Database check
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Health check: Database is down: ${msg}`);
    }

    // 2. Agent check
    try {
      const configuredAgentUrl = this.configService.get<string>('agentUrl') || 'http://localhost:8001';
      const agentUrl = configuredAgentUrl.replace('localhost', '127.0.0.1');
      const response = await firstValueFrom(this.httpService.get(`${agentUrl}/health`, { timeout: 2000 }));
      if (response.data?.status === 'ok') {
        agentOk = true;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.warn(`Health check: Agent is unreachable at 127.0.0.1: ${message}`);
      agentOk = false;
    }

    const services = {
      db: dbOk ? 'ok' as const : 'down' as const,
      redis: redisOk ? 'ok' as const : 'down' as const,
      agent: agentOk ? 'ok' as const : 'down' as const
    };

    const isDegraded = Object.values(services).some(s => s === 'down');

    console.log(`Health Status: ${isDegraded ? 'DEGRADED' : 'OK'} - Redis: ${services.redis}, Agent: ${services.agent}`);

    return {
      status: isDegraded ? 'degraded' : 'ok',
      version: RAWCLAW_VERSION,
      timestamp: new Date().toISOString(),
      services
    };
  }
}
