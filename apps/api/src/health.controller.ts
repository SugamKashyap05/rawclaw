import { Controller, Get } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RedisService } from './redis.service';
import { HealthStatus, RAWCLAW_VERSION } from '@rawclaw/shared';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(
    private readonly redisService: RedisService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {}

  @Get()
  async getHealth(): Promise<HealthStatus> {
    const redisOk = await this.redisService.ping();
    let agentOk = false;
    try {
      const agentUrl = this.configService.get<string>('agentUrl');
      const response = await firstValueFrom(this.httpService.get(`${agentUrl}/health`, { timeout: 2000 }));
      if (response.data?.status === 'ok') {
        agentOk = true;
      }
    } catch {
      agentOk = false;
    }

    const services = {
      db: 'ok' as const, // Mocked to 'ok' per Phase 1 execution context
      redis: redisOk ? 'ok' as const : 'down' as const,
      agent: agentOk ? 'ok' as const : 'down' as const
    };

    const isDegraded = Object.values(services).some(s => s === 'down');

    return {
      status: isDegraded ? 'degraded' : 'ok',
      version: RAWCLAW_VERSION,
      timestamp: new Date().toISOString(),
      services
    };
  }
}
