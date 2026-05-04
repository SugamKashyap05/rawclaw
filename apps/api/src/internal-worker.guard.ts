import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { GatewayEventsService } from './gateway-events.service';
import { InternalWorkerAuthService, InternalWorkerTokenClaims } from './internal-worker-auth.service';

@Injectable()
export class InternalWorkerGuard implements CanActivate {
  private readonly logger = new Logger(InternalWorkerGuard.name);

  constructor(
    private readonly authService: InternalWorkerAuthService,
    private readonly gatewayEvents: GatewayEventsService,
  ) {}

  private async reject(reason: string): Promise<never> {
    this.logger.warn(`Internal worker auth rejected: ${reason}`);
    await this.gatewayEvents.publish({
      type: 'health.degraded',
      summary: `Internal worker auth rejected: ${reason}`,
      payload: {
        subsystem: 'internal_worker_auth',
        reason,
      },
    });
    throw new UnauthorizedException(reason);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      path?: string;
      headers: Record<string, string | string[] | undefined>;
      internalWorkerClaims?: InternalWorkerTokenClaims;
    }>();
    const path = request.path || '';
    const isBootstrapPath = path.endsWith('/workers/register') || path.endsWith('/service-token');
    const headerValue = request.headers['x-rawclaw-worker-secret'];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const authHeaderValue = request.headers.authorization;
    const authorization = Array.isArray(authHeaderValue) ? authHeaderValue[0] : authHeaderValue;

    if (isBootstrapPath) {
      if (!this.authService.validateBootstrapSecret(provided)) {
        await this.reject('bad bootstrap secret');
      }
      return true;
    }

    if (!authorization || !authorization.startsWith('Bearer ')) {
      await this.reject('missing authorization header');
    }

    const token = (authorization ?? '').slice('Bearer '.length).trim();
    try {
      request.internalWorkerClaims = this.authService.verifyBearerToken(token);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.reject(String(error.message || 'invalid bearer token'));
      }
      await this.reject('invalid bearer token');
    }
    return true;
  }
}
