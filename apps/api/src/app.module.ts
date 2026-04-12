import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { ChatController } from './chat.controller';
import { RedisService } from './redis.service';
import { ChatService } from './chat.service';
import { PrismaService } from './prisma.service';
import { ToolConfirmationController } from './tool-confirmation.controller';
import { ToolConfirmationService } from './tool-confirmation.service';
import { ToolsModule } from './tools/tools.module';
import { MCPModule } from './mcp/mcp.module';
import { TasksModule } from './tasks/tasks.module';

import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      isGlobal: true,
    }),
    HttpModule,
    ToolsModule,
    MCPModule,
    TasksModule,
  ],
  controllers: [HealthController, ChatController, ToolConfirmationController],
  providers: [RedisService, ChatService, PrismaService, ToolConfirmationService],
})
export class AppModule {}