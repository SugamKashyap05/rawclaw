import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
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
import { ModelsController } from './models.controller';
import { ModelsService } from './models.service';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { WorkspaceController } from './workspace.controller';
import { ChatOrchestratorService } from './chat-orchestrator.service';

import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      isGlobal: true,
    }),
    HttpModule,
    ScheduleModule.forRoot(),
    ToolsModule,
    MCPModule,
    TasksModule,
  ],
  controllers: [
    HealthController,
    ChatController,
    ToolConfirmationController,
    ModelsController,
    DocsController,
    MemoryController,
    AgentsController,
    SettingsController,
    SkillsController,
    SystemController,
    WorkspaceController,
  ],
  providers: [
    RedisService,
    ChatService,
    ChatOrchestratorService,
    PrismaService,
    ToolConfirmationService,
    ModelsService,
    DocsService,
    MemoryService,
    AgentsService,
    SettingsService,
    SkillsService,
    SystemService,
  ],
})
export class AppModule {}
