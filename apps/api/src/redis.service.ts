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
    const redisUrl = this.configService.getOrThrow<string>('redisUrl');
    this.client = new Redis(redisUrl, this.connectionOptions);
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  async ping(): Promise<boolean> {
    return this.pingClient(this.client);
  }

  private async pingClient(client: Redis): Promise<boolean> {
    try {
      const response = await client.ping();
      return response === 'PONG';
    } catch {
      return false;
    }
  }

  async waitUntilReady(timeoutMs = 5000, intervalMs = 250): Promise<boolean> {
    return this.waitForClientReady(this.client, timeoutMs, intervalMs);
  }

  private async waitForClientReady(client: Redis, timeoutMs = 5000, intervalMs = 250): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.pingClient(client)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
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

  async evalScript<T = unknown>(script: string, keys: string[], args: Array<string | number>): Promise<T> {
    return await this.client.eval(script, keys.length, ...keys, ...args.map((arg) => String(arg))) as T;
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
    const redisUrl = this.configService.getOrThrow<string>('redisUrl');
    const subscriber = new Redis(redisUrl, this.connectionOptions);
    const ready = await this.waitForClientReady(subscriber, 5000, 250);
    if (!ready) {
      subscriber.disconnect();
      throw new Error(`Redis subscriber for channel '${channel}' is not ready.`);
    }
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

  async xGroupCreate(stream: string, group: string, startId = '$'): Promise<void> {
    try {
      await this.client.xgroup('CREATE', stream, group, startId, 'MKSTREAM');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  async xAdd(stream: string, values: Record<string, string>, maxLength?: number): Promise<string> {
    const pairs = Object.entries(values).flatMap(([key, value]) => [key, value]);
    if (maxLength && maxLength > 0) {
      return await (this.client as any).xadd(stream, 'MAXLEN', '~', String(maxLength), '*', ...pairs) as string;
    }
    return await (this.client as any).xadd(stream, '*', ...pairs) as string;
  }

  async xReadGroup(
    group: string,
    consumer: string,
    stream: string,
    count = 1,
    blockMs = 0,
  ): Promise<Array<{ stream: string; entries: Array<{ id: string; values: Record<string, string> }> }>> {
    const args: Array<string | number> = ['GROUP', group, consumer, 'COUNT', count];
    if (blockMs > 0) {
      args.push('BLOCK', blockMs);
    }
    args.push('STREAMS', stream, '>');
    const response = await (this.client as any).xreadgroup(...args);
    if (!response) {
      return [];
    }

    return (response as Array<[string, Array<[string, string[]]>]>).map(([streamName, entries]) => ({
      stream: streamName,
      entries: entries.map(([id, rawValues]) => {
        const values: Record<string, string> = {};
        for (let index = 0; index < rawValues.length; index += 2) {
          values[rawValues[index]] = rawValues[index + 1];
        }
        return { id, values };
      }),
    }));
  }

  async xAck(stream: string, group: string, ...ids: string[]): Promise<number> {
    if (!ids.length) {
      return 0;
    }
    return this.client.xack(stream, group, ...ids);
  }
}
