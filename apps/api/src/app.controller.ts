import { Controller, Get } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { firstValueFrom } from 'rxjs';

@Controller('health-v2')
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async getHealth() {
    const dbHealth = await this.checkDatabaseHealth();
    const agentHealth = await this.checkAgentHealth();
    const redisHealth = await this.checkRedisHealth();

    return {
      status: dbHealth && agentHealth && redisHealth ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      components: {
        database: dbHealth,
        agent: agentHealth,
        redis: redisHealth,
      },
    };
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedisHealth(): Promise<boolean> {
    try {
      return await this.redis.ping();
    } catch {
      return false;
    }
  }

  private async checkAgentHealth(): Promise<boolean> {
    try {
      const agentUrl = this.config.get<string>('agentUrl');
      const response = await firstValueFrom(
        this.http.get(`${agentUrl}/health`, { timeout: 2000 }),
      );
      return response.data?.status === 'ok';
    } catch {
      return false;
    }
  }
}
