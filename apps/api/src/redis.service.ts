import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

interface SessionState {
  [key: string]: unknown;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  onModuleInit() {
    // Rely exclusively on environment, no hardcoded urls per Requirement 5
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      const response = await this.client.ping();
      return response === 'PONG';
    } catch {
      return false;
    }
  }

  async saveSessionState(sessionId: string, state: SessionState): Promise<void> {
    await this.client.set(`session:${sessionId}`, JSON.stringify(state));
  }

  async getSessionState(sessionId: string): Promise<SessionState | null> {
    const data = await this.client.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }
}