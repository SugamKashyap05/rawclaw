import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

interface SessionState {
  [key: string]: unknown;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private readonly connectionOptions = {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
  } as const;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Rely exclusively on environment, no hardcoded defaults per Requirement 5
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(redisUrl, this.connectionOptions);
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

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, payload);
  }

  async setJsonIfAbsent(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const payload = JSON.stringify(value);
    const result = ttlSeconds && ttlSeconds > 0
      ? await this.client.set(key, payload, 'EX', ttlSeconds, 'NX')
      : await this.client.set(key, payload, 'NX');
    return result === 'OK';
  }

  async getJson<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    return data ? JSON.parse(data) as T : null;
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  async pushJsonList(key: string, value: unknown, maxLength?: number): Promise<void> {
    const payload = JSON.stringify(value);
    await this.client.lpush(key, payload);
    if (maxLength && maxLength > 0) {
      await this.client.ltrim(key, 0, maxLength - 1);
    }
  }

  async getJsonList<T>(key: string, start = 0, stop = -1): Promise<T[]> {
    const items = await this.client.lrange(key, start, stop);
    return items
      .map((item) => {
        try {
          return JSON.parse(item) as T;
        } catch {
          return null;
        }
      })
      .filter((item): item is T => item !== null);
  }

  async subscribe(
    channel: string,
    onMessage: (payload: string) => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    const subscriber = new Redis(redisUrl, this.connectionOptions);
    await subscriber.subscribe(channel);
    subscriber.on('message', (_channel, message) => {
      if (_channel === channel) {
        void onMessage(message);
      }
    });
    return async () => {
      try {
        await subscriber.unsubscribe(channel);
      } finally {
        subscriber.disconnect();
      }
    };
  }
}
