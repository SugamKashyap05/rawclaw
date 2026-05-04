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
import { ChatNluService } from './chat-nlu.service';
import { DocumentProcessorService } from './document-processor.service';
import { PromptCatalogService } from './prompt-catalog.service';
import { PromptsController } from './prompts.controller';
import { SelfImprovementService } from './self-improvement.service';
import { SelfImprovementController } from './self-improvement.controller';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { ProcessControllerService } from './process-controller.service';
import { ProcessControllerController } from './process-controller.controller';
import { GatewayController } from './gateway.controller';
import { GatewayEventsService } from './gateway-events.service';
import { GatewayRoutingService } from './gateway-routing.service';
import { GatewaySubagentService } from './gateway-subagent.service';
import { GatewayExecutionService } from './gateway-execution.service';
import { GatewayAutomationService } from './gateway-automation.service';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewayWorkerController } from './gateway-worker.controller';
import { InternalWorkerAuthService } from './internal-worker-auth.service';
import { InternalWorkerGuard } from './internal-worker.guard';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { ReflectionService } from './reflection.service';
import { GatewayPhase3LifecycleService } from './gateway-phase3-lifecycle.service';
import { GatewayWorkerMonitorService } from './gateway-worker-monitor.service';
import { AppBuilderService } from './app-builder/app-builder.service';
import { AppBuilderController } from './app-builder.controller';
import { AppBuilderInternalController } from './app-builder.internal.controller';
import { IntentParserService } from './app-builder/intent-parser.service';
import { PlannerAiService } from './app-builder/planner-ai.service';
import { ArchitectureEngineService } from './app-builder/architecture-engine.service';
import { FileGraphGeneratorService } from './app-builder/file-graph-generator.service';
import { ContextEngineService } from './app-builder/context-engine.service';
import { CodeGenerationEngineService } from './app-builder/code-generation-engine.service';
import { ValidationEngineService } from './app-builder/validation-engine.service';
import { SelfHealingLoopService } from './app-builder/self-healing-loop.service';
import { DeploymentManagerService } from './app-builder/deployment-manager.service';
import { AppBuilderConfigService } from './app-builder/app-builder.config.service';
import { AppBuilderLockService } from './app-builder/app-builder-lock.service';
import { AppBuilderWorkflowRepository } from './app-builder/app-builder-workflow.repository';
import { AppBuilderWorkflowStateService } from './app-builder/app-builder-workflow-state.service';
import { SecureWorkspacePathService } from './app-builder/secure-workspace-path.service';
import { GeneratedContentSecurityService } from './app-builder/generated-content-security.service';
import { AppBuilderHarnessMetadataService } from './app-builder/app-builder-harness-metadata.service';
import { AppBuilderHarnessJanitorService } from './app-builder/app-builder-harness-janitor.service';
import { AppBuilderStorageService } from './app-builder/app-builder-storage.service';

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
    PromptsController,
    SelfImprovementController,
    AssistantController,
    ProcessControllerController,
    GatewayController,
    GatewayWorkerController,
    OperatorController,
    AppBuilderController,
    AppBuilderInternalController,
  ],
  providers: [
    RedisService,
    ChatService,
    ChatNluService,
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
    DocumentProcessorService,
    PromptCatalogService,
    SelfImprovementService,
    AssistantService,
    ProcessControllerService,
    GatewayEventsService,
    GatewayControlPlaneService,
    GatewayRoutingService,
    GatewayExecutionService,
    GatewaySubagentService,
    GatewayAutomationService,
    KnowledgeGraphService,
    ReflectionService,
    GatewayPhase3LifecycleService,
    GatewayWorkerMonitorService,
    InternalWorkerAuthService,
    InternalWorkerGuard,
    OperatorService,
    AppBuilderService,
    AppBuilderConfigService,
    AppBuilderLockService,
    AppBuilderWorkflowRepository,
    AppBuilderWorkflowStateService,
    SecureWorkspacePathService,
    GeneratedContentSecurityService,
    AppBuilderHarnessMetadataService,
    AppBuilderHarnessJanitorService,
    AppBuilderStorageService,
    IntentParserService,
    PlannerAiService,
    ArchitectureEngineService,
    FileGraphGeneratorService,
    ContextEngineService,
    CodeGenerationEngineService,
    ValidationEngineService,
    SelfHealingLoopService,
    DeploymentManagerService,
  ],
})
export class AppModule {}
