import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export type InternalWorkerScope = 'worker' | 'service';

export interface InternalWorkerTokenClaims {
  sub: string;
  scope: InternalWorkerScope;
  workerId?: string | null;
  serviceId?: string | null;
  issuedAt: number;
  exp: number;
  version: 1;
}

@Injectable()
export class InternalWorkerAuthService {
  constructor(private readonly configService: ConfigService) {}

  private base64UrlEncode(value: string): string {
    return Buffer.from(value, 'utf-8').toString('base64url');
  }

  private base64UrlDecode(value: string): string {
    return Buffer.from(value, 'base64url').toString('utf-8');
  }

  private signPayload(payload: string): string {
    const signingKey = this.configService.getOrThrow<string>('internalWorkerSigningKey');
    return createHmac('sha256', signingKey).update(payload).digest('base64url');
  }

  getBootstrapSecret(): string {
    return this.configService.getOrThrow<string>('internalWorkerBootstrapSecret');
  }

  validateBootstrapSecret(provided?: string | null): boolean {
    const expected = this.getBootstrapSecret();
    const normalizedProvided = Buffer.from(provided || '', 'utf-8');
    const normalizedExpected = Buffer.from(expected, 'utf-8');
    if (normalizedProvided.length !== normalizedExpected.length) {
      return false;
    }
    return timingSafeEqual(normalizedProvided, normalizedExpected);
  }

  issueToken(input: {
    scope: InternalWorkerScope;
    workerId?: string | null;
    serviceId?: string | null;
    ttlSeconds?: number;
  }): { token: string; expiresAt: string; claims: InternalWorkerTokenClaims } {
    const ttlSeconds = Math.max(
      60,
      Number(input.ttlSeconds ?? this.configService.get<number>('internalWorkerTokenTtlSeconds') ?? 300),
    );
    const nowSeconds = Math.floor(Date.now() / 1000);
    const claims: InternalWorkerTokenClaims = {
      sub: input.scope === 'worker' ? `worker:${input.workerId || 'unknown'}` : `service:${input.serviceId || 'agent'}`,
      scope: input.scope,
      workerId: input.workerId ?? null,
      serviceId: input.serviceId ?? null,
      issuedAt: nowSeconds,
      exp: nowSeconds + ttlSeconds,
      version: 1,
    };
    const payload = this.base64UrlEncode(JSON.stringify(claims));
    const signature = this.signPayload(payload);
    return {
      token: `rcw1.${payload}.${signature}`,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      claims,
    };
  }

  verifyBearerToken(token: string): InternalWorkerTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'rcw1') {
      throw new UnauthorizedException('Invalid worker token format.');
    }

    const payload = parts[1];
    const signature = parts[2];
    const expected = this.signPayload(payload);
    const providedBuffer = Buffer.from(signature, 'utf-8');
    const expectedBuffer = Buffer.from(expected, 'utf-8');
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid worker token signature.');
    }

    let claims: InternalWorkerTokenClaims;
    try {
      claims = JSON.parse(this.base64UrlDecode(payload)) as InternalWorkerTokenClaims;
    } catch {
      throw new UnauthorizedException('Invalid worker token payload.');
    }

    if (!claims?.exp || claims.version !== 1 || !claims.scope || !claims.sub) {
      throw new UnauthorizedException('Incomplete worker token payload.');
    }
    if (claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Worker token expired.');
    }

    return claims;
  }

  shouldRefresh(claims: InternalWorkerTokenClaims, graceWindowSeconds = 60): boolean {
    return (claims.exp - Math.floor(Date.now() / 1000)) <= graceWindowSeconds;
  }
}
