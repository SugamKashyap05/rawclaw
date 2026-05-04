import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<any>();
    const path = String(request?.path || request?.url || '');
    const isMetrics = /\/app-builder\/metrics(?:\?|$)/.test(path);
    const nodeEnv = String(this.configService.get<string>('NODE_ENV') || '').toLowerCase();
    const token = this.configService.get<string>('APP_BUILDER_DEV_METRICS_TOKEN') || '';
    const authorization = String(request?.headers?.authorization || '');
    if (isMetrics && nodeEnv !== 'production' && token.length >= 24 && authorization === `Bearer ${token}`) {
      return true;
    }
    return super.canActivate(context);
  }
}
