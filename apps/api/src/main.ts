import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ConsoleLogger } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';

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
