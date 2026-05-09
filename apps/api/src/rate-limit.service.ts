import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface RateLimitDecision {
  allowed: boolean;
  reason?: 'rate_limit_exceeded' | 'daily_budget_exceeded';
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
  limit: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly minuteLimit = Number(process.env.RAWCLAW_CHAT_RATE_LIMIT_PER_MINUTE ?? 20);
  private readonly dailyTokenLimit = Number(process.env.RAWCLAW_DAILY_TOKEN_LIMIT ?? 100_000);

  constructor(private readonly redis: RedisService) {}

  async checkAndIncrement(userId: string, estimatedTokens: number): Promise<RateLimitDecision> {
    const identity = this.safeIdentity(userId);
    const now = new Date();
    const minuteBucket = Math.floor(now.getTime() / 60_000);
    const minuteKey = `rate:chat:${identity}:${minuteBucket}`;
    const budgetKey = `budget:${identity}:${now.toISOString().slice(0, 10)}`;

    const minuteCount = await this.incrementWithTtl(minuteKey, 60, 1);
    if (minuteCount > this.minuteLimit) {
      this.logger.warn({
        event: 'rate_limit_hit',
        user_id: identity,
        limit: this.minuteLimit,
        count: minuteCount,
      });
      return {
        allowed: false,
        reason: 'rate_limit_exceeded',
        remaining: 0,
        resetAt: new Date((minuteBucket + 1) * 60_000),
        retryAfterSeconds: 60,
        limit: this.minuteLimit,
      };
    }

    const dailyUsed = await this.incrementWithTtl(
      budgetKey,
      86_400,
      Math.max(1, estimatedTokens),
    );
    if (dailyUsed > this.dailyTokenLimit) {
      this.logger.warn({
        event: 'daily_budget_exceeded',
        user_id: identity,
        tokens_used: dailyUsed,
        limit: this.dailyTokenLimit,
      });
      return {
        allowed: false,
        reason: 'daily_budget_exceeded',
        remaining: 0,
        resetAt: new Date(new Date().setHours(24, 0, 0, 0)),
        retryAfterSeconds: 3600,
        limit: this.dailyTokenLimit,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.minuteLimit - minuteCount),
      resetAt: new Date((minuteBucket + 1) * 60_000),
      retryAfterSeconds: 0,
      limit: this.minuteLimit,
    };
  }

  private async incrementWithTtl(key: string, ttlSeconds: number, by: number): Promise<number> {
    const script = `
      local current = redis.call("INCRBY", KEYS[1], ARGV[1])
      if current == tonumber(ARGV[1]) then
        redis.call("EXPIRE", KEYS[1], ARGV[2])
      end
      return current
    `;
    return Number(await this.redis.evalScript<number>(script, [key], [by, ttlSeconds]));
  }

  private safeIdentity(raw: string): string {
    return String(raw || 'anonymous').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128);
  }
}
