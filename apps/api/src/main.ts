import { NestFactory } from '@nestjs/core';
import { otelSDK } from './telemetry';
import { AppModule } from './app.module';
import { ValidationPipe, ConsoleLogger } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { RateLimitService } from './rate-limit.service';
import type { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

otelSDK.start();

// Custom logger to write to workspace backend.log
class FileLogger extends ConsoleLogger {
  private logPath = path.resolve(__dirname, '..', '..', '..', 'backend.log');

  log(message: any, context?: string) {
    super.log(message, context);
    this.writeToFile('LOG', message, context);
  }

  error(message: any, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.writeToFile('ERROR', message, context, stack);
  }

  warn(message: any, context?: string) {
    super.warn(message, context);
    this.writeToFile('WARN', message, context);
  }

  debug(message: any, context?: string) {
    super.debug(message, context);
    this.writeToFile('DEBUG', message, context);
  }

  private writeToFile(level: string, message: any, context?: string, stack?: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [API] [${level}] [${context || 'App'}] ${message}${stack ? '\n' + stack : ''}\n`;
    try {
      fs.appendFileSync(this.logPath, logEntry);
    } catch (e) {
      // Fallback if file is locked
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
    rawBody: false,
    logger: new FileLogger(),
  });
  // Enable CORS since web will talk to this
  app.enableCors();
  app.setGlobalPrefix('api');

  // Increase JSON body limit for file attachment content
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });

  const rateLimitService = app.get(RateLimitService);
  app.use(['/api/chat', '/api/agent'], async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const userId = String(user?.id ?? user?.sub ?? req.ip ?? 'anonymous');
      const estimatedTokens = Math.max(1, Math.ceil(JSON.stringify(req.body ?? {}).length / 4));
      const decision = await rateLimitService.checkAndIncrement(userId, estimatedTokens);
      res.setHeader('RateLimit-Limit', String(decision.limit));
      res.setHeader('RateLimit-Remaining', String(decision.remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(decision.resetAt.getTime() / 1000)));
      if (!decision.allowed) {
        console.warn(`[rate_limit_hit] user_id=${userId} reason=${decision.reason}`);
        return res.status(429).json({
          error: decision.reason ?? 'rate_limit_exceeded',
          retry_after_seconds: decision.retryAfterSeconds,
        });
      }
      return next();
    } catch (error: any) {
      console.error(`[rate_limiter_unavailable] ${error?.message ?? error}`);
      return res.status(503).json({
        error: 'rate_limiter_unavailable',
        retry_after_seconds: 5,
      });
    }
  });
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  app.useGlobalFilters(new HttpExceptionFilter());
  
  const port = process.env.API_PORT || 3000;
  await app.listen(port);
  console.log(`API listening on port ${port}`);
}
bootstrap();
