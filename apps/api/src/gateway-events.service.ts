import { Injectable, Logger } from '@nestjs/common';
import { GatewayEvent } from '@rawclaw/shared';
import { randomUUID } from 'crypto';
import { RedisService } from './redis.service';

const GATEWAY_EVENTS_CHANNEL = 'gateway:events';
const GATEWAY_EVENTS_RECENT_KEY = 'gateway:events:recent';
const MAX_RECENT_EVENTS = 250;

@Injectable()
export class GatewayEventsService {
  private readonly logger = new Logger(GatewayEventsService.name);

  constructor(private readonly redis: RedisService) {}

  async publish(event: Omit<GatewayEvent, 'id' | 'timestamp'> & Partial<Pick<GatewayEvent, 'id' | 'timestamp'>>): Promise<GatewayEvent> {
    const normalized: GatewayEvent = {
      id: event.id || randomUUID(),
      timestamp: event.timestamp || new Date().toISOString(),
      type: event.type,
      sessionId: event.sessionId ?? null,
      bindingId: event.bindingId ?? null,
      runId: event.runId ?? null,
      agentId: event.agentId ?? null,
      parentSessionId: event.parentSessionId ?? null,
      parentRunId: event.parentRunId ?? null,
      summary: event.summary ?? null,
      payload: event.payload ?? null,
    };
    await this.redis.pushJsonList(GATEWAY_EVENTS_RECENT_KEY, normalized, MAX_RECENT_EVENTS);
    await this.redis.publish(GATEWAY_EVENTS_CHANNEL, normalized);
    return normalized;
  }

  async listRecent(limit = 50): Promise<GatewayEvent[]> {
    const bounded = Math.max(1, Math.min(limit, MAX_RECENT_EVENTS));
    return this.redis.getJsonList<GatewayEvent>(GATEWAY_EVENTS_RECENT_KEY, 0, bounded - 1);
  }

  async subscribe(handler: (event: GatewayEvent) => void | Promise<void>): Promise<() => Promise<void>> {
    return this.redis.subscribe(GATEWAY_EVENTS_CHANNEL, async (payload) => {
      try {
        const parsed = JSON.parse(payload) as GatewayEvent;
        await handler(parsed);
      } catch (error) {
        this.logger.warn(`Failed to parse gateway event payload: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}
