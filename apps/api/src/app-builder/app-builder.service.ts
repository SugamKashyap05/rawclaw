import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppBuilderApprovalStage,
  AppBuilderAssistantResponse,
  AppBuilderAssistantRequest,
  AppBuilderArtifactKind,
  AppBuilderArtifactRecord,
  AppBuilderApprovalGate,
  AppBuilderAppType,
  AppBuilderBriefDraft,
  AppBuilderComposerLane,
  AppBuilderControlMode,
  AppBuilderConversation,
  AppBuilderIntent,
  AppBuilderManifestRecord,
  AppBuilderMessage,
  AppBuilderMode,
  AppBuilderPhase,
  AppBuilderProject,
  AppBuilderProjectDetail,
  AppBuilderProjectStatus,
  AppBuilderQueueJob,
  AppBuilderRunStatus,
  AppBuilderRun,
  AppBuilderStage,
  AppBuilderSourceType,
  AppBuilderTemplate,
  AppBuilderSuggestedAction,
  AppBuilderPreviewState,
  AppBuilderValidationCheck,
  AppBuilderValidationResult,
  AppBuilderTaskItem,
  AppBuilderTaskList,
  AppBuilderActivityEvent,
  AppBuilderGenerationMode,
  AppBuilderGenerationSnapshot,
  AppBuilderSecurityApproval,
  AppBuilderSecurityScan,
  AppBuilderStagedGeneration,
  AppBuilderContextPackSummary,
  ProjectBibleDocument,
  ProjectMemorySnapshot,
  AppSpecJson,
  ChatAttachment,
  ChatControlState,
  ChatMessage,
  ChatRequest,
  AppRegistryRecord,
  ArchitecturePlan,
  FileGraph,
  GatewayGuardianOutcome,
  HealingAttempt,
  ImportedProjectAdapter,
  PreviewSession,
  RawClawAppEvent,
  RawClawAppManifest,
  RawClawControlCommand,
  RawClawControlResponse,
  TerminalCommandRecord,
  TerminalSessionRecord,
  ValidationSession,
  WorkspaceFileDiff,
  WorkspaceFileEditRequest,
  WorkspaceFileNode,
  WorkspaceFileRecord,
  WorkspaceFileTree,
} from '@rawclaw/shared';
import {
  RAWCLAW_APP_PROTOCOL_VERSION,
  RAWCLAW_APP_SDK_VERSION,
  createAppEvent,
  createCompatibility,
  createControlResponse,
  validateManifest,
} from '@rawclaw/app-sdk';
import { createHash, randomUUID } from 'crypto';
import * as net from 'net';
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { APP_BUILDER_CAPABILITIES, APP_BUILDER_TEMPLATES } from './app-builder.templates';
import { GatewayControlPlaneService } from '../gateway-control-plane.service';
import { GatewayEventsService } from '../gateway-events.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { IntentParserService } from './intent-parser.service';
import { PlannerAiService } from './planner-ai.service';
import { ArchitectureEngineService } from './architecture-engine.service';
import { FileGraphGeneratorService } from './file-graph-generator.service';
import { CodeGenerationEngineService } from './code-generation-engine.service';
import { ValidationEngineService } from './validation-engine.service';
import { SelfHealingLoopService } from './self-healing-loop.service';
import { DeploymentManagerService } from './deployment-manager.service';
import { AppBuilderWorkflowStateService } from './app-builder-workflow-state.service';
import { AppBuilderWorkflowRepository } from './app-builder-workflow.repository';
import { AppBuilderLockService } from './app-builder-lock.service';
import { AppBuilderConfigService } from './app-builder.config.service';
import { SecureWorkspacePathService } from './secure-workspace-path.service';
import { GeneratedContentSecurityService } from './generated-content-security.service';
import { AppBuilderHarnessMetadataService } from './app-builder-harness-metadata.service';
import { AppBuilderStorageService } from './app-builder-storage.service';
import { ChatOrchestratorService } from '../chat-orchestrator.service';
import { ModelsService } from '../models.service';
import { MemoryService } from '../memory.service';
import { DocumentProcessorService } from '../document-processor.service';
import { SAFE_DESTRUCTIVE_NAME_ALLOWLIST } from './destructive-name-allowlist';

type CreateProjectInput = {
  name: string;
  description?: string | null;
  workspaceId?: string | null;
  appType?: AppBuilderProject['appType'];
  sourceType?: AppBuilderProject['sourceType'];
  templateId?: string | null;
  controlMode?: AppBuilderProject['controlMode'];
  requestedPermissions?: string[];
  requestedCapabilities?: string[];
  sourcePath?: string | null;
  metadata?: Record<string, unknown> | null;
};

type BuilderAssistantInput = AppBuilderAssistantRequest;

type ProjectRecord = Awaited<ReturnType<PrismaService['appBuilderProject']['findUnique']>>;
type RunRecord = Awaited<ReturnType<PrismaService['appBuilderRun']['findUnique']>>;
type ManifestRecord = Awaited<ReturnType<PrismaService['appBuilderManifest']['findFirst']>>;
type RegistryRecordModel = Awaited<ReturnType<PrismaService['appRegistryRecord']['findFirst']>>;
type AdapterRecordModel = Awaited<ReturnType<PrismaService['importedProjectAdapter']['findFirst']>>;

type ExecuteQueuedRunResult = {
  summary: string;
  output?: Record<string, unknown> | AppBuilderValidationResult | null;
};

type ArtifactRow = {
  id: string;
  projectId: string;
  runId: string | null;
  kind: string;
  stage: string;
  label: string;
  payloadJson: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type StagedGenerationFileState = {
  path: string;
  hash: string;
  baseHash?: string | null;
  status: 'added' | 'modified' | 'removed' | 'unchanged' | 'conflict' | 'applied' | 'discarded';
};

type StagedGenerationPayload = AppBuilderStagedGeneration & {
  stagingRoot: string;
  parentStagingId?: string | null;
  stale?: boolean;
  retentionExpiresAt?: string | null;
  baseFileHashes: Record<string, string>;
  stagedFileHashes: Record<string, string>;
  files: StagedGenerationFileState[];
  appliedFilePaths: string[];
  discardedFilePaths: string[];
  conflicts: Array<{ path: string; baseHash?: string | null; currentHash?: string | null; stagedHash: string; reason: string }>;
  conflictResolutions?: Array<{ filePath: string; decision: string; resolvedAt: string; linkedStagingId?: string | null; linkedRunId?: string | null }>;
  securityApprovalLineage?: string[];
  referenceInfluence?: Record<string, unknown> | null;
};

type StagedDiffPayload = {
  id: string;
  projectId: string;
  stagingId: string;
  files: WorkspaceFileDiff[];
  unifiedDiff: string;
  summary: string;
  createdAt: string;
};

type ValidationRunOptions = {
  trigger?: NonNullable<ValidationSession['trigger']>;
  validationSnapshotId?: string | null;
  stagingId?: string | null;
};

const DESTRUCTIVE_COMMAND_VERBS = /\b(delete|remove|destroy|wipe|purge|drop)\b/i;
const FORBIDDEN_HANDLER_IMPORTS = new Set(['fs', 'child_process', 'net', 'tls', 'http', 'https', 'process']);

type BuilderStateQueryKind =
  | 'progress'
  | 'projects'
  | 'templates'
  | 'brief'
  | 'failed_runs'
  | 'runs'
  | 'registry'
  | 'preview'
  | 'usage';

type BuilderTurnClassification =
  | { kind: 'state_query'; query: BuilderStateQueryKind }
  | { kind: 'draft_chat' }
  | { kind: 'execution'; phase: AppBuilderPhase | null; approve: boolean };

@Injectable()
export class AppBuilderService implements OnModuleInit {
  private readonly logger = new Logger(AppBuilderService.name);
  private schemaReadyPromise: Promise<void> | null = null;
  private readonly stoppedTerminalCommands = new Set<string>();
  private readonly autoValidationTimers = new Map<string, NodeJS.Timeout>();
  private readonly autoValidationFirstQueuedAt = new Map<string, number>();
  private readonly indexRetryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayControlPlane: GatewayControlPlaneService,
    private readonly gatewayEvents: GatewayEventsService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly modelsService: ModelsService,
    private readonly chatOrchestrator: ChatOrchestratorService,
    private readonly intentParser: IntentParserService,
    private readonly plannerAi: PlannerAiService,
    private readonly architectureEngine: ArchitectureEngineService,
    private readonly fileGraphGenerator: FileGraphGeneratorService,
    private readonly codeGenerationEngine: CodeGenerationEngineService,
    private readonly validationEngine: ValidationEngineService,
    private readonly selfHealingLoop: SelfHealingLoopService,
    private readonly deploymentManager: DeploymentManagerService,
    private readonly appBuilderConfig: AppBuilderConfigService,
    private readonly workflowState: AppBuilderWorkflowStateService,
    private readonly workflowRepo: AppBuilderWorkflowRepository,
    private readonly locks: AppBuilderLockService,
    private readonly securePaths: SecureWorkspacePathService,
    private readonly contentSecurity: GeneratedContentSecurityService,
    private readonly harnessMetadata: AppBuilderHarnessMetadataService,
    private readonly appBuilderStorage: AppBuilderStorageService,
    private readonly memoryService: MemoryService,
    private readonly documentProcessor: DocumentProcessorService,
  ) {}

  private readonly terminalProcesses = new Map<string, ChildProcess>();

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.restorePendingIndexRetries();
  }

  async ensureSchema(): Promise<void> {
    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = this.ensureSchemaInternal().catch((error) => {
        this.schemaReadyPromise = null;
        throw error;
      });
    }
    await this.schemaReadyPromise;
  }

  private async ensureSchemaInternal(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_builder_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT,
        workspaceId TEXT NOT NULL DEFAULT 'default',
        appType TEXT NOT NULL DEFAULT 'web_app',
        sourceType TEXT NOT NULL DEFAULT 'generated',
        templateId TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        controlMode TEXT NOT NULL DEFAULT 'observe_only',
        approvalRequired BOOLEAN NOT NULL DEFAULT 1,
        approvalGranted BOOLEAN NOT NULL DEFAULT 0,
        requestedPermissionsJson TEXT,
        requestedCapabilitiesJson TEXT,
        sourcePath TEXT,
        managedPath TEXT,
        deployPath TEXT,
        exportPath TEXT,
        latestManifestId TEXT,
        latestRunId TEXT,
        metadataJson TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_builder_manifests (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        version TEXT NOT NULL,
        manifestJson TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_builder_runs (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        title TEXT NOT NULL,
        summary TEXT,
        errorMessage TEXT,
        gatewayRunId TEXT,
        queueJobId TEXT,
        workerId TEXT,
        outputJson TEXT,
        startedAt DATETIME,
        finishedAt DATETIME,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_registry_records (
        id TEXT PRIMARY KEY,
        projectId TEXT,
        appId TEXT NOT NULL,
        version TEXT NOT NULL,
        sourceType TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        manifestJson TEXT NOT NULL,
        controlEndpoint TEXT NOT NULL,
        eventStreamEndpoint TEXT NOT NULL,
        deploymentLocation TEXT,
        healthStatus TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS imported_project_adapters (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        adapterType TEXT NOT NULL,
        sourcePath TEXT NOT NULL,
        outputPath TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        warningsJson TEXT,
        metadataJson TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_builder_artifacts (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        runId TEXT,
        kind TEXT NOT NULL,
        stage TEXT NOT NULL,
        label TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_builder_projects_slug ON app_builder_projects(slug)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_projects_workspace_status ON app_builder_projects(workspaceId, status)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_manifests_project_createdAt ON app_builder_manifests(projectId, createdAt)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_runs_project_createdAt ON app_builder_runs(projectId, createdAt)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_runs_gatewayRunId ON app_builder_runs(gatewayRunId)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_registry_records_project_createdAt ON app_registry_records(projectId, createdAt)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_registry_records_appId_status ON app_registry_records(appId, status)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_imported_project_adapters_project_createdAt ON imported_project_adapters(projectId, createdAt)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_artifacts_project_stage ON app_builder_artifacts(projectId, stage, createdAt)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_artifacts_project_kind ON app_builder_artifacts(projectId, kind, createdAt)`);
    await this.appBuilderStorage.ensureSchema();
  }

  private appEventsKey(appId: string): string {
    return `app-builder:app:${appId}:events`;
  }

  private appEventChannel(appId: string): string {
    return `app-builder:events:${appId}`;
  }

  private appStateKey(appId: string): string {
    return `app-builder:app:${appId}:state`;
  }

  private resolveWorkspaceRoot(): string {
    const candidate = path.resolve(__dirname, '..', '..', '..', '..');
    if (existsSync(path.join(candidate, 'README.md'))) {
      return candidate;
    }
    return path.resolve(process.cwd(), '..', '..');
  }

  private dataRoot(): string {
    return path.join(this.resolveWorkspaceRoot(), 'data', 'app-builder');
  }

  private projectsRoot(): string {
    return path.join(this.dataRoot(), 'projects');
  }

  private deploymentsRoot(): string {
    return path.join(this.dataRoot(), 'deployments');
  }

  private exportsRoot(): string {
    return path.join(this.dataRoot(), 'exports');
  }

  private comparablePath(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private isWithinManagedRoot(candidate: string, root: string): boolean {
    const comparableCandidate = this.comparablePath(candidate);
    const comparableRoot = this.comparablePath(root);
    return comparableCandidate === comparableRoot || comparableCandidate.startsWith(`${comparableRoot}${path.sep}`);
  }

  private async deleteManagedAsset(targetPath?: string | null): Promise<void> {
    if (!targetPath?.trim()) {
      return;
    }
    const allowedRoots = [this.projectsRoot(), this.deploymentsRoot(), this.exportsRoot()];
    if (!allowedRoots.some((root) => this.isWithinManagedRoot(targetPath, root))) {
      this.logger.warn(`Skipping deletion for unmanaged project path: ${targetPath}`);
      return;
    }
    await fs.rm(path.resolve(targetPath), { recursive: true, force: true });
  }

  private async ensureDataRoots(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.projectsRoot(), { recursive: true }),
      fs.mkdir(this.deploymentsRoot(), { recursive: true }),
      fs.mkdir(this.exportsRoot(), { recursive: true }),
    ]);
  }

  private projectRoot(project: Pick<AppBuilderProject, 'slug' | 'managedPath'>): string {
    return project.managedPath || path.join(this.projectsRoot(), project.slug);
  }

  private docsRoot(project: Pick<AppBuilderProject, 'slug' | 'managedPath'>): string {
    return path.join(this.projectRoot(project), 'docs');
  }

  private terminalSessionKey(projectId: string): string {
    return `app-builder:terminal:${projectId}`;
  }

  private projectMemoryCollection(projectId: string): string {
    return `app-builder-project:${projectId}`;
  }

  private normalizeWorkspacePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  }

  private async ensureProjectRoot(project: AppBuilderProject): Promise<string> {
    const managedPath = this.projectRoot(project);
    await this.ensureDataRoots();
    await fs.mkdir(managedPath, { recursive: true });
    if (!project.managedPath) {
      await this.prisma.appBuilderProject.update({
        where: { id: project.id },
        data: { managedPath },
      });
      project.managedPath = managedPath;
    }
    return managedPath;
  }

  private async ensureDocsFolder(project: AppBuilderProject): Promise<string> {
    const docsPath = this.docsRoot(project);
    await this.ensureProjectRoot(project);
    await fs.mkdir(docsPath, { recursive: true });
    return docsPath;
  }

  private builderDraftId(input?: string | null): string {
    return input?.trim() || randomUUID();
  }

  private conversationKey(scopeType: 'draft' | 'project', scopeId: string): string {
    return `app-builder:conversation:${scopeType}:${scopeId}`;
  }

  private briefKey(scopeType: 'draft' | 'project', scopeId: string): string {
    return `app-builder:brief:${scopeType}:${scopeId}`;
  }

  private defaultBrief(scopeType: 'draft' | 'project', scopeId: string, brief?: Partial<AppBuilderBriefDraft> | null): AppBuilderBriefDraft {
    return {
      id: `${scopeType}:${scopeId}`,
      draftId: scopeType === 'draft' ? scopeId : null,
      projectId: scopeType === 'project' ? scopeId : null,
      workspaceId: brief?.workspaceId || 'default',
      sourceType: brief?.sourceType || 'generated',
      appType: brief?.appType || 'web_app',
      controlMode: brief?.controlMode || 'assist_only',
      templateId: brief?.templateId || (brief?.appType === 'ai_tool' ? 'ai-tool-web-console' : 'web-dashboard'),
      titleOverride: brief?.titleOverride || null,
      sourcePath: brief?.sourcePath || null,
      prompt: brief?.prompt || null,
      updatedAt: new Date().toISOString(),
    };
  }

  private emptyConversation(scopeType: 'draft' | 'project', scopeId: string, mode: AppBuilderMode, title: string): AppBuilderConversation {
    return {
      id: `${scopeType}:${scopeId}`,
      scopeType,
      scopeId,
      projectId: scopeType === 'project' ? scopeId : null,
      draftId: scopeType === 'draft' ? scopeId : null,
      title,
      mode,
      messages: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private builderMessage(
    role: AppBuilderMessage['role'],
    content: string,
    meta?: string | null,
    tone: AppBuilderMessage['tone'] = 'default',
    extras?: Partial<Pick<AppBuilderMessage, 'attachments' | 'modelId' | 'provenanceSummary' | 'researchSummary' | 'toolSummary'>>,
  ): AppBuilderMessage {
    return {
      id: randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
      meta: meta || null,
      tone,
      attachments: extras?.attachments || undefined,
      modelId: extras?.modelId || null,
      provenanceSummary: extras?.provenanceSummary || null,
      researchSummary: extras?.researchSummary || null,
      toolSummary: extras?.toolSummary || null,
    };
  }

  private stripAnsiSequences(value: string): string {
    return value
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u009b[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u0000/g, '')
      .trim();
  }

  private cleanTerminalChunk(value: string): string {
    return value
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u009b[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u0000/g, '');
  }

  private detectPreviewFromOutput(output: string): { url: string; port: number | null } | null {
    const normalized = this.stripAnsiSequences(output);
    if (!normalized) {
      return null;
    }
    const match = normalized.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)(?:\/[^\s]*)?/i);
    if (!match) {
      return null;
    }
    const url = match[0].replace(/localhost/i, '127.0.0.1');
    const port = Number(match[1]);
    return {
      url,
      port: Number.isFinite(port) ? port : null,
    };
  }

  private maybeBootstrapNodeDependencies(cwd: string, command: string): string {
    const normalized = command.trim();
    if (!/^(npm|pnpm|yarn)\s+/i.test(normalized)) {
      return normalized;
    }
    if (!existsSync(path.join(cwd, 'package.json')) || existsSync(path.join(cwd, 'node_modules'))) {
      return normalized;
    }
    const installCommand = /^pnpm\s+/i.test(normalized)
      ? 'pnpm install'
      : /^yarn\s+/i.test(normalized)
        ? 'yarn install'
        : 'npm install --no-fund --no-audit';
    return `$ErrorActionPreference='Stop'; if (-not (Test-Path 'node_modules')) { ${installCommand} }; ${normalized}`;
  }

  private async appendProjectConversationUpdate(
    projectId: string,
    content: string,
    meta: string,
    tone: AppBuilderMessage['tone'] = 'default',
  ): Promise<void> {
    const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!projectRecord) {
      return;
    }
    await this.appendConversationMessages('project', projectId, 'chat', projectRecord.name, [
      this.builderMessage('assistant', content, meta, tone),
    ]);
  }

  private async killTerminalProcessTree(child: ChildProcess): Promise<void> {
    if (!child.pid) {
      return;
    }
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('close', () => resolve());
        killer.once('error', () => resolve());
      });
      try {
        child.kill();
      } catch {
        // Process may already be gone after taskkill.
      }
      return;
    }
    child.kill('SIGTERM');
  }

  private async isLocalPortListening(port: number): Promise<boolean> {
    if (!Number.isFinite(port) || port <= 0) {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      const done = (value: boolean) => {
        socket.removeAllListeners();
        try {
          socket.destroy();
        } catch {
          // ignore cleanup errors
        }
        resolve(value);
      };
      socket.setTimeout(700);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  private async killProcessListeningOnPort(port: number): Promise<void> {
    if (!Number.isFinite(port) || port <= 0) {
      return;
    }
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const lookup = spawn(
          'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess -First 1`],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
        );
        let output = '';
        lookup.stdout.on('data', (chunk) => {
          output += chunk.toString();
        });
        lookup.once('close', () => {
          const pid = Number(output.trim());
          if (!Number.isFinite(pid) || pid <= 0) {
            resolve();
            return;
          }
          const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.once('close', () => resolve());
          killer.once('error', () => resolve());
        });
        lookup.once('error', () => resolve());
      });
      return;
    }
  }

  private async reconcileTerminalSession(project: AppBuilderProject, session: TerminalSessionRecord): Promise<TerminalSessionRecord> {
    if (session.status !== 'running' || !session.activeCommandId) {
      return session;
    }
    if (this.terminalProcesses.has(session.activeCommandId)) {
      return session;
    }
    const port = typeof session.previewPort === 'number' ? session.previewPort : null;
    const previewStillListening = port && port >= 5275 ? await this.isLocalPortListening(port) : false;
    if (previewStillListening) {
      return session;
    }
    const next: TerminalSessionRecord = {
      ...session,
      status: 'stopped',
      activeCommandId: null,
      previewUrl: null,
      previewPort: null,
      commands: session.commands.map((command) => command.id === session.activeCommandId && command.status === 'running'
        ? {
            ...command,
            status: 'cancelled',
            finishedAt: command.finishedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            previewUrl: null,
          }
        : command),
    };
    await this.patchProjectMetadata(project, {
      previewUrl: null,
      previewPort: null,
      previewSource: null,
      previewUpdatedAt: new Date().toISOString(),
    });
    return this.saveTerminalSession(project.id, next);
  }

  private async buildPhaseWalkthroughMessage(
    projectId: string,
    phase: AppBuilderPhase,
    summary: string,
    requestedPrompt?: string | null,
    output?: Record<string, unknown> | null,
  ): Promise<string> {
    const detail = await this.getProjectDetail(projectId);
    const docsSummary = detail.docs?.length
      ? detail.docs.map((doc) => doc.path).join(', ')
      : 'No docs were recorded yet.';
    const taskCount = detail.taskList?.tasks.length || 0;
    const fileCount = detail.fileTree?.tree?.length || 0;
    const nextAction = this.buildSuggestedActions(detail, 'workspace')[0]?.label || 'Review the workspace';

    if (phase === 'generate' || phase === 'integrate' || phase === 'adapter-generate') {
      const generatedFiles = Array.isArray(output?.generatedFiles) ? output?.generatedFiles.length : null;
      return [
        requestedPrompt ? `Asked: ${requestedPrompt}` : null,
        `${summary}`,
        `Managed repo: ${detail.project.managedPath || 'Pending'}`,
        generatedFiles !== null ? `Generated files: ${generatedFiles}` : `Workspace entries: ${fileCount}`,
        `Project bible: ${docsSummary}`,
        taskCount ? `Tracked tasks: ${taskCount}` : 'Task list is still being prepared.',
        `Next step: ${nextAction}.`,
      ].filter(Boolean).join('\n');
    }

    if (phase === 'validate') {
      const attempts = typeof output?.session === 'object' && output?.session && 'attempts' in output.session
        ? Number((output.session as any).attempts || 0)
        : null;
      const healingAttempts = Array.isArray(output?.healingAttempts) ? output.healingAttempts.length : 0;
      return [
        requestedPrompt ? `Asked: ${requestedPrompt}` : null,
        `${summary}`,
        attempts ? `Validation attempts: ${attempts}` : 'Validation finished.',
        healingAttempts ? `Self-healing retries: ${healingAttempts}` : 'No healing retries were needed.',
        `Next step: ${nextAction}.`,
      ].filter(Boolean).join('\n');
    }

    if (phase === 'deploy') {
      return [
        requestedPrompt ? `Asked: ${requestedPrompt}` : null,
        `${summary}`,
        `Preview target: ${detail.previewConnection?.url || detail.project.deployPath || 'Pending preview URL'}`,
        `Next step: ${nextAction}.`,
      ].filter(Boolean).join('\n');
    }

    if (phase === 'register') {
      const latestRegistry = detail.registryRecords[0];
      return [
        requestedPrompt ? `Asked: ${requestedPrompt}` : null,
        `${summary}`,
        latestRegistry ? `Control endpoint: ${latestRegistry.controlEndpoint}` : 'Registry record not found yet.',
        `Event stream: ${latestRegistry?.eventStreamEndpoint || 'Pending'}`,
        `Next step: ${nextAction}.`,
      ].filter(Boolean).join('\n');
    }

    return [
      requestedPrompt ? `Asked: ${requestedPrompt}` : null,
      summary,
      `Project bible: ${docsSummary}`,
      taskCount ? `Tracked tasks: ${taskCount}` : 'Task list is still being prepared.',
      `Next step: ${nextAction}.`,
    ].filter(Boolean).join('\n');
  }

  private templateFor(project: { templateId?: string | null; appType: AppBuilderProject['appType']; sourceType: AppBuilderProject['sourceType'] }): AppBuilderTemplate {
    const explicit = project.templateId
      ? APP_BUILDER_TEMPLATES.find((template) => template.id === project.templateId)
      : null;
    if (explicit) {
      return explicit;
    }
    if (project.sourceType === 'imported') {
      return APP_BUILDER_TEMPLATES.find((template) => template.id === 'external-project-adapter')!;
    }
    if (project.appType === 'ai_tool') {
      return APP_BUILDER_TEMPLATES.find((template) => template.id === 'ai-tool-web-console')!;
    }
    return APP_BUILDER_TEMPLATES.find((template) => template.id === 'web-dashboard')!;
  }

  private pickTemplateForType(
    appType: AppBuilderAppType,
    preferredId?: string | null,
  ): AppBuilderTemplate {
    const candidates = APP_BUILDER_TEMPLATES.filter((template) => template.id !== 'external-project-adapter' && template.appType === appType);
    return candidates.find((template) => template.id === preferredId) || candidates[0] || APP_BUILDER_TEMPLATES[0]!;
  }

  private resolveSourceType(prompt: string, fallback: AppBuilderSourceType, sourcePath?: string | null): AppBuilderSourceType {
    if (fallback === 'imported') return 'imported';
    if (sourcePath?.trim()) return 'imported';
    if (/\bimport\b|\badapt\b|\bwrap\b/i.test(prompt)) return 'imported';
    return 'generated';
  }

  private inferAppType(prompt: string, fallback: AppBuilderAppType): AppBuilderAppType {
    if (/\bai tool\b|\bagent console\b|\bprompt\b|\beval\b|\bworkflow\b/i.test(prompt)) {
      return 'ai_tool';
    }
    if (/\bdashboard\b|\bportal\b|\bcrud\b|\bweb\b/i.test(prompt)) {
      return 'web_app';
    }
    return fallback;
  }

  private inferControlMode(prompt: string, fallback: AppBuilderControlMode): AppBuilderControlMode {
    if (/\bfull control\b|\bautonomous\b/i.test(prompt)) return 'full_control';
    if (/\baction limited\b|\blimited control\b/i.test(prompt)) return 'action_limited';
    if (/\bobserve only\b|\bread only\b/i.test(prompt)) return 'observe_only';
    if (/\bassist only\b/i.test(prompt)) return 'assist_only';
    return fallback;
  }

  private inferTemplateId(prompt: string, appType: AppBuilderAppType, fallback?: string | null): string {
    const lower = prompt.toLowerCase();
    const candidates = APP_BUILDER_TEMPLATES.filter((template) => template.id !== 'external-project-adapter' && template.appType === appType);
    if (lower.includes('crud')) {
      return candidates.find((template) => template.id === 'web-crud-app')?.id || fallback || candidates[0]?.id || 'web-crud-app';
    }
    if (lower.includes('dashboard')) {
      return candidates.find((template) => template.id === 'web-dashboard')?.id || fallback || candidates[0]?.id || 'web-dashboard';
    }
    if (lower.includes('console') || lower.includes('tool')) {
      return candidates.find((template) => template.id === 'ai-tool-web-console')?.id || fallback || candidates[0]?.id || 'ai-tool-web-console';
    }
    return candidates.find((template) => template.id === fallback)?.id || candidates[0]?.id || fallback || 'web-dashboard';
  }

  private inferSourcePath(prompt: string): string | null {
    const windowsPathMatch = prompt.match(/[A-Za-z]:\\[^\n"]+/);
    return windowsPathMatch ? windowsPathMatch[0].trim() : null;
  }

  private inferProjectName(prompt: string, sourceType: AppBuilderSourceType, appType: AppBuilderAppType): string {
    const cleaned = prompt
      .replace(/\b(build|create|generate|make|please|import|adapt|project|app|tool|for|me|rawclaw|with)\b/gi, ' ')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleaned.split(' ').filter(Boolean);
    const title = words
      .slice(0, 4)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    if (title) return title;
    return sourceType === 'imported'
      ? 'Imported RawClaw App'
      : appType === 'ai_tool'
        ? 'New AI Tool Console'
        : 'New Web App';
  }

  private inferPhaseIntent(prompt: string): AppBuilderPhase | null {
    const mapping: Array<{ phase: AppBuilderPhase; patterns: RegExp[] }> = [
      { phase: 'rollback', patterns: [/\brollback\b/i, /\brestore\b/i, /\brevert\b/i] },
      { phase: 'control-test', patterns: [/\bcontrol test\b/i, /\bsdk test\b/i, /\btest control\b/i, /\bend to end\b/i] },
      { phase: 'register', patterns: [/\bregister\b/i, /\bpublish to rawclaw\b/i, /\badd to rawclaw\b/i] },
      { phase: 'deploy', patterns: [/\bdeploy\b/i, /\blaunch\b/i, /\bship\b/i] },
      { phase: 'validate', patterns: [/\bvalidate\b/i, /\brun checks\b/i, /\btest build\b/i] },
      { phase: 'integrate', patterns: [/\bintegrat/i, /\bwire\b/i, /\bconnect sdk\b/i] },
      { phase: 'generate', patterns: [/\bgenerate\b/i, /\bscaffold\b/i, /\bbuild first version\b/i] },
      { phase: 'plan', patterns: [/\bplan\b/i, /\barchitecture\b/i, /\bspec\b/i, /\bbrief\b/i] },
      { phase: 'export', patterns: [/\bexport\b/i, /\bdownload repo\b/i, /\bbundle\b/i] },
    ];
    for (const item of mapping) {
      if (item.patterns.some((pattern) => pattern.test(prompt))) {
        return item.phase;
      }
    }
    return null;
  }

  private shouldStartDraftExecution(prompt: string): { shouldStart: boolean; phase: AppBuilderPhase | null } {
    const normalized = prompt.trim().replace(/\s+/g, ' ');
    const phaseIntent = this.inferPhaseIntent(normalized);
    const wordCount = normalized.split(' ').filter(Boolean).length;

    if (/^(start|go ahead|proceed|begin|kick off|open the project|create (the )?project|start build|start working|work on it|ship it now)\b/i.test(normalized)) {
      return { shouldStart: true, phase: phaseIntent };
    }

    if (phaseIntent && wordCount <= 16) {
      return { shouldStart: true, phase: phaseIntent };
    }

    return { shouldStart: false, phase: null };
  }

  private assessDraftReadiness(input: {
    prompt: string;
    sourceType: AppBuilderSourceType;
    appType: AppBuilderAppType;
    controlMode: AppBuilderControlMode;
    templateId: string;
    sourcePath?: string | null;
    intent: AppBuilderIntent;
  }): { ready: boolean; followUps: string[] } {
    if (input.sourceType === 'imported') {
      if (!input.sourcePath?.trim()) {
        return {
          ready: false,
          followUps: ['Tell me the local source path for the project you want RawClaw to wrap.'],
        };
      }
      return { ready: true, followUps: [] };
    }

    const compactPrompt = input.prompt.replace(/\s+/g, ' ').trim();
    const wordCount = compactPrompt.split(' ').filter(Boolean).length;
    const hasStrongDomain = input.intent.domain !== 'generic_web';
    const hasFeatureSignals =
      input.intent.requestedFeatures.length >= 2 || /\bwith\b|\binclude\b|\bsupport\b|\bneed\b|\brequirements?\b/i.test(compactPrompt);
    const isTooVague =
      /^(app|new app|build an app|make an app|website|web app|tool|dashboard)$/i.test(compactPrompt) ||
      (!hasStrongDomain && !hasFeatureSignals && wordCount < 8);

    if (!isTooVague) {
      return { ready: true, followUps: [] };
    }

    return {
      ready: false,
      followUps: [
        'What kind of app should this be, and who is it for?',
        'What are the 2-4 key screens or workflows it must support?',
        'Should RawClaw keep it observe only, assist only, action limited, or full control?',
      ],
    };
  }

  private summarizeDraftReadiness(input: {
    projectName: string;
    sourceType: AppBuilderSourceType;
    appType: AppBuilderAppType;
    controlMode: AppBuilderControlMode;
    template?: AppBuilderTemplate | null;
    sourcePath?: string | null;
    intent: AppBuilderIntent;
  }): string {
    const featureSummary = input.intent.requestedFeatures.length
      ? input.intent.requestedFeatures.slice(0, 6).join(', ')
      : 'feature list will be refined in chat';
    const controlSummary = input.intent.controlActions.length
      ? input.intent.controlActions.slice(0, 6).join(', ')
      : 'SDK actions will be inferred during planning';

    return [
      `I have enough to start, but I’m keeping us in briefing mode until you tell me to begin the build pipeline.`,
      '',
      'Current builder brief:',
      `- project: ${input.projectName}`,
      `- source: ${input.sourceType === 'generated' ? 'generated app' : `imported project from ${input.sourcePath}`}`,
      `- app type: ${input.appType.replace('_', ' ')}`,
      `- template: ${input.template ? `${input.template.name} (${input.template.starterStack})` : 'external project adapter'}`,
      `- control mode: ${input.controlMode.replace(/_/g, ' ')}`,
      `- feature direction: ${featureSummary}`,
      `- RawClaw actions: ${controlSummary}`,
      '',
      `Keep refining the brief here, or say "create a plan", "start build", or "generate the first version" when you want me to open the project and start work.`,
    ].join('\n');
  }

  private summarizeDraftClarification(input: {
    sourceType: AppBuilderSourceType;
    appType: AppBuilderAppType;
    controlMode: AppBuilderControlMode;
    template?: AppBuilderTemplate | null;
    followUps: string[];
  }): string {
    return [
      `I’m still shaping the builder brief before I create project artifacts or queue any build phases.`,
      '',
      'What I have so far:',
      `- source: ${input.sourceType === 'generated' ? 'generated app' : 'imported project'}`,
      `- app type: ${input.appType.replace('_', ' ')}`,
      `- template: ${input.template ? input.template.name : 'external project adapter'}`,
      `- control mode: ${input.controlMode.replace(/_/g, ' ')}`,
      '',
      'I still need:',
      ...input.followUps.map((item) => `- ${item}`),
      '',
      `Once that is clear, I’ll stay in chat until you tell me to start with "create a plan" or "start build".`,
    ].join('\n');
  }

  private mergeProjectDescription(current: string | null | undefined, prompt: string): string {
    if (!current) return prompt;
    return `${current}\n\nRefinement:\n${prompt}`;
  }

  private briefFingerprint(value: string | null | undefined): string {
    const normalized = (value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }

  private isBuildPhase(phase: AppBuilderPhase | null | undefined): boolean {
    return phase === 'generate' || phase === 'integrate' || phase === 'adapter-generate';
  }

  private planApprovalIssue(project: AppBuilderProject, briefPrompt: string | null | undefined): string | null {
    const metadata = project.metadata || {};
    const planApprovedAt = typeof metadata.planApprovedAt === 'string' ? metadata.planApprovedAt : null;
    const approvedFingerprint = typeof metadata.planApprovedBriefFingerprint === 'string'
      ? metadata.planApprovedBriefFingerprint
      : null;
    const currentFingerprint = this.briefFingerprint(briefPrompt || project.description || project.name);
    if (!planApprovedAt || !approvedFingerprint) {
      return 'Build needs an approved Plan first. I will create or refresh the Plan and stop for review instead of generating files.';
    }
    if (approvedFingerprint !== currentFingerprint) {
      return 'The brief changed after the Plan was approved, so Build is blocked until the updated Plan is reviewed.';
    }
    return null;
  }

  private buildPlanGateMessage(projectName: string, issue: string, planSummary?: string | null): string {
    return [
      issue,
      planSummary || `Planner output is ready for ${projectName}.`,
      'Review the Plan in Activity or Docs, then approve it before Build can write app files.',
    ].join('\n');
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `app-${randomUUID().slice(0, 8)}`;
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = this.slugify(base);
    let counter = 1;
    while (await this.prisma.appBuilderProject.findUnique({ where: { slug: candidate } })) {
      counter += 1;
      candidate = `${this.slugify(base)}-${counter}`;
    }
    return candidate;
  }

  private parseJson<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) {
      return fallback;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private parseManifestJson(raw: string | null | undefined): RawClawAppManifest | null {
    return this.parseJson<RawClawAppManifest | null>(raw, null);
  }

  private toIsoDate(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toArtifact(record: ArtifactRow): AppBuilderArtifactRecord {
    return {
      id: record.id,
      projectId: record.projectId,
      runId: record.runId,
      kind: record.kind as AppBuilderArtifactKind,
      stage: record.stage as AppBuilderStage,
      label: record.label,
      payload: this.parseJson(record.payloadJson, {}),
      createdAt: this.toIsoDate(record.createdAt),
      updatedAt: this.toIsoDate(record.updatedAt),
    };
  }

  private async listArtifacts(projectId: string, limit = 30): Promise<AppBuilderArtifactRecord[]> {
    const records = await this.prisma.$queryRawUnsafe<ArtifactRow[]>(
      `SELECT id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt
         FROM app_builder_artifacts
        WHERE projectId = ?
        ORDER BY createdAt DESC
        LIMIT ?`,
      projectId,
      limit,
    );
    return records.map((record) => this.toArtifact(record));
  }

  private async latestArtifact<T>(projectId: string, kind: AppBuilderArtifactKind): Promise<T | null> {
    const records = await this.prisma.$queryRawUnsafe<ArtifactRow[]>(
      `SELECT id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt
         FROM app_builder_artifacts
        WHERE projectId = ? AND kind = ?
        ORDER BY createdAt DESC
        LIMIT 1`,
      projectId,
      kind,
    );
    if (!records.length) {
      return null;
    }
    return this.toArtifact(records[0]).payload as T;
  }

  private async storeArtifact(
    projectId: string,
    runId: string | null,
    kind: AppBuilderArtifactKind,
    stage: AppBuilderStage,
    label: string,
    payload: unknown,
  ): Promise<AppBuilderArtifactRecord> {
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO app_builder_artifacts (id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      projectId,
      runId,
      kind,
      stage,
      label,
      JSON.stringify(payload),
    );
    const [record] = await this.prisma.$queryRawUnsafe<ArtifactRow[]>(
      `SELECT id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt
         FROM app_builder_artifacts
        WHERE id = ?`,
      id,
    );
    return this.toArtifact(record);
  }

  private async listArtifactsByKind<T>(projectId: string, kind: AppBuilderArtifactKind, limit = 20): Promise<T[]> {
    const records = await this.prisma.$queryRawUnsafe<ArtifactRow[]>(
      `SELECT id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt
         FROM app_builder_artifacts
        WHERE projectId = ? AND kind = ?
        ORDER BY createdAt DESC
        LIMIT ?`,
      projectId,
      kind,
      limit,
    );
    return records.map((record) => this.toArtifact(record).payload as T);
  }

  private async listArtifactRecordsByKind(projectId: string, kind: AppBuilderArtifactKind, limit = 50): Promise<AppBuilderArtifactRecord[]> {
    const records = await this.prisma.$queryRawUnsafe<ArtifactRow[]>(
      `SELECT id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt
         FROM app_builder_artifacts
        WHERE projectId = ? AND kind = ?
        ORDER BY createdAt DESC
        LIMIT ?`,
      projectId,
      kind,
      limit,
    );
    return records.map((record) => this.toArtifact(record));
  }

  private async updateArtifactPayload(artifactId: string, payload: unknown): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE app_builder_artifacts
          SET payloadJson = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?`,
      JSON.stringify(payload),
      artifactId,
    );
  }

  private async recordActivity(
    projectId: string,
    input: Omit<AppBuilderActivityEvent, 'id' | 'projectId' | 'createdAt'>,
  ): Promise<AppBuilderActivityEvent> {
    const event: AppBuilderActivityEvent = {
      id: randomUUID(),
      projectId,
      runId: input.runId || null,
      phase: input.phase || null,
      lane: input.lane || null,
      kind: input.kind,
      status: input.status,
      title: input.title,
      summary: input.summary,
      modelId: input.modelId || null,
      filePath: input.filePath || null,
      metadata: input.metadata || null,
      createdAt: new Date().toISOString(),
    };
    await this.storeArtifact(projectId, event.runId || null, 'activity', 'activity', event.title, event);
    return event;
  }

  private async loadConversation(
    scopeType: 'draft' | 'project',
    scopeId: string,
    mode: AppBuilderMode,
    title: string,
  ): Promise<AppBuilderConversation> {
    const existing = await this.redis.getJson<AppBuilderConversation>(this.conversationKey(scopeType, scopeId));
    if (existing) {
      return existing;
    }
    const created = this.emptyConversation(scopeType, scopeId, mode, title);
    await this.redis.setJson(this.conversationKey(scopeType, scopeId), created);
    return created;
  }

  private async saveConversation(conversation: AppBuilderConversation): Promise<void> {
    await this.redis.setJson(this.conversationKey(conversation.scopeType, conversation.scopeId), {
      ...conversation,
      updatedAt: new Date().toISOString(),
    });
  }

  private async appendConversationMessages(
    scopeType: 'draft' | 'project',
    scopeId: string,
    mode: AppBuilderMode,
    title: string,
    messages: AppBuilderMessage[],
  ): Promise<AppBuilderConversation> {
    const current = await this.loadConversation(scopeType, scopeId, mode, title);
    const next: AppBuilderConversation = {
      ...current,
      title,
      mode,
      updatedAt: new Date().toISOString(),
      messages: [...current.messages, ...messages],
    };
    await this.saveConversation(next);
    return next;
  }

  private async loadBrief(
    scopeType: 'draft' | 'project',
    scopeId: string,
    defaults?: Partial<AppBuilderBriefDraft> | null,
  ): Promise<AppBuilderBriefDraft> {
    const existing = await this.redis.getJson<AppBuilderBriefDraft>(this.briefKey(scopeType, scopeId));
    if (existing) {
      return existing;
    }
    const created = this.defaultBrief(scopeType, scopeId, defaults);
    await this.redis.setJson(this.briefKey(scopeType, scopeId), created);
    return created;
  }

  private async saveBrief(scopeType: 'draft' | 'project', scopeId: string, brief: AppBuilderBriefDraft): Promise<AppBuilderBriefDraft> {
    const next = {
      ...brief,
      id: `${scopeType}:${scopeId}`,
      draftId: scopeType === 'draft' ? scopeId : null,
      projectId: scopeType === 'project' ? scopeId : null,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.briefKey(scopeType, scopeId), next);
    return next;
  }

  private readonly allowedWorkspaceExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.scss', '.html', '.yml', '.yaml',
  ]);

  private readonly excludedWorkspaceDirs = new Set([
    'node_modules', '.git', 'dist', 'build', '__pycache__', '.pytest_cache', 'coverage', '.next',
  ]);

  private docsBlueprint(project: AppBuilderProject, brief: AppBuilderBriefDraft, taskList: AppBuilderTaskList, spec?: AppSpecJson | null, architecture?: ArchitecturePlan | null, memorySummary?: string | null): Record<string, string> {
    const taskLines = taskList.tasks.map((task) => {
      const marker = task.status === 'completed' ? 'x' : task.status === 'in_progress' ? '>' : task.status === 'blocked' ? '!' : ' ';
      const detail = task.detail ? `\n  - ${task.detail}` : '';
      return `- [${marker}] ${task.title}${detail}`;
    }).join('\n');

    return {
      'PROJECT_BRIEF.md': [
        `# ${project.name} Project Brief`,
        '',
        `- Source: ${brief.sourceType}`,
        `- App type: ${brief.appType}`,
        `- Control mode: ${brief.controlMode}`,
        `- Template: ${brief.templateId || 'auto'}`,
        `- Workspace: ${brief.workspaceId}`,
        '',
        '## Prompt',
        '',
        brief.prompt || project.description || 'Prompt not captured yet.',
      ].join('\n'),
      'PLAN.md': [
        `# ${project.name} Plan`,
        '',
        spec?.summary || project.description || 'Plan is being prepared.',
        '',
        '## Features',
        ...(spec?.features?.length ? spec.features.map((feature) => `- ${feature}`) : ['- Features will be filled by the planner.']),
        '',
        '## Architecture',
        architecture
          ? `- Framework: ${architecture.framework}\n- Build: ${architecture.buildTool}\n- SDK transport: ${architecture.sdkTransport}`
          : '- Architecture will be added after planning.',
      ].join('\n'),
      'TASKS.md': [
        `# ${project.name} Tasks`,
        '',
        taskLines || '- [ ] Tasks will appear here once the planner decomposes the work.',
      ].join('\n'),
      'DECISIONS.md': [
        `# ${project.name} Decisions`,
        '',
        `- Current status: ${project.status}`,
        `- Control mode: ${project.controlMode}`,
        `- Template: ${project.templateId || 'auto'}`,
        architecture ? `- Build stack: ${architecture.framework} / ${architecture.buildTool} / ${architecture.language}` : '- Build stack pending planner review.',
      ].join('\n'),
      'AGENT_MEMORY.md': [
        `# ${project.name} Agent Memory`,
        '',
        memorySummary || 'High-signal agent memory will be summarized here as work progresses.',
      ].join('\n'),
      'STATUS.md': [
        `# ${project.name} Status`,
        '',
        `- Project status: ${project.status}`,
        `- Approval required: ${project.approvalRequired ? 'yes' : 'no'}`,
        `- Approval granted: ${project.approvalGranted ? 'yes' : 'no'}`,
        `- Updated at: ${new Date().toISOString()}`,
      ].join('\n'),
    };
  }

  private initialTaskList(project: AppBuilderProject, spec?: AppSpecJson | null): AppBuilderTaskList {
    const now = new Date().toISOString();
    const featureTasks = (spec?.features || []).slice(0, 6).map((feature, index) => ({
      id: `feature-${index + 1}`,
      title: `Implement ${feature}`,
      detail: `Generated from planner feature list for ${project.name}.`,
      status: 'pending' as const,
      phase: 'generate' as const,
      owner: 'builder' as const,
      source: 'plan' as const,
      createdAt: now,
      updatedAt: now,
    }));
    return {
      projectId: project.id,
      updatedAt: now,
      tasks: [
        {
          id: 'plan-review',
          title: 'Review and approve the planner output',
          detail: 'Confirm project scope, architecture, and generated docs before build starts.',
          status: 'in_progress',
          phase: 'plan',
          owner: 'planner',
          source: 'plan',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'workspace-bootstrap',
          title: 'Scaffold project docs and workspace metadata',
          detail: 'Create the docs folder, brief, plan, task list, and memory shell.',
          status: 'completed',
          phase: 'plan',
          owner: 'system',
          source: 'plan',
          createdAt: now,
          updatedAt: now,
        },
        ...featureTasks,
        {
          id: 'validate-build',
          title: 'Run validation and heal failing files',
          detail: 'Typecheck, build, and recover from failed generated files.',
          status: 'pending',
          phase: 'validate',
          owner: 'validator',
          source: 'validation',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'preview-register',
          title: 'Start preview, deploy, and register control surfaces',
          detail: 'Launch preview, check health, then register the app in RawClaw.',
          status: 'pending',
          phase: 'deploy',
          owner: 'builder',
          source: 'deploy',
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
  }

  private updateTaskStatuses(taskList: AppBuilderTaskList, updates: Array<{ id: string; status: AppBuilderTaskItem['status']; detail?: string | null }>): AppBuilderTaskList {
    const updatedAt = new Date().toISOString();
    const patch = new Map(updates.map((entry) => [entry.id, entry]));
    return {
      ...taskList,
      updatedAt,
      tasks: taskList.tasks.map((task) => {
        const next = patch.get(task.id);
        if (!next) return task;
        return {
          ...task,
          status: next.status,
          detail: next.detail === undefined ? task.detail : next.detail,
          updatedAt,
        };
      }),
    };
  }

  private async captureProjectMemory(project: AppBuilderProject, summary: string, tags: string[]): Promise<ProjectMemorySnapshot> {
    await this.memoryService.add({
      content: summary,
      tags,
      source: `app-builder:${project.id}`,
      collection: this.projectMemoryCollection(project.id),
    });
    return this.buildProjectMemorySnapshot(project);
  }

  private async buildProjectMemorySnapshot(project: AppBuilderProject): Promise<ProjectMemorySnapshot> {
    const entries = await this.memoryService.listEntries({ collection: this.projectMemoryCollection(project.id), limit: 8 });
    return {
      projectId: project.id,
      collection: this.projectMemoryCollection(project.id),
      latestSummary: entries[0]?.content || null,
      entries: entries.map((entry) => ({
        id: entry.id,
        preview: entry.content.length > 220 ? `${entry.content.slice(0, 217)}...` : entry.content,
        tags: entry.tags,
        updatedAt: entry.updatedAt,
      })),
      agentMemoryPath: path.join(this.docsRoot(project), 'AGENT_MEMORY.md'),
      updatedAt: new Date().toISOString(),
    };
  }

  private async writeProjectDocs(
    project: AppBuilderProject,
    brief: AppBuilderBriefDraft,
    taskList: AppBuilderTaskList,
    spec?: AppSpecJson | null,
    architecture?: ArchitecturePlan | null,
    memorySnapshot?: ProjectMemorySnapshot | null,
  ): Promise<ProjectBibleDocument[]> {
    const docsPath = await this.ensureDocsFolder(project);
    const files = this.docsBlueprint(project, brief, taskList, spec, architecture, memorySnapshot?.latestSummary || null);
    const updatedAt = new Date().toISOString();
    const docs: ProjectBibleDocument[] = [];

    for (const [name, content] of Object.entries(files)) {
      const fullPath = path.join(docsPath, name);
      await this.writeFile(fullPath, content);
      docs.push({
        id: `${project.id}:${name}`,
        path: `docs/${name}`,
        title: name.replace(/\.md$/i, '').replace(/_/g, ' '),
        summary: content.split('\n').slice(0, 3).join(' ').trim(),
        updatedAt,
      });
    }

    await this.storeArtifact(project.id, null, 'project_bible', 'docs', 'Project bible documents', {
      updatedAt,
      docs,
    });
    await this.storeArtifact(project.id, null, 'task_list', 'tasking', 'Project task list', taskList);
    if (memorySnapshot) {
      await this.storeArtifact(project.id, null, 'memory_snapshot', 'memory', 'Project memory snapshot', memorySnapshot);
    }
    return docs;
  }

  private safeProjectPath(project: AppBuilderProject, relPath?: string | null): string {
    const root = this.projectRoot(project);
    const normalized = this.normalizeWorkspacePath(relPath || '');
    return this.securePaths.resolveInside(root, normalized);
  }

  private async buildProjectFileTreeRecursive(root: string, current: string, depth = 0): Promise<WorkspaceFileNode[]> {
    if (depth > 8) return [];
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return [];
    }

    const nodes: WorkspaceFileNode[] = [];
    for (const entry of entries) {
      const entryName = String(entry.name);
      if (entryName.startsWith('.') || this.excludedWorkspaceDirs.has(entryName)) {
        continue;
      }
      const fullPath = path.join(current, entryName);
      const relPath = this.normalizeWorkspacePath(path.relative(root, fullPath));
      if (entry.isDirectory()) {
        const children = await this.buildProjectFileTreeRecursive(root, fullPath, depth + 1);
        nodes.push({
          name: entryName,
          path: relPath,
          type: 'directory',
          children,
        });
      } else if (entry.isFile()) {
        const extension = path.extname(entryName).toLowerCase();
        if (!extension || this.allowedWorkspaceExtensions.has(extension)) {
          nodes.push({
            name: entryName,
            path: relPath,
            type: 'file',
          });
        }
      }
    }

    return nodes.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  }

  private languageForPath(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    if (['.ts', '.tsx'].includes(ext)) return 'typescript';
    if (['.js', '.jsx'].includes(ext)) return 'javascript';
    if (ext === '.json') return 'json';
    if (ext === '.md') return 'markdown';
    if (ext === '.css' || ext === '.scss') return 'css';
    if (ext === '.html') return 'html';
    if (ext === '.yml' || ext === '.yaml') return 'yaml';
    if (ext === '.txt') return 'text';
    return null;
  }

  private async findStagedGenerationRecord(projectId: string, stagingId: string): Promise<AppBuilderArtifactRecord> {
    const records = await this.listArtifactRecordsByKind(projectId, 'staged_generation', 100);
    const record = records.find((entry) => (entry.payload as unknown as Partial<StagedGenerationPayload>).id === stagingId);
    if (!record) {
      throw new NotFoundException(`Staged generation ${stagingId} not found.`);
    }
    return record;
  }

  private async findStagedDiff(projectId: string, stagingId: string): Promise<StagedDiffPayload> {
    const records = await this.listArtifactRecordsByKind(projectId, 'staged_diff', 100);
    const record = records.find((entry) => (entry.payload as unknown as Partial<StagedDiffPayload>).stagingId === stagingId);
    if (!record) {
      throw new NotFoundException(`Staged diff for ${stagingId} not found.`);
    }
    return record.payload as unknown as StagedDiffPayload;
  }

  private async pendingSecurityFindings(
    projectId: string,
    stagingId: string,
    filePaths: string[],
  ): Promise<Array<{ path: string; baseHash?: string | null; currentHash?: string | null; stagedHash: string; reason: string }>> {
    const scans = await this.listArtifactsByKind<AppBuilderSecurityScan>(projectId, 'security_scan', 100);
    const scan = scans.find((entry) => entry.stagingId === stagingId);
    if (!scan?.findings?.length) return [];
    const approvals = await this.listArtifactsByKind<AppBuilderSecurityApproval>(projectId, 'security_approval', 200);
    const lineage = await this.securityApprovalLineage(projectId, stagingId);
    const approvedKeys = new Set(
      approvals
        .filter((approval) => lineage.has(approval.stagingId) && approval.decision === 'approved')
        .map((approval) => `${approval.stagingId}:${this.normalizeWorkspacePath(approval.filePath)}:${approval.fileHash}:${approval.patternId}`),
    );
    const selected = new Set(filePaths);
    return scan.findings
      .filter((finding) => selected.has(this.normalizeWorkspacePath(finding.filePath)))
      .filter((finding) => {
        if (finding.status === 'blocked') return true;
        if (finding.status !== 'needs_approval') return false;
        return ![...lineage].some((lineageStagingId) => approvedKeys.has(`${lineageStagingId}:${this.normalizeWorkspacePath(finding.filePath)}:${finding.fileHash || ''}:${finding.patternId}`));
      })
      .map((finding) => ({
        path: this.normalizeWorkspacePath(finding.filePath),
        baseHash: null,
        currentHash: null,
        stagedHash: finding.fileHash || '',
        reason: finding.status === 'blocked'
          ? `Blocked by security scan: ${finding.summary}`
          : `Security approval required: ${finding.summary}`,
      }));
  }

  private async securityApprovalLineage(projectId: string, stagingId: string): Promise<Set<string>> {
    const records = await this.listArtifactRecordsByKind(projectId, 'staged_generation', 100);
    const byStagingId = new Map<string, StagedGenerationPayload>();
    for (const record of records) {
      const payload = record.payload as unknown as StagedGenerationPayload;
      byStagingId.set(payload.id, payload);
    }
    const lineage = new Set<string>([stagingId]);
    let current = byStagingId.get(stagingId);
    for (let depth = 0; depth < 5 && current?.parentStagingId; depth += 1) {
      lineage.add(current.parentStagingId);
      current = byStagingId.get(current.parentStagingId);
    }
    return lineage;
  }

  private async pruneProjectSnapshots(project: AppBuilderProject, managedPath: string, extraProtected: string[] = []): Promise<void> {
    const metadata = project.metadata || {};
    const stagedRecords = await this.listArtifactsByKind<StagedGenerationPayload>(project.id, 'staged_generation', 50).catch(() => []);
    const protectedSnapshotIds = new Set<string>(extraProtected.filter(Boolean));
    for (const key of ['latestAppliedSnapshotId', 'latestValidationSnapshotId', 'latestStagingBaseSnapshotId', 'lastStableSnapshotId', 'operationBaseSnapshotId', 'initialSnapshotId']) {
      const value = metadata[key];
      if (typeof value === 'string' && value.trim()) protectedSnapshotIds.add(value);
    }
    for (const staged of stagedRecords) {
      if (['open', 'partially_applied', 'conflict'].includes(staged.status)) {
        protectedSnapshotIds.add(staged.baseSnapshotId);
      }
    }
    const result = await this.appBuilderStorage.pruneSnapshots({
      workspaceRoot: managedPath,
      workspaceId: project.workspaceId || 'default',
      keepLatest: this.appBuilderConfig.values.snapshotKeepLatest,
      olderThanDays: this.appBuilderConfig.values.snapshotPruneUnreferencedDays,
      protectedSnapshotIds: [...protectedSnapshotIds],
    });
    if (result.deletedSnapshots.length || result.deletedBlobs.length) {
      await this.recordActivity(project.id, {
        kind: 'system',
        status: 'info',
        title: 'Snapshot storage pruned',
        summary: `Pruned ${result.deletedSnapshots.length} snapshots and ${result.deletedBlobs.length} unreferenced blobs.`,
        metadata: result,
      });
    }
  }

  private buildLineDiff(filePath: string, previousContent: string | null, currentContent: string | null): WorkspaceFileDiff {
    const before = (previousContent || '').split(/\r?\n/);
    const after = (currentContent || '').split(/\r?\n/);
    const max = Math.max(before.length, after.length);
    const hunks: WorkspaceFileDiff['hunks'] = [];

    for (let index = 0; index < max; index += 1) {
      const left = before[index];
      const right = after[index];
      if (left === right) {
        if (left !== undefined) {
          hunks.push({
            kind: 'context',
            lineNumberOld: index + 1,
            lineNumberNew: index + 1,
            content: left,
          });
        }
        continue;
      }
      if (left !== undefined) {
        hunks.push({
          kind: 'remove',
          lineNumberOld: index + 1,
          lineNumberNew: null,
          content: left,
        });
      }
      if (right !== undefined) {
        hunks.push({
          kind: 'add',
          lineNumberOld: null,
          lineNumberNew: index + 1,
          content: right,
        });
      }
    }

    const added = hunks.filter((hunk) => hunk.kind === 'add').length;
    const removed = hunks.filter((hunk) => hunk.kind === 'remove').length;
    return {
      path: filePath,
      previousContent,
      currentContent,
      summary: added || removed ? `${added} additions, ${removed} removals` : 'No diff',
      hunks,
      generatedAt: new Date().toISOString(),
    };
  }

  private summarizeDiffs(diffs: WorkspaceFileDiff[]): string {
    const totals = diffs.reduce(
      (acc, diff) => {
        acc.added += diff.hunks.filter((hunk) => hunk.kind === 'add').length;
        acc.removed += diff.hunks.filter((hunk) => hunk.kind === 'remove').length;
        return acc;
      },
      { added: 0, removed: 0 },
    );
    return `${diffs.length} files, ${totals.added} additions, ${totals.removed} removals`;
  }

  private renderUnifiedDiff(diffs: WorkspaceFileDiff[]): string {
    return diffs
      .map((diff) => {
        const lines = [`--- a/${diff.path}`, `+++ b/${diff.path}`];
        for (const hunk of diff.hunks) {
          if (hunk.kind === 'context') lines.push(` ${hunk.content}`);
          if (hunk.kind === 'remove') lines.push(`-${hunk.content}`);
          if (hunk.kind === 'add') lines.push(`+${hunk.content}`);
        }
        return lines.join('\n');
      })
      .join('\n\n');
  }

  private async snapshotFileRevision(
    project: AppBuilderProject,
    filePath: string,
    previousContent: string | null,
    currentContent: string | null,
    reason: string,
    runId: string | null = null,
  ): Promise<WorkspaceFileDiff> {
    const diff = this.buildLineDiff(filePath, previousContent, currentContent);
    await this.storeArtifact(project.id, runId, 'file_revision', 'codegen', `File revision: ${filePath}`, {
      ...diff,
      reason,
    });
    await this.recordActivity(project.id, {
      runId,
      kind: 'file',
      status: 'info',
      title: `Updated ${filePath}`,
      summary: reason,
      filePath,
      metadata: { diffSummary: diff.summary },
    });
    return diff;
  }

  private toProject(record: NonNullable<ProjectRecord>): AppBuilderProject {
    return {
      id: record.id,
      name: record.name,
      slug: record.slug,
      description: record.description,
      workspaceId: record.workspaceId,
      appType: record.appType as AppBuilderProject['appType'],
      sourceType: record.sourceType as AppBuilderProject['sourceType'],
      templateId: record.templateId,
      status: record.status as AppBuilderProjectStatus,
      controlMode: record.controlMode as AppBuilderProject['controlMode'],
      approvalRequired: record.approvalRequired,
      approvalGranted: record.approvalGranted,
      requestedPermissions: this.parseJson(record.requestedPermissionsJson, []),
      requestedCapabilities: this.parseJson(record.requestedCapabilitiesJson, []),
      sourcePath: record.sourcePath,
      managedPath: record.managedPath,
      deployPath: record.deployPath,
      exportPath: record.exportPath,
      latestManifestId: record.latestManifestId,
      latestRunId: record.latestRunId,
      metadata: this.parseJson(record.metadataJson, null),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toManifest(record: NonNullable<ManifestRecord>): AppBuilderManifestRecord {
    const manifest = this.parseManifestJson(record.manifestJson);
    if (!manifest) {
      throw new Error(`Manifest ${record.id} is missing or invalid.`);
    }
    return {
      id: record.id,
      projectId: record.projectId,
      version: record.version,
      manifest,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toRun(record: NonNullable<RunRecord>): AppBuilderRun {
    return {
      id: record.id,
      projectId: record.projectId,
      phase: record.phase as AppBuilderPhase,
      status: record.status as AppBuilderRunStatus,
      title: record.title,
      summary: record.summary,
      error: record.errorMessage,
      gatewayRunId: record.gatewayRunId,
      queueJobId: record.queueJobId,
      workerId: record.workerId,
      output: this.parseJson(record.outputJson, null),
      createdAt: record.createdAt.toISOString(),
      startedAt: record.startedAt?.toISOString() || null,
      finishedAt: record.finishedAt?.toISOString() || null,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toRegistryRecord(record: NonNullable<RegistryRecordModel>): AppRegistryRecord {
    const manifest = this.parseManifestJson(record.manifestJson);
    if (!manifest) {
      throw new Error(`Registry record ${record.id} is missing a valid manifest.`);
    }
    return {
      id: record.id,
      projectId: record.projectId,
      appId: record.appId,
      version: record.version,
      sourceType: record.sourceType as AppBuilderProject['sourceType'],
      status: record.status as AppRegistryRecord['status'],
      manifest,
      controlEndpoint: record.controlEndpoint,
      eventStreamEndpoint: record.eventStreamEndpoint,
      deploymentLocation: record.deploymentLocation,
      healthStatus: (record.healthStatus as AppRegistryRecord['healthStatus']) || 'unknown',
      capabilityList: manifest?.capabilities?.map((capability) => capability.command) || [],
      registeredAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toAdapter(record: NonNullable<AdapterRecordModel>): ImportedProjectAdapter {
    return {
      id: record.id,
      projectId: record.projectId,
      adapterType: record.adapterType as ImportedProjectAdapter['adapterType'],
      sourcePath: record.sourcePath,
      outputPath: record.outputPath,
      status: record.status as ImportedProjectAdapter['status'],
      warnings: this.parseJson(record.warningsJson, []),
      metadata: this.parseJson(record.metadataJson, null),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private approvalGate(project: AppBuilderProject): AppBuilderApprovalGate {
    const stage = this.pendingApprovalStage(project);
    return {
      projectId: project.id,
      required: project.approvalRequired,
      approved: project.approvalGranted && !stage,
      stage,
      reviewedAt: this.stageReviewedAt(project, stage),
      reviewer: this.stageReviewer(project, stage),
      notes: this.stageNotes(project, stage),
    };
  }

  private isPlanningApprovalPending(project: AppBuilderProject): boolean {
    return this.pendingApprovalStage(project) === 'plan';
  }

  private pendingApprovalStage(project: AppBuilderProject): AppBuilderApprovalStage | null {
    const metadata = project.metadata || {};
    const explicitStage = typeof metadata.pendingApprovalStage === 'string'
      ? metadata.pendingApprovalStage as AppBuilderApprovalStage
      : null;
    if (explicitStage) {
      return explicitStage;
    }
    if (
      project.status === 'approval_required'
      && !project.approvalGranted
      && Boolean(metadata.plannerReviewSummary)
      && !Boolean(metadata.planApprovedAt)
    ) {
      return 'plan';
    }
    return null;
  }

  private approvalStageForPhase(phase: AppBuilderPhase): AppBuilderApprovalStage | null {
    switch (phase) {
      case 'plan':
        return 'plan';
      case 'generate':
      case 'integrate':
      case 'adapter-generate':
        return 'build';
      case 'validate':
        return 'validate';
      case 'deploy':
        return 'deploy';
      case 'register':
        return 'register';
      default:
        return null;
    }
  }

  private phaseAllowedDuringPendingApproval(phase: AppBuilderPhase, pendingStage: AppBuilderApprovalStage | null): boolean {
    if (!pendingStage) {
      return true;
    }
    if (pendingStage === 'plan') {
      return phase === 'plan';
    }
    if (pendingStage === 'build') {
      return phase === 'generate' || phase === 'integrate' || phase === 'adapter-generate';
    }
    if (pendingStage === 'validate') {
      return phase === 'validate';
    }
    if (pendingStage === 'deploy') {
      return phase === 'deploy';
    }
    if (pendingStage === 'register') {
      return phase === 'register';
    }
    return false;
  }

  private stageReviewedAt(project: AppBuilderProject, stage: AppBuilderApprovalStage | null): string | null {
    const metadata = project.metadata || {};
    if (stage === 'plan') return metadata.planApprovedAt as string | null || null;
    if (stage === 'build') return metadata.buildApprovedAt as string | null || null;
    if (stage === 'validate') return metadata.validationApprovedAt as string | null || null;
    if (stage === 'deploy') return metadata.deployApprovedAt as string | null || null;
    if (stage === 'register') return metadata.registerApprovedAt as string | null || null;
    return metadata.approvalReviewedAt as string | null || null;
  }

  private stageReviewer(project: AppBuilderProject, stage: AppBuilderApprovalStage | null): string | null {
    const metadata = project.metadata || {};
    if (stage === 'plan') return metadata.planApprovalReviewer as string | null || null;
    if (stage === 'build') return metadata.buildApprovalReviewer as string | null || null;
    if (stage === 'validate') return metadata.validationApprovalReviewer as string | null || null;
    if (stage === 'deploy') return metadata.deployApprovalReviewer as string | null || null;
    if (stage === 'register') return metadata.registerApprovalReviewer as string | null || null;
    return metadata.approvalReviewer as string | null || null;
  }

  private stageNotes(project: AppBuilderProject, stage: AppBuilderApprovalStage | null): string | null {
    const metadata = project.metadata || {};
    if (stage === 'plan') return metadata.planApprovalNotes as string | null || null;
    if (stage === 'build') return metadata.buildApprovalNotes as string | null || null;
    if (stage === 'validate') return metadata.validationApprovalNotes as string | null || null;
    if (stage === 'deploy') return metadata.deployApprovalNotes as string | null || null;
    if (stage === 'register') return metadata.registerApprovalNotes as string | null || null;
    return metadata.approvalNotes as string | null || null;
  }

  private nextStatusAfterApproval(stage: AppBuilderApprovalStage | null, currentStatus: AppBuilderProjectStatus): AppBuilderProjectStatus {
    switch (stage) {
      case 'plan':
        return 'planned';
      case 'build':
        return 'generated_unvalidated';
      case 'validate':
        return 'deployment_ready';
      case 'deploy':
        return 'deployed';
      case 'register':
        return 'registered';
      default:
        return currentStatus === 'approval_required' ? 'planned' : currentStatus;
    }
  }

  private async modelRouteSnapshot() {
    const config = await this.modelsService.getConfig();
    return {
      chat: config.routing.appBuilder,
      planner: config.routing.appBuilderPlanner || config.routing.appBuilder,
      build: config.routing.appBuilderBuilder || config.routing.appBuilder,
    };
  }

  private async patchProjectMetadata(project: AppBuilderProject, patch: Record<string, unknown>): Promise<void> {
    await this.workflowRepo.patchMetadata(project.id, patch);
  }

  private async mutateProjectMetadata(projectId: string, mutate: (metadata: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    return this.workflowRepo.mutateMetadata(projectId, async (metadata) => mutate(metadata));
  }

  private async latestValidation(projectId: string): Promise<AppBuilderValidationResult | null> {
    const run = await this.prisma.appBuilderRun.findFirst({
      where: { projectId, phase: 'validate' },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      return null;
    }
    const detail = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!detail) {
      return null;
    }
    const manifestRecord = await this.getLatestManifest(projectId);
    const session = await this.latestArtifact<ValidationSession>(projectId, 'validation');
    const checks = await this.validationChecks(this.toProject(detail), manifestRecord?.manifest || null, session);
    const output = this.parseJson<Record<string, unknown>>(run.outputJson, {});
    return {
      id: run.id,
      projectId,
      runId: run.id,
      phase: 'validate',
      ok: checks.every((check) => check.status !== 'failed'),
      snapshotId: session?.snapshotId || (typeof output.snapshotId === 'string' ? output.snapshotId : null),
      status: session?.status || (typeof output.status === 'string' ? output.status as 'current' | 'stale' | 'superseded' : null),
      harnessRunId: session?.harnessRunId || null,
      checks,
      createdAt: run.updatedAt.toISOString(),
    };
  }

  private buildPreviewConnectionState(detail: AppBuilderProjectDetail, terminal: TerminalSessionRecord | null): PreviewSession | null {
    const previewArtifact = detail.artifacts.find((artifact) => artifact.kind === 'preview_session')?.payload as PreviewSession | undefined;
    if (terminal?.previewUrl) {
      const activeOutput =
        terminal.commands.find((entry) => entry.id === terminal.activeCommandId)?.output
        || terminal.commands[0]?.output
        || '';
      const detected = this.detectPreviewFromOutput(activeOutput);
      return {
        status: detected || terminal.status !== 'running' ? 'ready' : 'starting',
        url: detected?.url || terminal.previewUrl,
        port: detected?.port || terminal.previewPort || null,
        servedPath: terminal.cwd,
        processRunId: terminal.activeCommandId || null,
        processId: terminal.activeCommandId || null,
        startedAt: terminal.lastCommandAt || terminal.updatedAt,
      };
    }
    if (previewArtifact) {
      return previewArtifact;
    }
    return null;
  }

  async listTemplates(): Promise<AppBuilderTemplate[]> {
    return APP_BUILDER_TEMPLATES;
  }

  async getTemplate(id: string): Promise<AppBuilderTemplate> {
    const template = APP_BUILDER_TEMPLATES.find((entry) => entry.id === id);
    if (!template) {
      throw new NotFoundException(`Template ${id} not found.`);
    }
    return template;
  }

  async listProjects(): Promise<AppBuilderProject[]> {
    const records = await this.prisma.appBuilderProject.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((record) => this.toProject(record));
  }

  async getProjectDetail(id: string): Promise<AppBuilderProjectDetail> {
    const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id } });
    if (!projectRecord) {
      throw new NotFoundException(`App Builder project ${id} not found.`);
    }
    const [manifestRecords, runRecords, registryRecords, adapterRecords, latestValidation, artifacts, modelRoutes] = await Promise.all([
      this.prisma.appBuilderManifest.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.appBuilderRun.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.appRegistryRecord.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.importedProjectAdapter.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.latestValidation(id),
      this.listArtifacts(id, 80),
      this.modelRouteSnapshot(),
    ]);
    const project = this.toProject(projectRecord);
    const taskList = (await this.latestArtifact<AppBuilderTaskList>(id, 'task_list')) || null;
    const docsArtifact = await this.latestArtifact<{ docs: ProjectBibleDocument[] }>(id, 'project_bible');
    const docs = docsArtifact?.docs || [];
    const terminal = await this.loadTerminalSession(project).catch(() => null);
    const memory = await this.buildProjectMemorySnapshot(project).catch(() => null);
    const fileTree = project.managedPath && existsSync(project.managedPath)
      ? {
          rootPath: project.managedPath,
          projectPath: project.managedPath,
          tree: await this.buildProjectFileTreeRecursive(project.managedPath, project.managedPath),
        }
      : null;
    const detailBase: AppBuilderProjectDetail = {
      project,
      manifests: manifestRecords.map((record) => this.toManifest(record)),
      runs: runRecords.map((record) => this.toRun(record)),
      registryRecords: registryRecords.map((record) => this.toRegistryRecord(record)),
      adapters: adapterRecords.map((record) => this.toAdapter(record)),
      artifacts,
      latestValidation,
      approvalGate: this.approvalGate(project),
      modelRoutes,
      docs,
      taskList,
      fileTree,
      terminal,
      previewConnection: null,
      memory,
      activity: (await this.listArtifactsByKind<AppBuilderActivityEvent>(id, 'activity', 60)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
    const previewSession = this.buildPreviewConnectionState(detailBase, terminal);
    const previewConnection = previewSession
      ? ({
          mode: terminal?.previewUrl ? 'dev_server' : 'deploy_preview',
          status: previewSession.status === 'failed' ? 'failed' : previewSession.status === 'starting' ? 'starting' : 'ready',
          title: terminal?.previewUrl ? 'Dev preview connected' : 'Managed preview ready',
          summary: terminal?.previewUrl
            ? `Shared terminal is serving a live preview at ${terminal.previewUrl}.`
            : 'Managed preview is available from the latest deploy/build output.',
          url: previewSession.url || null,
          projectPath: previewSession.servedPath,
          source: terminal?.previewUrl ? 'terminal' : 'deploy',
          updatedAt: previewSession.startedAt,
        } satisfies AppBuilderProjectDetail['previewConnection'])
      : ({
          mode: project.status === 'planned' || project.status === 'queued' || project.status === 'generating' || project.status === 'integrating' || project.status === 'validating'
            ? 'activity'
            : 'none',
          status: project.status === 'planned' || project.status === 'queued' || project.status === 'generating' || project.status === 'integrating' || project.status === 'validating'
            ? 'starting'
            : 'idle',
          title: project.status === 'planned' || project.status === 'queued' ? 'Planner activity in progress' : 'Preview not connected',
          summary: project.status === 'planned' || project.status === 'queued'
            ? 'Open Activity, Files, or Docs to watch the agent prepare the project before preview exists.'
            : 'No live preview is connected yet.',
          url: null,
          projectPath: project.managedPath || null,
          source: project.status === 'planned' || project.status === 'queued' ? 'none' : 'fallback',
          updatedAt: new Date().toISOString(),
        } satisfies AppBuilderProjectDetail['previewConnection']);
    const detail: AppBuilderProjectDetail = {
      ...detailBase,
      previewConnection,
    };
    const workflowState = this.workflowState.derive(detail);
    const rawIndexMetadata = project.metadata || {};
    const indexMetadata = this.normalizeIndexMetadata(rawIndexMetadata);
    if (rawIndexMetadata.indexedGeneration !== undefined && rawIndexMetadata.lastIndexedGeneration === undefined) {
      void this.patchProjectMetadata(project, { lastIndexedGeneration: indexMetadata.lastIndexedGeneration }).catch(() => undefined);
    }
    return {
      ...detail,
      workflowState,
      generationMode: workflowState.generationMode || null,
      nextAllowedActions: this.workflowState.nextAllowedActions({ ...detail, workflowState }, 'workspace'),
      capacityState: workflowState.capacityState || null,
      validationSnapshotId: latestValidation?.snapshotId || null,
      harnessRunId: latestValidation?.harnessRunId || null,
      isIndexStale: this.isIndexMetadataStale(indexMetadata),
      indexFreshness: indexMetadata.lastIndexedAt,
      contextFreshness: indexMetadata.lastIndexedAt,
      isContextStale: this.isIndexMetadataStale(indexMetadata),
    };
  }

  private buildSuggestedActions(detail: AppBuilderProjectDetail | null, mode: AppBuilderMode = 'chat'): AppBuilderSuggestedAction[] {
    if (!detail) {
      return [
        { id: 'draft-start', label: 'Start planning', kind: 'phase', phase: 'plan', emphasis: 'primary' },
        { id: 'draft-refine', label: 'Keep refining', kind: 'refresh', emphasis: 'secondary' },
      ];
    }
    if (detail.workflowState || detail.latestValidation?.status === 'stale' || detail.project.status === 'interrupted' || detail.project.status === 'generated_unvalidated') {
      return this.workflowState.nextAllowedActions(detail, mode);
    }

    const actions: AppBuilderSuggestedAction[] = [];
    const pendingStage = detail.approvalGate?.stage || this.pendingApprovalStage(detail.project);
    if (pendingStage) {
      actions.push({
        id: 'approve',
        label: `Approve ${pendingStage}`,
        kind: 'approve',
        emphasis: 'primary',
      });
    }

    switch (detail.project.status) {
      case 'draft':
      case 'planned':
        actions.push({ id: 'generate', label: 'Build first version', kind: 'phase', phase: 'generate', emphasis: 'primary' });
        actions.push({ id: 'replan', label: 'Re-plan', kind: 'phase', phase: 'plan', emphasis: 'secondary' });
        break;
      case 'approval_required':
        if (pendingStage === 'plan') {
          actions.push({ id: 'replan', label: 'Revise plan', kind: 'phase', phase: 'plan', emphasis: 'ghost' });
          actions.push({ id: 'generate', label: 'Continue to build', kind: 'phase', phase: 'generate', emphasis: 'secondary', disabled: true, reason: 'Approve plan first.' });
          break;
        }
        if (pendingStage === 'build') {
          actions.push({ id: 'regenerate', label: 'Revise build', kind: 'phase', phase: 'generate', emphasis: 'ghost' });
          actions.push({ id: 'validate', label: 'Run validation', kind: 'phase', phase: 'validate', emphasis: 'secondary', disabled: true, reason: 'Approve build first.' });
          break;
        }
        if (pendingStage === 'validate') {
          actions.push({ id: 'revalidate', label: 'Retry validation', kind: 'phase', phase: 'validate', emphasis: 'ghost' });
          actions.push({ id: 'deploy', label: 'Continue to deploy', kind: 'phase', phase: 'deploy', emphasis: 'secondary', disabled: true, reason: 'Approve validation first.' });
          break;
        }
        if (pendingStage === 'deploy') {
          actions.push({ id: 'redeploy', label: 'Retry deploy', kind: 'phase', phase: 'deploy', emphasis: 'ghost' });
          actions.push({ id: 'register', label: 'Continue to register', kind: 'phase', phase: 'register', emphasis: 'secondary', disabled: true, reason: 'Approve deploy first.' });
          break;
        }
        if (pendingStage === 'register') {
          actions.push({ id: 'reregister', label: 'Retry register', kind: 'phase', phase: 'register', emphasis: 'ghost' });
          break;
        }
        actions.push({ id: 'validate', label: 'Validate', kind: 'phase', phase: 'validate', emphasis: 'secondary' });
        break;
      case 'generating':
      case 'integrating':
      case 'deployment_ready':
      case 'deployed':
        actions.push({ id: 'validate', label: 'Run validation', kind: 'phase', phase: 'validate', emphasis: 'primary' });
        actions.push({ id: 'deploy', label: 'Deploy locally', kind: 'phase', phase: 'deploy', emphasis: 'secondary' });
        actions.push({ id: 'register', label: 'Register', kind: 'phase', phase: 'register', emphasis: 'ghost' });
        break;
      case 'registered':
        actions.push({ id: 'control-test', label: 'Control test', kind: 'phase', phase: 'control-test', emphasis: 'primary' });
        actions.push({ id: 'export', label: 'Export', kind: 'phase', phase: 'export', emphasis: 'secondary' });
        break;
      default:
        actions.push({ id: 'plan', label: 'Plan', kind: 'phase', phase: 'plan', emphasis: 'primary' });
        actions.push({ id: 'validate', label: 'Validate', kind: 'phase', phase: 'validate', emphasis: 'secondary' });
        break;
    }

    if (mode !== 'workspace') {
      actions.push({ id: 'workspace', label: 'Workspace', kind: 'open_mode', mode: 'workspace', emphasis: 'ghost' });
    }
    if (mode !== 'console') {
      actions.push({ id: 'console', label: 'Console', kind: 'open_mode', mode: 'console', emphasis: 'ghost' });
    }
    return actions;
  }

  private buildPreviewState(detail: AppBuilderProjectDetail | null): AppBuilderPreviewState {
    if (!detail) {
      return {
        status: 'empty',
        title: 'Preview appears after the brief turns into a build',
        summary: 'Start in chat, refine the builder brief, then tell RawClaw to create a plan or start the build pipeline when you are ready.',
        projectPath: null,
        connection: {
          mode: 'none',
          status: 'idle',
          title: 'No active project',
          summary: 'Start a builder conversation to open the workspace.',
          url: null,
          projectPath: null,
          source: 'none',
          updatedAt: new Date().toISOString(),
        },
        currentTab: 'activity',
        availableTabs: ['activity', 'preview', 'files', 'docs', 'terminal', 'logs'],
        logs: [],
      };
    }

    const previewConnection = detail.previewConnection || null;
    const previewUrl = previewConnection?.url || null;
    const phaseAwareDefault =
      detail.project.status === 'planned'
      || detail.project.status === 'queued'
      || detail.project.status === 'generating'
      || detail.project.status === 'integrating'
      || detail.project.status === 'validating'
      || detail.approvalGate?.stage
        ? 'activity'
        : previewUrl
          ? 'preview'
          : 'activity';

    if (detail.project.metadata?.smokeRestoreFailed || detail.project.metadata?.smokeRestorePending) {
      return {
        status: 'disconnected',
        title: detail.project.metadata?.smokeRestoreFailed ? 'Control state restore failed' : 'Control state restore pending',
        summary: detail.project.metadata?.smokeRestoreFailed
          ? 'Preview and control commands are unavailable until smoke restore is retried or control state is reset.'
          : 'Preview and control commands are paused while RawClaw restores the pre-smoke control state.',
        projectPath: detail.project.managedPath,
        connection: previewConnection,
        currentTab: 'activity',
        availableTabs: ['activity', 'files', 'logs', 'project'],
        logs: detail.runs.slice(0, 5).map((run) => `${run.phase}: ${run.summary || run.error || run.status}`),
      };
    }

    if (previewUrl && previewConnection?.status === 'ready') {
      return {
        status: 'ready',
        title: previewConnection.title || 'Live preview',
        summary: previewConnection.summary || 'RawClaw has a previewable app target for this project.',
        url: previewUrl,
        projectPath: previewConnection.projectPath || detail.project.deployPath || detail.project.managedPath,
        connection: previewConnection,
        currentTab: phaseAwareDefault,
        availableTabs: ['activity', 'preview', 'files', 'docs', 'terminal', 'logs', 'project'],
        logs: detail.runs.slice(0, 5).map((run) => `${run.phase}: ${run.summary || run.error || run.status}`),
      };
    }

    if (detail.project.sourceType === 'imported') {
      return {
        status: 'fallback',
        title: 'Imported project adapter view',
        summary: 'This imported project does not expose a live preview yet. Use the adapter/runtime card while RawClaw validates controllability.',
        projectPath: detail.project.sourcePath || detail.project.managedPath,
        connection: previewConnection,
        currentTab: 'activity',
        availableTabs: ['activity', 'files', 'docs', 'terminal', 'logs', 'project'],
        logs: detail.adapters.map((adapter) => `${adapter.adapterType}: ${adapter.status}`),
      };
    }

    return {
      status: previewConnection?.status === 'disconnected' ? 'disconnected' : previewConnection?.status === 'starting' ? 'starting' : 'empty',
      title: previewConnection?.title || 'Preview will appear after generate/integrate',
      summary: previewConnection?.summary || (detail.project.managedPath
        ? 'The managed project exists, but no preview URL is active yet. Generate, integrate, or deploy to unlock a live pane.'
        : 'RawClaw is still shaping the project brief. Generate or import the project first.'),
      projectPath: detail.project.managedPath,
      connection: previewConnection,
      currentTab: phaseAwareDefault,
      availableTabs: ['activity', 'preview', 'files', 'docs', 'terminal', 'logs', 'project'],
      logs: detail.runs.slice(0, 5).map((run) => `${run.phase}: ${run.summary || run.error || run.status}`),
    };
  }

  async getConversation(input: { draftId?: string | null; projectId?: string | null; mode?: AppBuilderMode | null }): Promise<AppBuilderConversation> {
    if (input.projectId) {
      const detail = await this.getProjectDetail(input.projectId);
      return this.loadConversation('project', input.projectId, input.mode || 'chat', detail.project.name);
    }
    const draftId = this.builderDraftId(input.draftId);
    return this.loadConversation('draft', draftId, input.mode || 'chat', 'New Builder');
  }

  async getBriefDraft(input: { draftId?: string | null; projectId?: string | null }): Promise<AppBuilderBriefDraft> {
    if (input.projectId) {
      const detail = await this.getProjectDetail(input.projectId);
      return this.loadBrief('project', input.projectId, {
        workspaceId: detail.project.workspaceId,
        sourceType: detail.project.sourceType,
        appType: detail.project.appType,
        controlMode: detail.project.controlMode,
        templateId: detail.project.templateId,
        titleOverride: detail.project.name,
        sourcePath: detail.project.sourcePath,
        prompt: detail.project.description,
      });
    }
    const draftId = this.builderDraftId(input.draftId);
    return this.loadBrief('draft', draftId);
  }

  async updateBriefDraft(
    input: { draftId?: string | null; projectId?: string | null },
    patch: Partial<Pick<AppBuilderBriefDraft, 'workspaceId' | 'sourceType' | 'appType' | 'controlMode' | 'templateId' | 'titleOverride' | 'sourcePath' | 'prompt'>>,
  ): Promise<AppBuilderBriefDraft> {
    if (input.projectId) {
      const current = await this.getBriefDraft({ projectId: input.projectId });
      return this.saveBrief('project', input.projectId, { ...current, ...patch });
    }
    const draftId = this.builderDraftId(input.draftId);
    const current = await this.getBriefDraft({ draftId });
    return this.saveBrief('draft', draftId, { ...current, ...patch });
  }

  async getPreviewState(projectId: string): Promise<AppBuilderPreviewState> {
    const detail = await this.getProjectDetail(projectId);
    return this.buildPreviewState(detail);
  }

  async getWorkspaceFileTree(projectId: string): Promise<WorkspaceFileTree> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const rootPath = await this.ensureProjectRoot(project);
    const tree = await this.buildProjectFileTreeRecursive(rootPath, rootPath);
    return {
      rootPath,
      projectPath: rootPath,
      tree,
    };
  }

  async getWorkspaceFile(projectId: string, relPath: string): Promise<WorkspaceFileRecord> {
    const detail = await this.getProjectDetail(projectId);
    const absolute = this.safeProjectPath(detail.project, relPath);
    const content = await fs.readFile(absolute, 'utf8');
    const stats = await fs.stat(absolute);
    return {
      path: this.normalizeWorkspacePath(relPath),
      name: path.basename(absolute),
      content,
      exists: true,
      updatedAt: stats.mtime.toISOString(),
      size: stats.size,
      language: this.languageForPath(absolute),
    };
  }

  async createWorkspaceFolder(projectId: string, relPath: string): Promise<WorkspaceFileTree> {
    const detail = await this.getProjectDetail(projectId);
    const absolute = this.safeProjectPath(detail.project, relPath);
    await fs.mkdir(absolute, { recursive: true });
    await this.recordActivity(projectId, {
      kind: 'file',
      status: 'success',
      title: `Created folder ${this.normalizeWorkspacePath(relPath)}`,
      summary: 'Workspace folder created from the Builder files tab.',
      filePath: this.normalizeWorkspacePath(relPath),
    });
    return this.getWorkspaceFileTree(projectId);
  }

  async saveWorkspaceFile(projectId: string, request: WorkspaceFileEditRequest, actor = 'builder-workspace'): Promise<WorkspaceFileRecord> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const relPath = this.normalizeWorkspacePath(request.path);
    const absolute = this.safeProjectPath(project, relPath);
    const previousContent = existsSync(absolute) ? await fs.readFile(absolute, 'utf8') : null;
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, request.content || '', 'utf8');
    const currentContent = await fs.readFile(absolute, 'utf8');
    await this.snapshotFileRevision(project, relPath, previousContent, currentContent, `${actor} saved ${relPath}.`);
    await this.markProjectIndexableChange(project, 'workspace_file_save', { incrementGeneration: false });
    return this.getWorkspaceFile(projectId, relPath);
  }

  async renameWorkspacePath(projectId: string, fromPath: string, toPath: string): Promise<WorkspaceFileTree> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const fromAbsolute = this.safeProjectPath(project, fromPath);
    const toAbsolute = this.safeProjectPath(project, toPath);
    await fs.mkdir(path.dirname(toAbsolute), { recursive: true });
    await fs.rename(fromAbsolute, toAbsolute);
    await this.markProjectIndexableChange(project, 'workspace_path_rename', { incrementGeneration: false });
    await this.recordActivity(projectId, {
      kind: 'file',
      status: 'success',
      title: `Renamed ${this.normalizeWorkspacePath(fromPath)}`,
      summary: `Moved to ${this.normalizeWorkspacePath(toPath)}.`,
      filePath: this.normalizeWorkspacePath(toPath),
    });
    return this.getWorkspaceFileTree(projectId);
  }

  async deleteWorkspacePath(projectId: string, relPath: string): Promise<WorkspaceFileTree> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const absolute = this.safeProjectPath(project, relPath);
    const previousContent = existsSync(absolute) ? await fs.readFile(absolute, 'utf8').catch(() => null) : null;
    await fs.rm(absolute, { recursive: true, force: true });
    if (previousContent !== null) {
      await this.snapshotFileRevision(project, this.normalizeWorkspacePath(relPath), previousContent, null, `Deleted ${this.normalizeWorkspacePath(relPath)}.`);
    } else {
      await this.recordActivity(projectId, {
        kind: 'file',
        status: 'warning',
        title: `Deleted ${this.normalizeWorkspacePath(relPath)}`,
        summary: 'Workspace path removed.',
        filePath: this.normalizeWorkspacePath(relPath),
      });
    }
    await this.markProjectIndexableChange(project, 'workspace_path_delete', { incrementGeneration: false });
    return this.getWorkspaceFileTree(projectId);
  }

  async formatWorkspaceFile(projectId: string, relPath: string): Promise<WorkspaceFileRecord> {
    const file = await this.getWorkspaceFile(projectId, relPath);
    const absolutePath = relPath;
    let nextContent = file.content.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
    if (absolutePath.toLowerCase().endsWith('.json')) {
      nextContent = `${JSON.stringify(JSON.parse(file.content), null, 2)}\n`;
    } else if (!nextContent.endsWith('\n')) {
      nextContent = `${nextContent}\n`;
    }
    return this.saveWorkspaceFile(projectId, { path: relPath, content: nextContent }, 'formatter');
  }

  async getWorkspaceFileDiff(projectId: string, relPath: string): Promise<WorkspaceFileDiff> {
    const detail = await this.getProjectDetail(projectId);
    const normalized = this.normalizeWorkspacePath(relPath);
    const currentContent = existsSync(this.safeProjectPath(detail.project, normalized))
      ? await fs.readFile(this.safeProjectPath(detail.project, normalized), 'utf8')
      : null;
    const revisions = await this.listArtifactsByKind<Record<string, unknown>>(projectId, 'file_revision', 50);
    const revision = revisions.find((entry) => String(entry.path || '') === normalized);
    const previousContent = typeof revision?.previousContent === 'string' ? revision.previousContent : null;
    return this.buildLineDiff(normalized, previousContent, currentContent);
  }

  async listStagedGenerations(projectId: string): Promise<StagedGenerationPayload[]> {
    await this.getProjectDetail(projectId);
    return (await this.listArtifactRecordsByKind(projectId, 'staged_generation', 50))
      .map((record) => record.payload as unknown as StagedGenerationPayload)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async getStagedGenerationDiff(projectId: string, stagingId: string): Promise<StagedDiffPayload> {
    await this.getProjectDetail(projectId);
    return this.findStagedDiff(projectId, stagingId);
  }

  async applyStagedGeneration(projectId: string, stagingId: string, filePaths?: string[] | null): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const managedPath = await this.ensureProjectRoot(project);
    const stagedRecord = await this.findStagedGenerationRecord(projectId, stagingId);
    const staged = stagedRecord.payload as unknown as StagedGenerationPayload;
    if (staged.status === 'discarded' || staged.status === 'applied' || staged.status === 'superseded' || staged.status === 'superseded_stale') {
      throw new BadRequestException(`Staged generation ${stagingId} is ${staged.status} and cannot be applied.`);
    }

    const requestedPaths = (filePaths?.length ? filePaths : staged.changedFiles)
      .map((entry) => this.normalizeWorkspacePath(entry))
      .filter((entry) => !staged.appliedFilePaths.includes(entry) && !staged.discardedFilePaths.includes(entry));
    if (!requestedPaths.length) {
      return { stagedGeneration: staged, appliedSnapshot: null, appliedFiles: [] };
    }

    const securityConflicts = await this.pendingSecurityFindings(projectId, stagingId, requestedPaths);
    const conflicts = [...securityConflicts];
    for (const relPath of requestedPaths) {
      const stagedHash = staged.stagedFileHashes[relPath];
      if (!stagedHash) {
        throw new BadRequestException(`File ${relPath} is not present in staged generation ${stagingId}.`);
      }
      const absolute = this.safeProjectPath(project, relPath);
      const currentHash = existsSync(absolute) ? this.appBuilderStorage.hashContent(await fs.readFile(absolute)) : null;
      const baseHash = staged.baseFileHashes[relPath] || null;
      if (currentHash !== baseHash) {
        conflicts.push({
          path: relPath,
          baseHash,
          currentHash,
          stagedHash,
          reason: 'Current file changed after this generation was staged.',
        });
      }
    }

    if (conflicts.length) {
      const updated: StagedGenerationPayload = {
        ...staged,
        status: 'conflict',
        conflicts,
        files: staged.files.map((file) => conflicts.some((conflict) => conflict.path === file.path) ? { ...file, status: 'conflict' } : file),
        updatedAt: new Date().toISOString(),
      };
      await this.updateArtifactPayload(stagedRecord.id, updated);
      throw new BadRequestException({
        message: `Staged generation ${stagingId} has conflicts that must be resolved before apply.`,
        conflicts,
      });
    }

    const written: string[] = [];
    try {
      for (const relPath of requestedPaths) {
        const contents = await this.appBuilderStorage.readStagedFile(managedPath, stagingId, relPath);
        await this.writeFile(this.safeProjectPath(project, relPath), contents);
        written.push(relPath);
      }
    } catch (error) {
      const baseSnapshot = await this.appBuilderStorage.readSnapshot(managedPath, staged.baseSnapshotId);
      await this.appBuilderStorage.restoreSnapshot({ workspaceRoot: managedPath, snapshot: baseSnapshot, removeFilesNotInSnapshot: true });
      throw error;
    }

    const appliedSnapshot = await this.appBuilderStorage.createSnapshot({
      workspaceRoot: managedPath,
      workspaceId: project.workspaceId || 'default',
      projectId,
      baseSnapshotId: staged.baseSnapshotId,
      status: 'applied',
    });
    await this.storeArtifact(projectId, null, 'generation_snapshot', 'codegen', `Applied snapshot ${appliedSnapshot.id}`, appliedSnapshot);
    await this.pruneProjectSnapshots(project, managedPath, [appliedSnapshot.id, staged.baseSnapshotId]).catch((error) => {
      this.logger.warn(`Snapshot pruning failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
    const appliedFilePaths = Array.from(new Set([...staged.appliedFilePaths, ...written])).sort((a, b) => a.localeCompare(b));
    const remaining = staged.changedFiles.filter((filePath) => !appliedFilePaths.includes(filePath) && !staged.discardedFilePaths.includes(filePath));
    const updated: StagedGenerationPayload = {
      ...staged,
      status: remaining.length ? 'partially_applied' : 'applied',
      appliedFilePaths,
      conflicts: [],
      files: staged.files.map((file) => written.includes(file.path) ? { ...file, status: 'applied' } : file),
      updatedAt: new Date().toISOString(),
      validationStatus: 'queued',
    };
    await this.updateArtifactPayload(stagedRecord.id, updated);
    await this.workflowState.applySnapshot(projectId, appliedSnapshot.id, staged.generationMode);
    await this.markProjectIndexableChange(project, 'staged_apply');
    this.scheduleAutoValidation(projectId, appliedSnapshot.id, stagingId);
    await this.recordActivity(projectId, {
      phase: 'generate',
      lane: 'build',
      kind: 'builder',
      status: 'success',
      title: remaining.length ? 'Applied staged files' : 'Applied staged generation',
      summary: `Applied ${written.length} files from ${stagingId}. Validation is required before deploy/register.`,
      metadata: {
        stagingId,
        appliedSnapshotId: appliedSnapshot.id,
        appliedFiles: written,
        remainingFiles: remaining,
      },
    });
    return { stagedGeneration: updated, appliedSnapshot, appliedFiles: written, remainingFiles: remaining };
  }

  async applyStagedGenerationFile(projectId: string, stagingId: string, filePath: string): Promise<Record<string, unknown>> {
    return this.applyStagedGeneration(projectId, stagingId, [filePath]);
  }

  async resolveStagedGenerationConflict(
    projectId: string,
    stagingId: string,
    payload: { filePath: string; decision: 'keep_current' | 'overwrite_staged' | 'regenerate_patch' },
  ): Promise<Record<string, unknown>> {
    const stagedRecord = await this.findStagedGenerationRecord(projectId, stagingId);
    const staged = stagedRecord.payload as unknown as StagedGenerationPayload;
    const filePath = this.normalizeWorkspacePath(payload.filePath);
    if (!staged.conflicts.some((conflict) => conflict.path === filePath)) {
      throw new BadRequestException(`File ${filePath} is not recorded as a conflict in ${stagingId}.`);
    }
    const resolution = {
      filePath,
      decision: payload.decision,
      resolvedAt: new Date().toISOString(),
      linkedStagingId: null as string | null,
    };
    if (payload.decision === 'keep_current') {
      const result = await this.discardStagedGeneration(projectId, stagingId, [filePath]);
      const next = result.stagedGeneration as StagedGenerationPayload;
      await this.updateArtifactPayload(stagedRecord.id, {
        ...next,
        conflicts: (next.conflicts || []).filter((conflict) => conflict.path !== filePath),
        conflictResolutions: [...(staged.conflictResolutions || []), resolution],
        updatedAt: new Date().toISOString(),
      });
      return { decision: payload.decision, stagedGeneration: (await this.findStagedGenerationRecord(projectId, stagingId)).payload };
    }
    if (payload.decision === 'overwrite_staged') {
      const detail = await this.getProjectDetail(projectId);
      const absolute = this.safeProjectPath(detail.project, filePath);
      const currentHash = existsSync(absolute) ? this.appBuilderStorage.hashContent(await fs.readFile(absolute)) : null;
      const updated: StagedGenerationPayload = {
        ...staged,
        baseFileHashes: { ...staged.baseFileHashes, [filePath]: currentHash || '' },
        conflicts: staged.conflicts.filter((conflict) => conflict.path !== filePath),
        conflictResolutions: [...(staged.conflictResolutions || []), resolution],
        files: staged.files.map((file) => file.path === filePath ? { ...file, status: 'modified', baseHash: currentHash } : file),
        updatedAt: new Date().toISOString(),
      };
      await this.updateArtifactPayload(stagedRecord.id, updated);
      return this.applyStagedGeneration(projectId, stagingId, [filePath]);
    }
    const run = await this.queueProjectPhase(projectId, 'generate', {
      targetedPaths: [filePath],
      generationMode: 'ai_edit',
      parentStagingId: stagingId,
      regenerateFromStagingId: stagingId,
      prompt: `Regenerate a conflict-safe patch for ${filePath} using the current workspace file as the base.`,
      backgroundable: true,
    });
    await this.updateArtifactPayload(stagedRecord.id, {
      ...staged,
      conflictResolutions: [...(staged.conflictResolutions || []), { ...resolution, linkedRunId: run.id }],
      updatedAt: new Date().toISOString(),
    });
    return { decision: payload.decision, run, parentStagingId: stagingId, filePath };
  }

  async discardStagedGeneration(projectId: string, stagingId: string, filePaths?: string[] | null): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const managedPath = await this.ensureProjectRoot(detail.project);
    const stagedRecord = await this.findStagedGenerationRecord(projectId, stagingId);
    const staged = stagedRecord.payload as unknown as StagedGenerationPayload;
    const paths = filePaths?.length ? filePaths.map((entry) => this.normalizeWorkspacePath(entry)) : staged.changedFiles;
    const discardedFilePaths = Array.from(new Set([...staged.discardedFilePaths, ...paths])).sort((a, b) => a.localeCompare(b));
    const allClosed = staged.changedFiles.every((filePath) => discardedFilePaths.includes(filePath) || staged.appliedFilePaths.includes(filePath));
    const updated: StagedGenerationPayload = {
      ...staged,
      status: allClosed ? 'discarded' : 'partially_applied',
      discardedFilePaths,
      files: staged.files.map((file) => paths.includes(file.path) ? { ...file, status: 'discarded' } : file),
      updatedAt: new Date().toISOString(),
    };
    await this.updateArtifactPayload(stagedRecord.id, updated);
    if (allClosed) {
      await this.appBuilderStorage.deleteStaging(managedPath, stagingId);
    }
    await this.recordActivity(projectId, {
      phase: 'generate',
      lane: 'build',
      kind: 'builder',
      status: 'warning',
      title: allClosed ? 'Discarded staged generation' : 'Discarded staged files',
      summary: allClosed ? `Discarded all files from ${stagingId}.` : `Discarded ${paths.length} files from ${stagingId}.`,
      metadata: { stagingId, discardedFiles: paths },
    });
    return { stagedGeneration: updated };
  }

  async rollbackStagedGeneration(projectId: string, stagingId: string): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const managedPath = await this.ensureProjectRoot(project);
    const stagedRecord = await this.findStagedGenerationRecord(projectId, stagingId);
    const staged = stagedRecord.payload as unknown as StagedGenerationPayload;
    const snapshot = await this.appBuilderStorage.readSnapshot(managedPath, staged.baseSnapshotId);
    await this.appBuilderStorage.restoreSnapshot({ workspaceRoot: managedPath, snapshot, removeFilesNotInSnapshot: true });
    await this.workflowState.rollbackToSnapshot(projectId, snapshot.id, `rollback_staging:${stagingId}`);
    const updated: StagedGenerationPayload = {
      ...staged,
      status: 'superseded',
      updatedAt: new Date().toISOString(),
    };
    await this.updateArtifactPayload(stagedRecord.id, updated);
    await this.recordActivity(projectId, {
      phase: 'rollback',
      lane: 'build',
      kind: 'builder',
      status: 'success',
      title: 'Rolled back staged generation',
      summary: `Restored ${project.name} to base snapshot ${snapshot.id}.`,
      metadata: { stagingId, rollbackSnapshotId: snapshot.id },
    });
    return { restoredSnapshot: snapshot, stagedGeneration: updated };
  }

  private async applyRepairPatch(project: AppBuilderProject, stagingId: string, filePaths: string[], runId: string | null): Promise<void> {
    const managedPath = await this.ensureProjectRoot(project);
    const stagedRecord = await this.findStagedGenerationRecord(project.id, stagingId);
    const staged = stagedRecord.payload as unknown as StagedGenerationPayload;
    const applied: string[] = [];
    for (const filePath of filePaths.map((entry) => this.normalizeWorkspacePath(entry))) {
      if (!staged.changedFiles.includes(filePath)) continue;
      const content = await this.appBuilderStorage.readStagedFile(managedPath, stagingId, filePath);
      const target = this.safeProjectPath({ ...project, managedPath }, filePath);
      await this.writeFile(target, content);
      applied.push(filePath);
    }
    if (!applied.length) return;
    const snapshot = await this.appBuilderStorage.createSnapshot({
      workspaceRoot: managedPath,
      workspaceId: project.workspaceId || 'default',
      projectId: project.id,
      baseSnapshotId: staged.baseSnapshotId,
      status: 'applied',
    });
    await this.storeArtifact(project.id, runId, 'code_patch', 'healing', `AI repair patch ${stagingId}`, {
      id: `patch-${stagingId}`,
      stagingId,
      appliedFiles: applied,
      snapshotId: snapshot.id,
      mode: 'ai_repair',
      appliedAt: new Date().toISOString(),
    });
    await this.storeArtifact(project.id, runId, 'generation_snapshot', 'codegen', `Repair snapshot ${snapshot.id}`, snapshot);
    await this.updateArtifactPayload(stagedRecord.id, {
      ...staged,
      status: 'applied',
      appliedFilePaths: Array.from(new Set([...(staged.appliedFilePaths || []), ...applied])),
      updatedAt: new Date().toISOString(),
    });
    await this.recordActivity(project.id, {
      runId,
      phase: 'validate',
      lane: 'build',
      kind: 'validator',
      status: 'success',
      title: 'AI repair patch applied',
      summary: `Applied repair patch for ${applied.join(', ')} before re-running validation.`,
      metadata: { stagingId, snapshotId: snapshot.id, appliedFiles: applied },
    });
  }

  private async markRunStagingSupersededStale(projectId: string, runId: string, reason: string): Promise<void> {
    const records = await this.listArtifactRecordsByKind(projectId, 'staged_generation', 100).catch(() => []);
    const retentionExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    for (const record of records) {
      if (record.runId !== runId) continue;
      const staged = record.payload as unknown as StagedGenerationPayload;
      await this.updateArtifactPayload(record.id, {
        ...staged,
        status: 'superseded_stale',
        stale: true,
        staleReason: reason,
        retentionExpiresAt,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async regenerateStagedGenerationConflicts(projectId: string, stagingId: string): Promise<Record<string, unknown>> {
    const stagedRecord = await this.findStagedGenerationRecord(projectId, stagingId);
    const staged = stagedRecord.payload as unknown as StagedGenerationPayload;
    const conflictPaths = staged.conflicts.map((conflict) => conflict.path);
    if (!conflictPaths.length) {
      throw new BadRequestException(`Staged generation ${stagingId} has no recorded conflicts to regenerate.`);
    }
    const run = await this.queueProjectPhase(projectId, 'generate', {
      targetedPaths: conflictPaths,
      regenerateFromStagingId: stagingId,
      backgroundable: true,
    });
    return { run, targetedPaths: conflictPaths };
  }

  private scheduleAutoValidation(projectId: string, snapshotId: string, stagingId: string): void {
    const key = `${projectId}:${snapshotId}`;
    const now = Date.now();
    const firstQueuedAt = this.autoValidationFirstQueuedAt.get(key) || now;
    this.autoValidationFirstQueuedAt.set(key, firstQueuedAt);
    const existing = this.autoValidationTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }
    const elapsed = now - firstQueuedAt;
    const delay = elapsed >= this.appBuilderConfig.values.autoValidationMaxWaitMs
      ? 0
      : Math.min(this.appBuilderConfig.values.autoValidationDebounceMs, this.appBuilderConfig.values.autoValidationMaxWaitMs - elapsed);
    const timer = setTimeout(() => {
      this.autoValidationTimers.delete(projectId);
      this.autoValidationFirstQueuedAt.delete(key);
      void this.queueAutoValidation(projectId, snapshotId, stagingId);
    }, delay);
    this.autoValidationTimers.set(projectId, timer);
  }

  private async queueAutoValidation(projectId: string, snapshotId: string, stagingId: string): Promise<void> {
    try {
      const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
      if (!projectRecord) return;
      const metadata = this.parseJson<Record<string, unknown>>(projectRecord.metadataJson, {});
      if (metadata.latestAppliedSnapshotId !== snapshotId) {
        await this.workflowState.markValidationStale(projectId, null);
        return;
      }
      const existingAutoRuns = await this.prisma.appBuilderRun.findMany({
        where: {
          projectId,
          phase: 'validate',
          status: { in: ['queued', 'validating'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      for (const run of existingAutoRuns) {
        const payload = this.parseJson<Record<string, unknown>>(run.outputJson, {});
        if (payload.validationTrigger === 'auto_post_apply' && payload.validationSnapshotId !== snapshotId) {
          await this.prisma.appBuilderRun.update({
            where: { id: run.id },
            data: {
              status: 'cancelled',
              summary: 'Superseded by a newer applied snapshot.',
              outputJson: JSON.stringify({
                ...payload,
                status: 'superseded',
                supersededBySnapshotId: snapshotId,
              }),
              finishedAt: new Date(),
            },
          });
        }
      }
      const supersededHarnessRuns = await this.validationEngine.supersedeRunningAutoValidations(projectId, snapshotId);
      if (supersededHarnessRuns > 0) {
        await this.cleanupValidationArtifacts(projectRecord);
      }
      await this.queueProjectPhase(projectId, 'validate', {
        backgroundable: true,
        validationTrigger: 'auto_post_apply',
        validationSnapshotId: snapshotId,
        stagingId,
      });
      await this.recordActivity(projectId, {
        phase: 'validate',
        lane: 'build',
        kind: 'validator',
        status: 'working',
        title: 'Auto-validation queued',
        summary: 'RawClaw queued validation for the latest applied staged files.',
        metadata: { snapshotId, stagingId, trigger: 'auto_post_apply' },
      });
    } catch (error) {
      this.logger.warn(`Auto-validation queue failed for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async cleanupValidationArtifacts(projectRecord: NonNullable<ProjectRecord>): Promise<void> {
    const project = this.toProject(projectRecord);
    const managedPath = project.managedPath;
    if (!managedPath) return;
    const cleanupTargets = [
      'dist',
      'coverage',
      '.vite',
      'tsconfig.tsbuildinfo',
      '.tsbuildinfo',
    ];
    for (const target of cleanupTargets) {
      const absolute = this.securePaths.resolveInside(managedPath, target);
      await fs.rm(absolute, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async explainProjectCode(projectId: string, relPath: string, startLine?: number | null, endLine?: number | null): Promise<Record<string, unknown>> {
    const file = await this.getWorkspaceFile(projectId, relPath);
    const lines = file.content.split(/\r?\n/);
    const start = Math.max(1, Math.min(startLine || 1, lines.length || 1));
    const end = Math.max(start, Math.min(endLine || Math.min(lines.length, start + 80), lines.length || start));
    const selected = lines.slice(start - 1, end);
    const imports = selected.filter((line) => /^\s*import\s/.test(line)).slice(0, 8);
    const exports = selected.filter((line) => /\bexport\b/.test(line)).slice(0, 8);
    const eventHandlers = selected.filter((line) => /\bon[A-Z][A-Za-z]+\s*=|addEventListener|emitRawClawEvent|rawclaw/i.test(line)).slice(0, 8);

    return {
      filePath: file.path,
      language: file.language,
      range: { startLine: start, endLine: end },
      contextFreshness: new Date().toISOString(),
      isContextStale: false,
      summary: [
        `This explanation is grounded in ${file.path}:${start}-${end}.`,
        imports.length ? `It depends on ${imports.length} import statement(s) in the selected range.` : 'No imports appear in the selected range.',
        exports.length ? `It exposes ${exports.length} export-related line(s).` : 'No exports appear in the selected range.',
        eventHandlers.length ? 'The selected range appears to include UI/control/event handling logic.' : 'The selected range does not appear to include obvious event-handling logic.',
      ].join(' '),
      notableLines: selected
        .map((line, index) => ({ lineNumber: start + index, text: line.trim() }))
        .filter((line) => line.text && (/^(export|import)\b/.test(line.text) || /\bfunction\b|\bconst\b|\bclass\b|rawclaw|handler|on[A-Z]/i.test(line.text)))
        .slice(0, 12),
    };
  }

  async searchProject(projectId: string, query: string, limit = 20): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const root = await this.ensureProjectRoot(detail.project);
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      const indexMetadata = this.normalizeIndexMetadata(detail.project.metadata || {});
      return {
        query,
        results: [],
        indexFreshness: indexMetadata.lastIndexedAt || indexMetadata.latestIndexableChangeAt || new Date().toISOString(),
        isIndexStale: this.isIndexMetadataStale(indexMetadata),
      };
    }
    const tree = await this.buildProjectFileTreeRecursive(root, root);
    const filePaths = this.flattenFileTree(tree).slice(0, 500);
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const results: Array<{ sourceType: string; title: string; path: string; line?: number | null; snippet: string; score: number }> = [];

    for (const filePath of filePaths) {
      const absolute = this.safeProjectPath(detail.project, filePath);
      const content = await fs.readFile(absolute, 'utf8').catch(() => '');
      if (!content) continue;
      const lowerPath = filePath.toLowerCase();
      const pathScore = terms.reduce((score, term) => score + (lowerPath.includes(term) ? 3 : 0), 0);
      const lines = content.split(/\r?\n/);
      let bestLine: { index: number; text: string; score: number } | null = null;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lower = line.toLowerCase();
        const score = terms.reduce((current, term) => current + (lower.includes(term) ? 2 : 0), pathScore);
        if (score > 0 && (!bestLine || score > bestLine.score)) {
          bestLine = { index, text: line.trim(), score };
        }
      }
      if (bestLine || pathScore > 0) {
        results.push({
          sourceType: 'file',
          title: filePath,
          path: filePath,
          line: bestLine ? bestLine.index + 1 : null,
          snippet: bestLine?.text || filePath,
          score: bestLine?.score || pathScore,
        });
      }
    }

    const artifacts: Array<{ sourceType: string; title: string; path: string; line: null; snippet: string; score: number }> = [];
    for (const artifact of detail.artifacts) {
      const haystack = `${artifact.kind} ${artifact.label} ${JSON.stringify(artifact.payload).slice(0, 2000)}`.toLowerCase();
      const score = terms.reduce((current, term) => current + (haystack.includes(term) ? 1 : 0), 0);
      if (score > 0) {
        artifacts.push({
          sourceType: 'artifact',
          title: artifact.label,
          path: artifact.kind,
          line: null,
          snippet: artifact.label,
          score,
        });
      }
    }

    const semanticResults = await this.memoryService.search({
      query,
      collection: this.appBuilderIndexCollection(projectId),
    }).catch(() => []);
    const semanticMatches = semanticResults.map((entry) => ({
      sourceType: 'semantic_index',
      title: entry.source || entry.id,
      path: entry.source || entry.id,
      line: null,
      snippet: entry.preview || entry.content.slice(0, 240),
      score: entry.score + 1,
    }));

    const combined = [...semanticMatches, ...results, ...artifacts]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 50)));
    const indexMetadata = this.normalizeIndexMetadata(detail.project.metadata || {});
    const freshness = indexMetadata.lastIndexedAt || indexMetadata.latestIndexableChangeAt || new Date().toISOString();
    return {
      query,
      results: combined,
      indexFreshness: freshness,
      isIndexStale: this.isIndexMetadataStale(indexMetadata),
      indexGeneration: indexMetadata.indexGeneration,
      lastIndexedGeneration: indexMetadata.lastIndexedGeneration,
      latestIndexableChangeId: indexMetadata.latestIndexableChangeId,
      lastIndexedChangeId: indexMetadata.lastIndexedChangeId,
      lastIndexError: indexMetadata.lastIndexError,
    };
  }

  async listProjectSuggestions(projectId: string): Promise<Record<string, unknown>[]> {
    await this.getProjectDetail(projectId);
    return (await this.listArtifactsByKind<Record<string, unknown>>(projectId, 'project_suggestion', 50))
      .filter((suggestion) => !suggestion.archivedAt)
      .slice(0, 10);
  }

  private normalizeIndexMetadata(metadata: Record<string, unknown>): {
    latestIndexableChangeAt: string | null;
    lastIndexedAt: string | null;
    lastIndexError: string | null;
    indexGeneration: string;
    lastIndexedGeneration: string;
    latestIndexableChangeId: string;
    lastIndexedChangeId: string;
  } {
    const indexGeneration = this.indexCounterString(metadata.indexGeneration, '0');
    const hasLastIndexedGeneration = metadata.lastIndexedGeneration !== undefined || metadata.indexedGeneration !== undefined;
    const lastIndexedGeneration = hasLastIndexedGeneration
      ? this.indexCounterString(metadata.lastIndexedGeneration ?? metadata.indexedGeneration, indexGeneration)
      : indexGeneration;
    const latestIndexableChangeId = this.indexCounterString(metadata.latestIndexableChangeId, '0');
    const hasLastIndexedChangeId = metadata.lastIndexedChangeId !== undefined;
    const lastIndexedChangeId = hasLastIndexedChangeId
      ? this.indexCounterString(metadata.lastIndexedChangeId, latestIndexableChangeId)
      : latestIndexableChangeId;
    return {
      latestIndexableChangeAt: typeof metadata.latestIndexableChangeAt === 'string' ? String(metadata.latestIndexableChangeAt) : null,
      lastIndexedAt: typeof metadata.lastIndexedAt === 'string' ? String(metadata.lastIndexedAt) : null,
      lastIndexError: typeof metadata.lastIndexError === 'string' && metadata.lastIndexError ? String(metadata.lastIndexError) : null,
      indexGeneration,
      lastIndexedGeneration,
      latestIndexableChangeId,
      lastIndexedChangeId,
    };
  }

  private isIndexMetadataStale(metadata: ReturnType<AppBuilderService['normalizeIndexMetadata']>): boolean {
    return Boolean(metadata.lastIndexError)
      || metadata.latestIndexableChangeId !== metadata.lastIndexedChangeId
      || metadata.indexGeneration !== metadata.lastIndexedGeneration;
  }

  private indexCounterString(value: unknown, fallback: string): string {
    try {
      if (value === undefined || value === null || value === '') return fallback;
      const parsed = BigInt(String(value));
      return parsed < 0n ? fallback : parsed.toString();
    } catch {
      return fallback;
    }
  }

  private incrementIndexCounter(value: string): string {
    return (BigInt(value) + 1n).toString();
  }

  private async markProjectIndexableChange(project: AppBuilderProject, reason: string, options?: { incrementGeneration?: boolean }): Promise<void> {
    const now = new Date().toISOString();
    const incrementGeneration = options?.incrementGeneration !== false;
    await this.mutateProjectMetadata(project.id, (metadata) => {
      const normalized = this.normalizeIndexMetadata(metadata);
      return {
        ...metadata,
        latestIndexableChangeAt: now,
        latestIndexableChangeId: this.incrementIndexCounter(normalized.latestIndexableChangeId),
        indexGeneration: incrementGeneration ? this.incrementIndexCounter(normalized.indexGeneration) : normalized.indexGeneration,
        lastIndexedGeneration: normalized.lastIndexedGeneration,
        lastIndexedChangeId: normalized.lastIndexedChangeId,
        lastIndexReason: reason,
      };
    });
    void this.indexProjectForSearch(project.id, 0);
  }

  private appBuilderIndexCollection(projectId: string): string {
    return `app_builder_${projectId}`;
  }

  private appBuilderSuggestionCollection(projectId: string): string {
    return `app_builder_suggestions_${projectId}`;
  }

  private async indexProjectForSearch(projectId: string, attempt = 0): Promise<void> {
    const retryKey = `${projectId}:${attempt}`;
    const existingTimer = this.indexRetryTimers.get(retryKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.indexRetryTimers.delete(retryKey);
    }
    try {
      const detail = await this.getProjectDetail(projectId);
      const indexMetadata = this.normalizeIndexMetadata(detail.project.metadata || {});
      const root = await this.ensureProjectRoot(detail.project);
      const tree = await this.buildProjectFileTreeRecursive(root, root);
      const filePaths = this.flattenFileTree(tree)
        .filter((filePath) => /\.(ts|tsx|js|jsx|json|md|css|html)$/i.test(filePath))
        .slice(0, 120);
      const collection = this.appBuilderIndexCollection(projectId);
      await this.memoryService.clear(collection).catch(() => ({ cleared: 0 }));
      for (const filePath of filePaths) {
        const absolute = this.safeProjectPath(detail.project, filePath);
        const content = await fs.readFile(absolute, 'utf8').catch(() => '');
        if (!content.trim()) continue;
        await this.memoryService.add({
          collection,
          source: `file:${filePath}`,
          tags: ['app_builder', projectId, 'file'],
          content: `${filePath}\n${content.slice(0, 6000)}`,
        });
      }
      for (const artifact of detail.artifacts.slice(0, 50)) {
        await this.memoryService.add({
          collection,
          source: `artifact:${artifact.kind}:${artifact.id}`,
          tags: ['app_builder', projectId, 'artifact', artifact.kind],
          content: `${artifact.label}\n${JSON.stringify(artifact.payload).slice(0, 4000)}`,
        });
      }
      await this.patchProjectMetadata(detail.project, {
        lastIndexedAt: new Date().toISOString(),
        lastIndexError: null,
        lastIndexAttempt: attempt,
        lastIndexedGeneration: indexMetadata.indexGeneration,
        lastIndexedChangeId: indexMetadata.latestIndexableChangeId,
      });
      await this.resolveIndexRetryArtifacts(projectId, indexMetadata.indexGeneration);
      this.clearIndexRetryTimers(projectId);
    } catch (error) {
      const detail = await this.getProjectDetail(projectId).catch(() => null);
      if (detail) {
        const message = error instanceof Error ? error.message : String(error);
        const nextAttemptAt = this.nextIndexRetryAt(attempt);
        await this.patchProjectMetadata(detail.project, {
          lastIndexError: message,
          lastIndexAttempt: attempt,
          lastIndexedGeneration: this.normalizeIndexMetadata(detail.project.metadata || {}).lastIndexedGeneration,
        });
        await this.storeArtifact(projectId, null, 'index_retry', 'activity', `Index retry ${attempt + 1}`, {
          id: `index-retry-${randomUUID()}`,
          projectId,
          attempt,
          indexGeneration: this.normalizeIndexMetadata(detail.project.metadata || {}).indexGeneration,
          error: message,
          nextAttemptAt,
          createdAt: new Date().toISOString(),
        }).catch(() => undefined);
        if (nextAttemptAt) {
          this.scheduleIndexRetryAt(projectId, attempt + 1, nextAttemptAt);
        }
      }
    }
  }

  private async restorePendingIndexRetries(): Promise<void> {
    const rows = await this.prisma.$queryRawUnsafe<ArtifactRow[]>(
      `SELECT id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt
         FROM app_builder_artifacts
        WHERE kind = ?
        ORDER BY createdAt DESC
        LIMIT 200`,
      'index_retry',
    ).catch((error) => {
      this.logger.warn(`Unable to restore App Builder index retries: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    const latestByProject = new Map<string, { artifactId: string; projectId: string; attempt: number; nextAttemptAt: string; createdAtMs: number; indexGeneration: unknown }>();
    const seenProjects = new Set<string>();
    for (const row of rows) {
      const artifact = this.toArtifact(row);
      const payload = artifact.payload as Record<string, unknown>;
      const projectId = String(payload.projectId || artifact.projectId || '');
      if (!projectId || seenProjects.has(projectId)) continue;
      seenProjects.add(projectId);
      const attempt = Number(payload.attempt ?? -1);
      const nextAttemptAt = typeof payload.nextAttemptAt === 'string' ? payload.nextAttemptAt : null;
      if (!Number.isFinite(attempt) || attempt < 0 || !nextAttemptAt) continue;
      const createdAtRaw = new Date(artifact.createdAt).getTime();
      const createdAtMs = Number.isFinite(createdAtRaw) ? createdAtRaw : 0;
      if (Date.now() - createdAtMs > 24 * 60 * 60 * 1000) {
        await this.updateArtifactPayload(artifact.id, {
          ...payload,
          status: 'expired',
          expiredAt: new Date().toISOString(),
          expireReason: 'older_than_24h',
        }).catch(() => undefined);
        continue;
      }
      const current = latestByProject.get(projectId);
      if (!current || createdAtMs > current.createdAtMs) {
        latestByProject.set(projectId, { artifactId: artifact.id, projectId, attempt, nextAttemptAt, createdAtMs, indexGeneration: payload.indexGeneration });
      }
    }
    for (const retry of latestByProject.values()) {
      const detail = await this.getProjectDetail(retry.projectId).catch(() => null);
      if (!detail?.project.metadata?.lastIndexError) continue;
      const indexMetadata = this.normalizeIndexMetadata(detail.project.metadata || {});
      if (this.indexCounterString(retry.indexGeneration, '0') !== indexMetadata.indexGeneration) {
        await this.updateArtifactPayload(retry.artifactId, {
          status: 'expired',
          projectId: retry.projectId,
          attempt: retry.attempt,
          nextAttemptAt: retry.nextAttemptAt,
          indexGeneration: retry.indexGeneration,
          expiredAt: new Date().toISOString(),
          expireReason: 'index_generation_mismatch',
          currentIndexGeneration: indexMetadata.indexGeneration,
        }).catch(() => undefined);
        continue;
      }
      const nextAttempt = retry.attempt + 1;
      if (nextAttempt > 5) continue;
      this.scheduleIndexRetryAt(retry.projectId, nextAttempt, retry.nextAttemptAt);
    }
  }

  private async resolveIndexRetryArtifacts(projectId: string, indexGeneration: unknown): Promise<void> {
    const records = await this.listArtifactRecordsByKind(projectId, 'index_retry', 50).catch(() => []);
    const normalizedGeneration = this.indexCounterString(indexGeneration, '0');
    for (const record of records) {
      const payload = record.payload as Record<string, unknown>;
      if (payload.status === 'resolved' || payload.status === 'expired') continue;
      if (payload.indexGeneration !== undefined && this.indexCounterString(payload.indexGeneration, '0') !== normalizedGeneration) continue;
      await this.updateArtifactPayload(record.id, {
        ...payload,
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }

  private nextIndexRetryAt(attempt: number): string | null {
    const delays = [5_000, 15_000, 45_000, 120_000, 300_000];
    const delay = delays[attempt];
    return delay === undefined ? null : new Date(Date.now() + delay).toISOString();
  }

  private clearIndexRetryTimers(projectId: string): void {
    for (const [key, timer] of this.indexRetryTimers.entries()) {
      if (!key.startsWith(`${projectId}:`)) continue;
      clearTimeout(timer);
      this.indexRetryTimers.delete(key);
    }
  }

  private scheduleIndexRetryAt(projectId: string, nextAttempt: number, nextAttemptAt: string): void {
    const runAtMs = new Date(nextAttemptAt).getTime();
    const delay = Number.isFinite(runAtMs) ? Math.max(0, runAtMs - Date.now()) : 0;
    this.scheduleIndexRetry(projectId, nextAttempt, delay);
  }

  private scheduleIndexRetry(projectId: string, nextAttempt: number, delayOverrideMs?: number): void {
    const delays = [5_000, 15_000, 45_000, 120_000, 300_000];
    const delay = delayOverrideMs ?? delays[nextAttempt - 1];
    if (delay === undefined) return;
    const key = `${projectId}:${nextAttempt}`;
    const existing = this.indexRetryTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.indexRetryTimers.delete(key);
      void this.indexProjectForSearch(projectId, nextAttempt);
    }, delay);
    this.indexRetryTimers.set(key, timer);
  }

  async createProjectUpload(projectId: string, payload: {
    kind: 'image' | 'document' | 'code_reference';
    filename: string;
    mimeType?: string | null;
    contentBase64: string;
    selectedForContext?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.persistProjectUpload(projectId, {
      kind: payload.kind,
      filename: payload.filename,
      mimeType: payload.mimeType || null,
      selectedForContext: payload.selectedForContext,
      bytes: Buffer.from(payload.contentBase64 || '', 'base64'),
    });
  }

  async createProjectMultipartUpload(projectId: string, payload: {
    kind?: 'image' | 'document' | 'code_reference' | null;
    selectedForContext?: boolean;
    file?: {
      originalname?: string;
      mimetype?: string;
      size?: number;
      buffer?: Buffer;
    } | null;
  }): Promise<Record<string, unknown>> {
    if (!payload.file?.buffer) {
      throw new BadRequestException('Multipart upload requires a file field named "file".');
    }
    const filename = payload.file.originalname || `upload-${Date.now()}`;
    return this.persistProjectUpload(projectId, {
      kind: payload.kind || this.inferUploadKind(filename, payload.file.mimetype || null),
      filename,
      mimeType: payload.file.mimetype || null,
      selectedForContext: payload.selectedForContext,
      bytes: payload.file.buffer,
    });
  }

  async createProjectMultipartUploadStream(projectId: string, req: any): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const managedPath = await this.ensureProjectRoot(project);
    const uploadId = `upload-${randomUUID()}`;
    const tmpDir = this.securePaths.resolveInside(managedPath, path.join('.app-builder', 'uploads', '.tmp', uploadId));
    await fs.mkdir(tmpDir, { recursive: true });
    const workspaceId = project.workspaceId || project.id;
    const contentLength = Number(req.headers?.['content-length'] || 0);
    const hasContentLength = Number.isFinite(contentLength) && contentLength > 0;
    let heartbeat: NodeJS.Timeout | null = null;
    let tempFilePath: string | null = null;
    let filename = `upload-${Date.now()}`;
    let mimeType: string | null = null;
    let kind: 'image' | 'document' | 'code_reference' | null = null;
    let selectedForContext = true;
    let receivedBytes = 0;
    let fileSeen = false;
    let fileLimitReached = false;
    try {
      if (hasContentLength) {
        await this.reserveUploadStorage(workspaceId, uploadId, contentLength);
      }
      heartbeat = setInterval(() => {
        void this.extendUploadStorageReservation(workspaceId, uploadId).catch(() => undefined);
      }, Math.max(10_000, Math.floor(this.appBuilderConfig.values.uploadReservationTtlMs / 3)));

      const Busboy = require('busboy');
      const busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: this.appBuilderConfig.values.chunkedUploadLimitBytes },
      });
      let filePromise: Promise<void> | null = null;
      const finished = new Promise<void>((resolve, reject) => {
        busboy.on('field', (name: string, value: string) => {
          if (name === 'kind' && ['image', 'document', 'code_reference'].includes(value)) {
            kind = value as 'image' | 'document' | 'code_reference';
          }
          if (name === 'selectedForContext') {
            selectedForContext = value !== 'false';
          }
        });
        busboy.on('file', (_name: string, file: any, info: { filename?: string; mimeType?: string; mime?: string }) => {
          fileSeen = true;
          filename = this.safeUploadFilename(info.filename || filename);
          mimeType = info.mimeType || info.mime || null;
          tempFilePath = this.securePaths.resolveInside(tmpDir, filename);
          file.on?.('limit', () => {
            fileLimitReached = true;
          });
          filePromise = (async () => {
            const writer = createWriteStream(tempFilePath!);
            try {
              for await (const chunk of file as AsyncIterable<Buffer>) {
                receivedBytes += chunk.length;
                if (receivedBytes > this.appBuilderConfig.values.chunkedUploadLimitBytes) {
                  throw new BadRequestException({
                    code: 'upload_too_large',
                    message: 'Upload exceeds the v1 chunked upload limit.',
                    limitBytes: this.appBuilderConfig.values.chunkedUploadLimitBytes,
                  });
                }
                if (!hasContentLength) {
                  await this.reserveUploadStorage(workspaceId, uploadId, chunk.length);
                }
                await new Promise<void>((writeResolve, writeReject) => {
                  writer.write(chunk, (error) => error ? writeReject(error) : writeResolve());
                });
              }
              if (fileLimitReached || file.truncated) {
                throw new BadRequestException({
                  code: 'upload_too_large',
                  message: 'Upload exceeds the v1 chunked upload limit.',
                  limitBytes: this.appBuilderConfig.values.chunkedUploadLimitBytes,
                });
              }
            } finally {
              await new Promise<void>((writeResolve) => writer.end(writeResolve));
            }
          })();
        });
        busboy.on('error', reject);
        busboy.on('finish', () => resolve());
      });
      req.pipe(busboy);
      await finished;
      if (filePromise) await filePromise;
      if (!fileSeen || !tempFilePath) {
        throw new BadRequestException('Multipart upload requires a file field named "file".');
      }
      const bytes = await fs.readFile(tempFilePath);
      const result = await this.persistProjectUpload(projectId, {
        kind: kind || this.inferUploadKind(filename, mimeType),
        filename,
        mimeType,
        selectedForContext,
        bytes,
        skipStorageReservation: true,
      });
      await this.releaseUploadStorageReservation(workspaceId, uploadId);
      return result;
    } catch (error) {
      await this.releaseUploadStorageReservation(workspaceId, uploadId).catch(() => undefined);
      throw error;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async persistProjectUpload(projectId: string, payload: {
    kind: 'image' | 'document' | 'code_reference';
    filename: string;
    mimeType?: string | null;
    bytes: Buffer;
    selectedForContext?: boolean;
    skipStorageReservation?: boolean;
  }): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const managedPath = await this.ensureProjectRoot(project);
    const bytes = payload.bytes;
    if (!bytes.length) {
      throw new BadRequestException('Upload content is empty.');
    }
    if (bytes.byteLength > this.appBuilderConfig.values.chunkedUploadLimitBytes) {
      throw new BadRequestException({
        code: 'upload_too_large',
        message: 'Upload exceeds the v1 chunked upload limit.',
        limitBytes: this.appBuilderConfig.values.chunkedUploadLimitBytes,
      });
    }
    const uploadId = `upload-${randomUUID()}`;
    if (!payload.skipStorageReservation) {
      await this.reserveUploadStorage(project.workspaceId || project.id, uploadId, bytes.byteLength);
    }
    const safeName = this.safeUploadFilename(payload.filename || `${uploadId}.bin`);
    const uploadRoot = this.securePaths.resolveInside(managedPath, path.join('.app-builder', 'uploads', uploadId));
    const storedPath = this.securePaths.resolveInside(uploadRoot, safeName);
    try {
      await fs.mkdir(uploadRoot, { recursive: true });
      await fs.writeFile(storedPath, bytes);
      const relPath = this.securePaths.relative(managedPath, storedPath);
      const record = {
        id: uploadId,
        projectId,
        kind: payload.kind,
        filename: safeName,
        mimeType: payload.mimeType || this.inferUploadMimeType(safeName),
        sizeBytes: bytes.byteLength,
        path: relPath,
        status: 'stored',
        selectedForContext: payload.selectedForContext !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.storeArtifact(projectId, null, 'upload_record', 'docs', `Upload ${safeName}`, record);
      if (!payload.skipStorageReservation) {
        await this.releaseUploadStorageReservation(project.workspaceId || project.id, uploadId).catch(() => undefined);
      }
      const processing = await this.processUploadRecord(project, record, bytes.toString('utf8'), bytes);
      await this.markProjectIndexableChange(project, 'upload');
      await this.recordActivity(projectId, {
        kind: 'docs',
        status: processing.status === 'blocked' ? 'warning' : 'success',
        title: `Upload processed: ${safeName}`,
        summary: String(processing.summary || 'Upload stored.'),
        metadata: { uploadId, kind: payload.kind, status: processing.status },
      });
      return { upload: record, processing };
    } catch (error) {
      if (!payload.skipStorageReservation) {
        await this.releaseUploadStorageReservation(project.workspaceId || project.id, uploadId).catch(() => undefined);
      }
      throw error;
    }
  }

  private inferUploadKind(filename: string, mimeType?: string | null): 'image' | 'document' | 'code_reference' {
    const ext = path.extname(filename).toLowerCase();
    const type = (mimeType || '').toLowerCase();
    if (type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) return 'image';
    if (['.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.graphql', '.gql'].includes(ext)) return 'code_reference';
    return 'document';
  }

  async listProjectUploads(projectId: string): Promise<Record<string, unknown>[]> {
    await this.getProjectDetail(projectId);
    return this.listArtifactsByKind<Record<string, unknown>>(projectId, 'upload_record', 100);
  }

  async deleteProjectUpload(projectId: string, uploadId: string): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const uploads = await this.listArtifactsByKind<Record<string, unknown>>(projectId, 'upload_record', 200);
    const upload = uploads.find((entry) => entry.id === uploadId);
    if (!upload) {
      throw new NotFoundException(`Upload ${uploadId} not found.`);
    }
    const managedPath = await this.ensureProjectRoot(detail.project);
    const uploadDir = this.securePaths.resolveInside(managedPath, path.join('.app-builder', 'uploads', uploadId));
    await fs.rm(uploadDir, { recursive: true, force: true });
    await this.storeArtifact(projectId, null, 'upload_record', 'docs', `Upload deleted ${uploadId}`, {
      ...upload,
      status: 'deleted',
      deletedAt: new Date().toISOString(),
    });
    return { ok: true, uploadId };
  }

  async reanalyzeProjectUpload(projectId: string, uploadId: string): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    await this.checkUploadProcessingRateLimit(projectId, uploadId, 'reanalyze', 3, 20);
    const uploads = await this.listArtifactsByKind<Record<string, unknown>>(projectId, 'upload_record', 200);
    const upload = uploads.find((entry) => entry.id === uploadId);
    if (!upload) {
      throw new NotFoundException(`Upload ${uploadId} not found.`);
    }
    const managedPath = await this.ensureProjectRoot(detail.project);
    const absolute = this.securePaths.resolveInside(managedPath, String(upload.path || ''));
    const bytes = existsSync(absolute) ? await fs.readFile(absolute) : Buffer.alloc(0);
    const processing = await this.processUploadRecord(detail.project, upload, bytes.toString('utf8'), bytes);
    return { uploadId, processing };
  }

  async updateUploadLanguage(projectId: string, uploadId: string, language: string): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    await this.checkUploadProcessingRateLimit(projectId, uploadId, 'language', 10, 30);
    const uploads = await this.listArtifactsByKind<Record<string, unknown>>(projectId, 'upload_record', 200);
    const upload = uploads.find((entry) => entry.id === uploadId);
    if (!upload) {
      throw new NotFoundException(`Upload ${uploadId} not found.`);
    }
    const managedPath = await this.ensureProjectRoot(detail.project);
    const absolute = this.securePaths.resolveInside(managedPath, String(upload.path || ''));
    const bytes = existsSync(absolute) ? await fs.readFile(absolute) : Buffer.alloc(0);
    const processing = await this.processUploadRecord(detail.project, upload, bytes.toString('utf8'), bytes, {
      confirmedLanguage: language,
      languageConfirmedBy: 'local-owner',
    });
    await this.markProjectIndexableChange(detail.project, 'upload_language_correction');
    return { uploadId, language, processing };
  }

  private async checkUploadProcessingRateLimit(
    projectId: string,
    uploadId: string,
    bucket: 'reanalyze' | 'language',
    perUploadLimit: number,
    perProjectLimit: number,
  ): Promise<void> {
    const hour = Math.floor(Date.now() / 3_600_000);
    const workspaceId = String((await this.prisma.appBuilderProject.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    }))?.workspaceId || projectId);
    const uploadKey = `app-builder:upload-rate:${bucket}:${workspaceId}:${projectId}:${uploadId}:${hour}`;
    const workspaceKey = `app-builder:upload-rate:${bucket}:${workspaceId}:${hour}`;
    const combinedWorkspaceKey = `app-builder:upload-rate:combined:${workspaceId}:${hour}`;
    const ttlSeconds = 3700;
    const script = `
      local upload = tonumber(redis.call('GET', KEYS[1]) or '0')
      local workspace = tonumber(redis.call('GET', KEYS[2]) or '0')
      local combined = tonumber(redis.call('GET', KEYS[3]) or '0')
      if upload >= tonumber(ARGV[1]) or workspace >= tonumber(ARGV[2]) or combined >= tonumber(ARGV[3]) then
        return 0
      end
      redis.call('SETEX', KEYS[1], tonumber(ARGV[4]), upload + 1)
      redis.call('SETEX', KEYS[2], tonumber(ARGV[4]), workspace + 1)
      redis.call('SETEX', KEYS[3], tonumber(ARGV[4]), combined + 1)
      return 1
    `;
    let allowed: number;
    try {
      allowed = Number(await this.redis.evalScript(script, [uploadKey, workspaceKey, combinedWorkspaceKey], [
        perUploadLimit,
        perProjectLimit,
        35,
        ttlSeconds,
      ]));
    } catch (error) {
      this.logger.warn(`Upload processing rate limit unavailable: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException({
        code: 'upload_rate_limit_unavailable',
        message: 'Upload processing is temporarily unavailable.',
        retryAfterMs: 60_000,
        canRetry: true,
      });
    }
    if (allowed !== 1) {
      throw new ServiceUnavailableException({
        code: 'upload_processing_rate_limited',
        message: 'Upload processing is rate limited. Try again later.',
        retryAfterMs: 60_000,
        canRetry: true,
      });
    }
  }

  private uploadReservationKey(workspaceId: string, uploadId: string): string {
    return `app-builder:upload-storage-reservation:${workspaceId}:${uploadId}`;
  }

  private uploadWorkspaceReservationKey(workspaceId: string): string {
    return `app-builder:upload-storage-reserved:${workspaceId}`;
  }

  private async workspaceCommittedUploadBytes(workspaceId: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ payloadJson: string }>>(
      `SELECT a.payloadJson
         FROM app_builder_artifacts a
         JOIN app_builder_projects p ON p.id = a.projectId
        WHERE p.workspaceId = ? AND a.kind = ?
        ORDER BY a.createdAt ASC`,
      workspaceId,
      'upload_record',
    ).catch(() => [] as Array<{ payloadJson: string }>);
    const latestByUpload = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
        const uploadId = typeof payload.id === 'string' ? payload.id : null;
        if (!uploadId) continue;
        latestByUpload.set(uploadId, payload);
      } catch {
        continue;
      }
    }
    let total = 0;
    for (const upload of latestByUpload.values()) {
      if (upload.status === 'deleted') continue;
      const size = Number(upload.sizeBytes || 0);
      if (Number.isFinite(size) && size > 0) {
        total += size;
      }
    }
    return total;
  }

  private async reserveUploadStorage(workspaceId: string, uploadId: string, addBytes: number): Promise<void> {
    const bytes = Math.max(0, Math.ceil(addBytes));
    if (bytes <= 0) return;
    const committedBytes = await this.workspaceCommittedUploadBytes(workspaceId);
    const ttlSeconds = Math.max(1, Math.ceil(this.appBuilderConfig.values.uploadReservationTtlMs / 1000));
    const script = `
      local upload = tonumber(redis.call('GET', KEYS[1]) or '0')
      local workspace = tonumber(redis.call('GET', KEYS[2]) or '0')
      local add = tonumber(ARGV[1])
      local committed = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local ttl = tonumber(ARGV[4])
      if add < 0 then
        return -1
      end
      if committed + workspace + add > limit then
        return 0
      end
      redis.call('SETEX', KEYS[1], ttl, upload + add)
      redis.call('SETEX', KEYS[2], ttl, workspace + add)
      return 1
    `;
    let allowed: number;
    try {
      allowed = Number(await this.redis.evalScript(script, [
        this.uploadReservationKey(workspaceId, uploadId),
        this.uploadWorkspaceReservationKey(workspaceId),
      ], [
        bytes,
        committedBytes,
        this.appBuilderConfig.values.uploadWorkspaceLimitBytes,
        ttlSeconds,
      ]));
    } catch (error) {
      this.logger.warn(`Upload storage reservation unavailable: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException({
        code: 'upload_rate_limit_unavailable',
        message: 'Upload processing is temporarily unavailable.',
        retryAfterMs: 60_000,
        canRetry: true,
      });
    }
    if (allowed !== 1) {
      throw new BadRequestException({
        code: 'workspace_upload_limit_exceeded',
        message: 'Upload exceeds the workspace storage limit.',
        limitBytes: this.appBuilderConfig.values.uploadWorkspaceLimitBytes,
        canRetry: false,
      });
    }
  }

  private async extendUploadStorageReservation(workspaceId: string, uploadId: string): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil(this.appBuilderConfig.values.uploadReservationTtlMs / 1000));
    const script = `
      if redis.call('EXISTS', KEYS[1]) == 0 then
        return 0
      end
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
      if redis.call('EXISTS', KEYS[2]) == 1 then
        redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1]))
      end
      return 1
    `;
    await this.redis.evalScript(script, [
      this.uploadReservationKey(workspaceId, uploadId),
      this.uploadWorkspaceReservationKey(workspaceId),
    ], [ttlSeconds]);
  }

  private async releaseUploadStorageReservation(workspaceId: string, uploadId: string): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil(this.appBuilderConfig.values.uploadReservationTtlMs / 1000));
    const script = `
      local upload = tonumber(redis.call('GET', KEYS[1]) or '0')
      if upload <= 0 then
        redis.call('DEL', KEYS[1])
        return 0
      end
      local workspace = tonumber(redis.call('GET', KEYS[2]) or '0')
      local nextWorkspace = workspace - upload
      if nextWorkspace <= 0 then
        redis.call('DEL', KEYS[2])
      else
        redis.call('SETEX', KEYS[2], tonumber(ARGV[1]), nextWorkspace)
      end
      redis.call('DEL', KEYS[1])
      return upload
    `;
    await this.redis.evalScript(script, [
      this.uploadReservationKey(workspaceId, uploadId),
      this.uploadWorkspaceReservationKey(workspaceId),
    ], [ttlSeconds]);
  }

  private safeUploadFilename(filename: string): string {
    return path.basename(filename).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160) || `upload-${randomUUID()}.bin`;
  }

  private inferUploadMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === '.json') return 'application/json';
    if (ext === '.yml' || ext === '.yaml') return 'application/yaml';
    return 'text/plain';
  }

  private async processUploadRecord(
    project: AppBuilderProject,
    upload: Record<string, unknown>,
    textContent: string,
    bytes: Buffer = Buffer.from(textContent),
    options: { confirmedLanguage?: string | null; languageConfirmedBy?: string | null } = {},
  ): Promise<Record<string, unknown>> {
    const kind = String(upload.kind || '');
    const filename = String(upload.filename || 'upload');
    const uploadId = String(upload.id || randomUUID());
    const mimeType = String(upload.mimeType || this.inferUploadMimeType(filename));
    if (kind === 'image') {
      const extraction = await this.documentProcessor.extractText(bytes, mimeType);
      const ready = Boolean(extraction.text?.trim());
      const recommendedAction = ready
        ? null
        : 'Configure a vision-capable analysis route, then reanalyze this image before using it as generation context.';
      const artifact = {
        id: `reference-image-${uploadId}`,
        uploadId,
        filename,
        status: ready ? 'ready' : 'analysis_pending_unavailable',
        summary: ready
          ? extraction.text.trim().slice(0, 1200)
          : (extraction.error || 'Image stored. Vision/OCR analysis is pending until a vision route is available.'),
        analysisMethod: extraction.method,
        extractedText: extraction.text || '',
        includedInContext: ready,
        recommendedAction,
        createdAt: new Date().toISOString(),
      };
      await this.storeArtifact(project.id, null, 'reference_image', 'docs', `Reference image ${filename}`, artifact);
      return { status: artifact.status, summary: artifact.summary, artifact };
    }
    if (kind === 'document') {
      const ext = path.extname(filename).toLowerCase();
      const extraction = ext === '.pdf' || ext === '.docx'
        ? await this.documentProcessor.extractText(bytes, mimeType)
        : null;
      const extractedText = extraction?.text?.trim()
        || (ext === '.txt' || ext === '.md' ? textContent : '')
        || '';
      const status = extraction?.status
        || (extractedText
          ? 'ready'
        : ext === '.pdf' && extraction?.error
          ? 'ocr_required_unsupported'
          : ext === '.docx'
            ? 'extraction_pending'
            : 'ready');
      const summaryText = (extractedText || textContent).replace(/\s+/g, ' ').trim().slice(0, 1200);
      const language = options.confirmedLanguage || await this.detectDocumentLanguage(summaryText);
      const finalStatus = !options.confirmedLanguage && status === 'ready' && language === 'language_review_required'
        ? 'language_review_required'
        : status;
      const recommendedAction = finalStatus === 'ocr_required_unsupported'
        ? 'Upload a text-based PDF, TXT, or MD version; OCR for scanned PDFs is not available in v1.'
        : finalStatus === 'partial_extraction'
          ? 'Some DOCX content was extracted with warnings; review before using it as context.'
          : finalStatus === 'blocked_needs_unlocked_file'
            ? 'Upload an unlocked DOCX/PDF file before this document can be used.'
            : finalStatus === 'blocked_corrupt_file'
              ? 'Upload a readable replacement file; this document could not be extracted.'
              : finalStatus === 'too_large'
                ? 'Upload a smaller DOCX file or split the requirements into multiple documents.'
                : finalStatus === 'extraction_pending'
                  ? 'DOCX rich extraction is pending; upload TXT, MD, or PDF if this must be used immediately.'
          : finalStatus === 'language_review_required'
            ? 'Confirm the document language before allowing this reference into generation context.'
            : null;
      const artifact = {
        id: `reference-document-${uploadId}`,
        uploadId,
        filename,
        status: finalStatus,
        language,
        extractionMethod: extraction?.method || (ext === '.txt' || ext === '.md' ? 'plain_text' : 'pending'),
        extractionError: extraction?.error || null,
        processingWarnings: extraction?.warnings || [],
        summary: summaryText || 'Document stored for future planning context.',
        requirementBullets: summaryText ? summaryText.split(/[.!?]\s+/).filter(Boolean).slice(0, 8) : [],
        includedInContext: finalStatus === 'ready' || finalStatus === 'partial_extraction',
        recommendedAction,
        version: Date.now(),
        languageConfirmedBy: options.confirmedLanguage ? options.languageConfirmedBy || 'local-owner' : null,
        languageConfirmedAt: options.confirmedLanguage ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
      };
      await this.storeArtifact(project.id, null, 'reference_document', 'docs', `Reference document ${filename}`, artifact);
      return { status: finalStatus, summary: finalStatus === 'ready' ? 'Document text was extracted for reference context.' : String(recommendedAction || artifact.extractionError || 'Document stored; rich extraction is pending.'), artifact };
    }
    if (kind === 'code_reference') {
      const securityScan = this.contentSecurity.scan([{ path: filename, content: textContent }], uploadId);
      if (securityScan.status === 'blocked') {
        await this.storeArtifact(project.id, null, 'security_scan', 'validation', `Upload security scan ${filename}`, securityScan);
        return { status: 'blocked', summary: 'Code reference was blocked by the security scanner.', securityScan };
      }
      const exports = Array.from(textContent.matchAll(/\bexport\s+(?:type\s+|interface\s+|class\s+|function\s+|const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)/g)).map((match) => match[1]);
      const imports = Array.from(textContent.matchAll(/\bimport\s+[^'"]+['"]([^'"]+)['"]/g)).map((match) => match[1]);
      const unresolvedSymbols = imports.filter((entry) => entry.startsWith('.') || entry.startsWith('@'));
      const partial = unresolvedSymbols.length > 5 || (exports.length > 0 && unresolvedSymbols.length / Math.max(exports.length, 1) > 0.25);
      const artifact = {
        id: `reference-code-${uploadId}`,
        uploadId,
        filename,
        status: partial ? 'partial_contract' : 'ready',
        exports,
        imports,
        unresolvedSymbols,
        warnings: partial ? ['High unresolved symbol count; include explicitly before scaffold use.'] : [],
        recommendedAction: partial ? 'Review unresolved imports and explicitly select this partial contract before using it for scaffold generation.' : null,
        createdAt: new Date().toISOString(),
      };
      await this.storeArtifact(project.id, null, 'reference_code', 'codegen', `Reference code ${filename}`, artifact);
      return { status: artifact.status, summary: partial ? 'Code reference stored as a partial contract.' : 'Code reference contract extracted.', artifact };
    }
    return { status: 'stored', summary: 'Upload stored.' };
  }

  private async detectDocumentLanguage(text: string): Promise<string> {
    if (!text || text.length < 120) return 'unknown';
    try {
      const mod = await import('franc-min');
      const detected = mod.franc(text, { minLength: 120 });
      if (!detected || detected === 'und') return 'language_review_required';
      return detected === 'eng' ? 'en' : detected;
    } catch {
      // Fall back to a conservative ASCII/non-ASCII split if the detector is unavailable.
    }
    return /[^\u0000-\u007f]/.test(text) ? 'language_review_required' : 'en';
  }

  private flattenFileTree(nodes: WorkspaceFileNode[]): string[] {
    return nodes.flatMap((node) => node.type === 'file' ? [node.path] : this.flattenFileTree(node.children || []));
  }

  async getProjectBible(projectId: string): Promise<ProjectBibleDocument[]> {
    const artifact = await this.latestArtifact<{ docs: ProjectBibleDocument[] }>(projectId, 'project_bible');
    return artifact?.docs || [];
  }

  async getProjectTaskList(projectId: string): Promise<AppBuilderTaskList | null> {
    return this.latestArtifact<AppBuilderTaskList>(projectId, 'task_list');
  }

  private async loadTerminalSession(project: AppBuilderProject): Promise<TerminalSessionRecord> {
    const current = await this.redis.getJson<TerminalSessionRecord>(this.terminalSessionKey(project.id));
    if (current) {
      return this.reconcileTerminalSession(project, current);
    }
    const artifact = await this.latestArtifact<TerminalSessionRecord>(project.id, 'terminal_session');
    if (artifact) {
      const reconciled = await this.reconcileTerminalSession(project, artifact);
      await this.redis.setJson(this.terminalSessionKey(project.id), reconciled);
      return reconciled;
    }
    const cwd = await this.ensureProjectRoot(project);
    const created: TerminalSessionRecord = {
      id: `terminal:${project.id}`,
      projectId: project.id,
      cwd,
      status: 'idle',
      shared: true,
      activeCommandId: null,
      previewUrl: typeof project.metadata?.previewUrl === 'string' ? String(project.metadata.previewUrl) : null,
      previewPort: typeof project.metadata?.previewPort === 'number' ? Number(project.metadata.previewPort) : null,
      lastCommandAt: null,
      commands: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.terminalSessionKey(project.id), created);
    await this.storeArtifact(project.id, null, 'terminal_session', 'terminal', 'Shared terminal session', created);
    return created;
  }

  private async saveTerminalSession(projectId: string, session: TerminalSessionRecord): Promise<TerminalSessionRecord> {
    const next = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.setJson(this.terminalSessionKey(projectId), next);
    await this.storeArtifact(projectId, null, 'terminal_session', 'terminal', 'Shared terminal session', next);
    return next;
  }

  private async findOpenPort(start: number): Promise<number> {
    for (let port = start; port < start + 40; port += 1) {
      const available = await new Promise<boolean>((resolve) => {
        const server = require('net').createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '127.0.0.1');
      });
      if (available) return port;
    }
    throw new Error('No open port is available for Builder preview.');
  }

  private isPreviewableDevCommand(command: string): boolean {
    const normalized = command.trim();
    return /(^|\s)(npm\s+run\s+dev|pnpm\s+dev|yarn\s+dev)(\s|$)/i.test(normalized)
      || /\bvite\b/i.test(normalized)
      || /python\s+-m\s+http\.server/i.test(normalized);
  }

  private prepareTerminalCommand(command: string, registerPreview?: boolean): { command: string; previewUrl?: string | null; previewPort?: number | null } | Promise<{ command: string; previewUrl?: string | null; previewPort?: number | null }> {
    const normalized = command.trim();
    const previewable = this.isPreviewableDevCommand(normalized);
    if (!registerPreview && !previewable) {
      return { command, previewUrl: null, previewPort: null };
    }
    return this.findOpenPort(5275).then((port) => {
      if (/npm\s+run\s+dev/i.test(normalized) && !/--port\s+\d+/i.test(normalized)) {
        return {
          command: `${normalized} -- --host 127.0.0.1 --port ${port}`,
          previewUrl: `http://127.0.0.1:${port}`,
          previewPort: port,
        };
      }
      if (/\bvite\b/i.test(normalized) && !/--port\s+\d+/i.test(normalized)) {
        return {
          command: `${normalized} --host 127.0.0.1 --port ${port}`,
          previewUrl: `http://127.0.0.1:${port}`,
          previewPort: port,
        };
      }
      if (/python\s+-m\s+http\.server/i.test(normalized) && !/\bhttp\.server\s+\d+/i.test(normalized)) {
        return {
          command: `${normalized} ${port} --bind 127.0.0.1`,
          previewUrl: `http://127.0.0.1:${port}`,
          previewPort: port,
        };
      }
      return {
        command: normalized,
        previewUrl: `http://127.0.0.1:${port}`,
        previewPort: port,
      };
    });
  }

  async getTerminalSession(projectId: string): Promise<TerminalSessionRecord | null> {
    const detail = await this.getProjectDetail(projectId);
    return this.loadTerminalSession(detail.project);
  }

  async startTerminalSession(projectId: string): Promise<TerminalSessionRecord> {
    const detail = await this.getProjectDetail(projectId);
    const session = await this.loadTerminalSession(detail.project);
    const next = await this.saveTerminalSession(projectId, {
      ...session,
      cwd: await this.ensureProjectRoot(detail.project),
      status: 'idle',
    });
    await this.recordActivity(projectId, {
      kind: 'terminal',
      status: 'success',
      title: 'Terminal ready',
      summary: `Shared terminal session opened in ${next.cwd}.`,
    });
    return next;
  }

  async submitTerminalCommand(
    projectId: string,
    payload: { command: string; requestedBy?: string | null; background?: boolean; registerPreview?: boolean },
  ): Promise<TerminalSessionRecord> {
    const detail = await this.getProjectDetail(projectId);
    const project = detail.project;
    const session = await this.loadTerminalSession(project);
    const requestedBy = payload.requestedBy || 'builder-user';
    const originalCommand = payload.command.trim();
    if (!originalCommand) {
      return session;
    }
    if (/^cd\s+/i.test(originalCommand)) {
      const target = originalCommand.replace(/^cd\s+/i, '').trim();
      const nextCwd = this.safeProjectPath(project, target);
      const commandEntry: TerminalCommandRecord = {
        id: randomUUID(),
        sessionId: session.id,
        command: originalCommand,
        status: 'completed',
        background: false,
        cwd: session.cwd,
        requestedBy,
        output: `Changed directory to ${nextCwd}`,
        exitCode: 0,
        previewUrl: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = await this.saveTerminalSession(projectId, {
        ...session,
        cwd: nextCwd,
        status: 'idle',
        lastCommandAt: new Date().toISOString(),
        commands: [commandEntry, ...session.commands].slice(0, 40),
      });
      await this.recordActivity(projectId, {
        kind: 'terminal',
        status: 'info',
        title: 'Terminal directory changed',
        summary: `Session moved to ${nextCwd}.`,
      });
      return next;
    }

    const prepared = await this.prepareTerminalCommand(originalCommand, payload.registerPreview);
    const commandToExecute = this.maybeBootstrapNodeDependencies(session.cwd, prepared.command);
    const now = new Date().toISOString();
    const commandRecord: TerminalCommandRecord = {
      id: randomUUID(),
      sessionId: session.id,
      command: commandToExecute,
      status: 'running',
      background: Boolean(payload.background),
      cwd: session.cwd,
      requestedBy,
      output: '',
      exitCode: null,
      previewUrl: prepared.previewUrl || null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    let nextSession = await this.saveTerminalSession(projectId, {
      ...session,
      status: 'running',
      activeCommandId: commandRecord.id,
      previewUrl: prepared.previewUrl || session.previewUrl || null,
      previewPort: prepared.previewPort || session.previewPort || null,
      lastCommandAt: now,
      commands: [commandRecord, ...session.commands].slice(0, 40),
    });

    await this.recordActivity(projectId, {
      kind: 'terminal',
      status: 'working',
      title: 'Terminal command started',
      summary: commandToExecute,
      metadata: { requestedBy, background: Boolean(payload.background) },
    });

    const child = spawn('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-Command', commandToExecute], {
      cwd: session.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.terminalProcesses.set(commandRecord.id, child);
    let output = '';
    const applyOutput = async (status: TerminalCommandRecord['status'], exitCode: number | null, finished = false) => {
      const currentSession = await this.loadTerminalSession(project);
      const detectedPreview = this.detectPreviewFromOutput(output);
      const commands: TerminalCommandRecord[] = currentSession.commands.map((entry) => entry.id === commandRecord.id ? {
          ...entry,
          status,
          output,
          exitCode,
          previewUrl: status === 'cancelled' ? null : detectedPreview?.url || entry.previewUrl || null,
          updatedAt: new Date().toISOString(),
          finishedAt: finished ? new Date().toISOString() : entry.finishedAt || null,
        } : entry);
      const current = commands.find((entry) => entry.id === commandRecord.id) || commandRecord;
      const statusLabel: TerminalSessionRecord['status'] = finished
        ? status === 'completed'
          ? 'idle'
          : status === 'cancelled'
            ? 'stopped'
            : 'error'
        : 'running';
      nextSession = await this.saveTerminalSession(projectId, {
        ...currentSession,
        status: statusLabel,
        activeCommandId: finished ? null : currentSession.activeCommandId,
        previewUrl: status === 'cancelled' ? null : detectedPreview?.url || current.previewUrl || currentSession.previewUrl || null,
        previewPort: status === 'cancelled'
          ? null
          : detectedPreview?.port || (current.previewUrl ? Number(new URL(current.previewUrl).port || currentSession.previewPort || 0) || currentSession.previewPort || null : currentSession.previewPort || null),
        commands,
      });
      if (status !== 'cancelled' && (detectedPreview?.url || current.previewUrl)) {
        await this.patchProjectMetadata(project, {
          previewUrl: detectedPreview?.url || current.previewUrl,
          previewPort: nextSession.previewPort,
          previewSource: 'terminal',
          previewUpdatedAt: new Date().toISOString(),
        });
      }
    };

    child.stdout.on('data', (chunk) => {
      output += this.cleanTerminalChunk(chunk.toString());
      void applyOutput('running', null, false);
    });
    child.stderr.on('data', (chunk) => {
      output += this.cleanTerminalChunk(chunk.toString());
      void applyOutput('running', null, false);
    });
    child.on('close', (code) => {
      this.terminalProcesses.delete(commandRecord.id);
      const cancelled = this.stoppedTerminalCommands.has(commandRecord.id);
      if (cancelled) {
        this.stoppedTerminalCommands.delete(commandRecord.id);
      }
      void applyOutput(cancelled ? 'cancelled' : code === 0 ? 'completed' : 'failed', code, true);
      void this.recordActivity(projectId, {
        kind: 'terminal',
        status: cancelled ? 'warning' : code === 0 ? 'success' : 'warning',
        title: cancelled ? 'Terminal command stopped' : 'Terminal command finished',
        summary: cancelled
          ? `${commandToExecute} was stopped from the shared terminal.`
          : `${commandToExecute} ${code === 0 ? 'completed successfully' : `failed with exit code ${code}`}.`,
      });
    });
    child.on('error', (error) => {
      output += error.message;
      this.terminalProcesses.delete(commandRecord.id);
      void applyOutput('failed', null, true);
    });

    if (!payload.background) {
      while (true) {
        const current = await this.loadTerminalSession(project);
        const active = current.commands.find((entry) => entry.id === commandRecord.id);
        if (!active || active.status !== 'running') {
          return current;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }

    return nextSession;
  }

  async stopTerminalSession(projectId: string): Promise<TerminalSessionRecord | null> {
    const detail = await this.getProjectDetail(projectId);
    const session = await this.loadTerminalSession(detail.project);
    const activeCommandId = session.activeCommandId || session.commands.find((command) => command.status === 'running')?.id || null;
    const targetCommand = activeCommandId ? session.commands.find((command) => command.id === activeCommandId) || null : null;
    const targetPort =
      session.previewPort
      || (targetCommand?.previewUrl ? Number(new URL(targetCommand.previewUrl).port || 0) || null : null);
    if (activeCommandId) {
      const child = this.terminalProcesses.get(activeCommandId);
      if (child) {
        this.stoppedTerminalCommands.add(activeCommandId);
        await this.killTerminalProcessTree(child);
        this.terminalProcesses.delete(activeCommandId);
      } else if (targetPort && targetPort >= 5275) {
        await this.killProcessListeningOnPort(targetPort);
      }
    }
    const next = await this.saveTerminalSession(projectId, {
      ...session,
      status: 'stopped',
      activeCommandId: null,
      previewUrl: null,
      previewPort: null,
      commands: session.commands.map((command) => command.id === activeCommandId
        ? {
            ...command,
            status: 'cancelled',
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            previewUrl: null,
          }
        : command),
    });
    await this.patchProjectMetadata(detail.project, {
      previewUrl: null,
      previewPort: null,
      previewSource: null,
      previewUpdatedAt: new Date().toISOString(),
    });
    await this.recordActivity(projectId, {
      kind: 'terminal',
      status: 'warning',
      title: 'Terminal stopped',
      summary: 'Shared terminal session was stopped.',
    });
    return next;
  }

  private shouldCapturePromptInBrief(message: string): boolean {
    const trimmed = message.trim();
    if (!trimmed) return false;
    if (this.classifyCommandLikePrompt(trimmed)) {
      return false;
    }
    if (/^(hi|hello|hey|thanks|thank you|ok|okay|cool|nice)$/i.test(trimmed)) {
      return false;
    }
    return trimmed.length >= 12 || /\b(build|create|generate|make|import|adapt|wrap|app|tool|dashboard|workflow|screen|feature)\b/i.test(trimmed);
  }

  private classifyCommandLikePrompt(message: string): boolean {
    const normalized = message.trim().replace(/\s+/g, ' ');
    if (/\bapprove( this project| deploy gate| the gate)?\b/i.test(normalized)) {
      return true;
    }
    const startIntent = this.shouldStartDraftExecution(normalized);
    if (startIntent.shouldStart) {
      return true;
    }
    return !!this.inferPhaseIntent(normalized) && normalized.split(' ').filter(Boolean).length <= 16;
  }

  private classifyPostBuildEditRequest(message: string, detail: AppBuilderProjectDetail): {
    shouldStageEdit: boolean;
    confidence: number;
    targetedPaths: string[];
  } {
    if (!detail.project.managedPath || detail.project.status === 'draft') {
      return { shouldStageEdit: false, confidence: 0, targetedPaths: [] };
    }
    const normalized = message.trim().toLowerCase();
    const asksForChange = /\b(make|change|update|fix|add|remove|rename|wire|connect|style|color|layout|button|route|handler|event|test|filter|search|upload|sort|pagination|error)\b/.test(normalized);
    const asksForChat = /\b(explain|why|how does|what does|where is|show me|tell me)\b/.test(normalized);
    if (!asksForChange || asksForChat) {
      return { shouldStageEdit: false, confidence: asksForChange ? 0.45 : 0, targetedPaths: [] };
    }
    const targets = new Set<string>(['src/App.tsx']);
    if (/\b(style|color|layout|spacing|responsive|mobile|css|font)\b/.test(normalized)) targets.add('src/styles.css');
    if (/\b(rawclaw|sdk|command|handler|event|manifest|capability)\b/.test(normalized)) {
      targets.add('src/rawclaw-sdk.ts');
      targets.add('rawclaw.app.manifest.json');
      targets.add('src/rawclaw-contract.test.ts');
    }
    if (/\b(test|coverage|spec)\b/.test(normalized)) {
      targets.add('src/App.test.tsx');
      targets.add('src/rawclaw-contract.test.ts');
    }
    return {
      shouldStageEdit: true,
      confidence: 0.8,
      targetedPaths: Array.from(targets),
    };
  }

  private classifyAssistantTurn(message: string, hasProject: boolean): BuilderTurnClassification {
    const normalized = message.trim().replace(/\s+/g, ' ');
    const approvalIntent = /\bapprove( this project| deploy gate| the gate)?\b/i.test(normalized);

    const stateQueries: Array<{ query: BuilderStateQueryKind; patterns: RegExp[] }> = [
      {
        query: 'progress',
        patterns: [
          /\bwhat(?:'s|s| is)? the progress\b/i,
          /\bprogress of the work\b/i,
          /\bstatus of this project\b/i,
          /\bwhat has been done\b/i,
          /\bwhat is happening now\b/i,
          /\bwhere are we in the build\b/i,
          /\bwhat work is complete\b/i,
        ],
      },
      { query: 'projects', patterns: [/\bwhat projects\b/i, /\bshow projects\b/i, /\blist projects\b/i, /\bprojects we have\b/i] },
      { query: 'templates', patterns: [/\bwhat templates\b/i, /\bshow templates\b/i, /\blist templates\b/i, /\bavailable templates\b/i] },
      { query: 'brief', patterns: [/\bcurrent brief\b/i, /\bshow brief\b/i, /\bwhat is the brief\b/i, /\bwhat's the brief\b/i] },
      { query: 'failed_runs', patterns: [/\bwhat runs failed\b/i, /\bfailed runs\b/i, /\bruns failed\b/i] },
      { query: 'runs', patterns: [/\bshow runs\b/i, /\blist runs\b/i, /\bwhat runs\b/i, /\brecent runs\b/i] },
      { query: 'registry', patterns: [/\bshow registry\b/i, /\bwhat.*registered\b/i, /\bregistered apps\b/i, /\bregistry records\b/i] },
      { query: 'preview', patterns: [/\bshow preview\b/i, /\bpreview status\b/i, /\bpreview url\b/i, /\blive preview\b/i] },
      {
        query: 'usage',
        patterns: [
          /\bhow (do|can|should) i use (the|this) app\b/i,
          /\btell me how to use (the|this) app\b/i,
          /\bwhat does (the|this) app do\b/i,
          /\bhow does (the|this) app work\b/i,
          /\bexplain (the|this) app\b/i,
          /\bwalk me through (the|this) app\b/i,
        ],
      },
    ];

    for (const entry of stateQueries) {
      if (entry.patterns.some((pattern) => pattern.test(normalized))) {
        return { kind: 'state_query', query: entry.query };
      }
    }

    if (approvalIntent) {
      return { kind: 'execution', phase: null, approve: true };
    }

    const startIntent = this.shouldStartDraftExecution(normalized);
    if (!hasProject && startIntent.shouldStart) {
      return { kind: 'execution', phase: startIntent.phase, approve: false };
    }

    if (hasProject) {
      const phaseIntent = this.inferPhaseIntent(normalized);
      if (phaseIntent) {
        return { kind: 'execution', phase: phaseIntent, approve: false };
      }
    }

    return { kind: 'draft_chat' };
  }

  private applyLaneExecution(
    classification: BuilderTurnClassification,
    lane: AppBuilderComposerLane,
    sourceType: AppBuilderSourceType,
  ): BuilderTurnClassification {
    if (classification.kind !== 'draft_chat') {
      return classification;
    }
    if (lane === 'plan') {
      return { kind: 'execution', phase: 'plan', approve: false };
    }
    if (lane === 'build') {
      return {
        kind: 'execution',
        phase: sourceType === 'imported' ? 'adapter-generate' : 'generate',
        approve: false,
      };
    }
    return classification;
  }

  private summarizeBrief(brief: AppBuilderBriefDraft, projectName?: string | null): string {
    const summarizeText = (value: string, max = 220) =>
      value.length <= max ? value : `${value.slice(0, max - 3)}...`;
    return [
      projectName ? `- project: ${projectName}` : null,
      `- workspace: ${brief.workspaceId || 'default'}`,
      `- source: ${brief.sourceType === 'generated' ? 'generated app' : `imported project${brief.sourcePath ? ` from ${brief.sourcePath}` : ''}`}`,
      `- app type: ${brief.appType.replace(/_/g, ' ')}`,
      `- control mode: ${brief.controlMode.replace(/_/g, ' ')}`,
      `- template: ${brief.templateId || 'auto'}`,
      `- title override: ${brief.titleOverride || '(infer from conversation)'}`,
      `- source path: ${brief.sourcePath || '(none)'}`,
      `- latest brief prompt: ${summarizeText(brief.prompt || '(none yet)', 220)}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildBuilderPromptOverlay(
    brief: AppBuilderBriefDraft,
    input: {
      scopeType: 'draft' | 'project';
      projectName?: string | null;
      projectStatus?: string | null;
      previewUrl?: string | null;
    },
  ): string {
    return [
      'You are working inside the RawClaw App Builder surface.',
      input.scopeType === 'draft'
        ? 'Stay in briefing mode unless the user explicitly says to create a plan, start build, generate, validate, deploy, register, export, or rollback.'
        : 'The project already exists. You may help refine the brief in chat, but only explicit execution requests should queue builder phases.',
      'Current builder brief:',
      this.summarizeBrief(brief, input.projectName),
      input.projectStatus ? `Current project status: ${input.projectStatus}` : null,
      input.previewUrl ? `Current preview URL: ${input.previewUrl}` : null,
      'When the user asks for research, recommendations, UX guidance, SDK design advice, or tradeoff analysis, answer naturally and use tools when helpful.',
      'Do not claim that a project, artifact, queue job, deployment, or registry record was created in this turn unless the surrounding App Builder runtime already performed that action outside this chat step.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private builderConversationToChatMessages(conversation: AppBuilderConversation, nextUserMessage: AppBuilderMessage): ChatMessage[] {
    const history = [...conversation.messages.slice(-14), nextUserMessage];
    return history.map((message) => ({
      role: message.role === 'system' ? 'assistant' : message.role,
      content: message.content,
      createdAt: message.createdAt,
      attachments: message.attachments,
    }));
  }

  private buildLaneOverlay(
    lane: AppBuilderComposerLane,
    brief: AppBuilderBriefDraft,
    projectDetail?: AppBuilderProjectDetail | null,
  ): string {
    if (lane === 'plan') {
      return [
        'You are the RawClaw App Builder Planner lane.',
        'Turn the conversation into a clearer implementation plan, architecture direction, and approval-ready next step.',
        'If the user shares files or screenshots, use them to improve the plan rather than ignoring them.',
        projectDetail?.project?.name ? `Current project: ${projectDetail.project.name}` : null,
        `Current brief:\n${this.summarizeBrief(brief, projectDetail?.project?.name || null)}`,
      ].filter(Boolean).join('\n\n');
    }
    if (lane === 'build') {
      const latestSpec = projectDetail?.artifacts.find((artifact) => artifact.kind === 'spec')?.payload as AppSpecJson | undefined;
      const latestArchitecture = projectDetail?.artifacts.find((artifact) => artifact.kind === 'architecture')?.payload as ArchitecturePlan | undefined;
      return [
        'You are the RawClaw App Builder Build lane.',
        'Use the current brief, approved plan context, and shared files to guide implementation, fixes, and next build steps.',
        latestSpec ? `Current spec summary: ${latestSpec.summary}` : null,
        latestArchitecture ? `Current architecture: ${latestArchitecture.framework} + ${latestArchitecture.buildTool} using ${latestArchitecture.sdkTransport}` : null,
        `Current brief:\n${this.summarizeBrief(brief, projectDetail?.project?.name || null)}`,
      ].filter(Boolean).join('\n\n');
    }
    return '';
  }

  private summarizeProjectsForAssistant(projects: AppBuilderProject[]): string {
    if (!projects.length) {
      return 'There are no App Builder projects yet.';
    }
    return [
      'Here are the App Builder projects I can see:',
      ...projects.slice(0, 8).map((project) => `- ${project.name} :: ${project.status} :: ${project.appType} :: ${project.controlMode}`),
    ].join('\n');
  }

  private summarizeProgressForAssistant(
    detail: AppBuilderProjectDetail | null,
    preview: AppBuilderPreviewState | null,
  ): string {
    if (!detail) {
      return 'No active project is selected yet. Open an existing Builder project or start planning first, then I can report real progress.';
    }

    const activeOrLatestRun =
      detail.runs.find((run) => !['completed', 'cancelled', 'failed_fixable', 'failed_unrecoverable', 'deployment_ready', 'deployed', 'registered', 'planned'].includes(run.status))
      || detail.runs[0]
      || null;
    const tasks = detail.taskList?.tasks || [];
    const completedTasks = tasks.filter((task) => task.status === 'completed').length;
    const inProgressTasks = tasks.filter((task) => task.status === 'in_progress').length;
    const blockedTasks = tasks.filter((task) => task.status === 'blocked').length;
    const pendingTasks = tasks.filter((task) => task.status === 'pending').length;
    const currentTask =
      tasks.find((task) => task.status === 'in_progress')
      || tasks.find((task) => task.status === 'blocked')
      || null;
    const approvalStage =
      detail.approvalGate?.required && !detail.approvalGate.approved
        ? detail.approvalGate.stage || this.pendingApprovalStage(detail.project)
        : null;
    const docsCount = detail.docs?.length || 0;
    const terminalSession = detail.terminal || null;
    const activeTerminalCommand =
      terminalSession?.commands.find((command) => command.id === terminalSession.activeCommandId)
      || terminalSession?.commands.find((command) => command.status === 'running')
      || null;
    const nextAction = this.buildSuggestedActions(detail, 'workspace')[0]?.label || 'Review the workspace';

    return [
      `Progress for **${detail.project.name}**:`,
      `- Project status: ${this.humanizeBuilderLabel(detail.project.status)}.`,
      activeOrLatestRun
        ? `- Current run: ${this.humanizeBuilderLabel(activeOrLatestRun.phase)} :: ${this.humanizeBuilderLabel(activeOrLatestRun.status)} :: ${activeOrLatestRun.title}.`
        : '- Runs: no planner or builder runs have been recorded yet.',
      tasks.length
        ? `- Tasks: ${completedTasks} completed, ${inProgressTasks} in progress, ${pendingTasks} pending${blockedTasks ? `, ${blockedTasks} blocked` : ''}.`
        : '- Tasks: the project task list has not been written yet.',
      currentTask ? `- Current task: ${currentTask.title}.` : null,
      approvalStage ? `- Approval: waiting for ${this.humanizeBuilderLabel(approvalStage)} approval.` : null,
      docsCount
        ? `- Docs: ${docsCount} project bible document${docsCount === 1 ? '' : 's'} ready.`
        : '- Docs: project bible documents have not been written yet.',
      preview
        ? `- Preview: ${this.humanizeBuilderLabel(preview.status)}${preview.url ? ` at ${preview.url}` : ''}.`
        : null,
      terminalSession
        ? `- Terminal: ${this.humanizeBuilderLabel(terminalSession.status)}${activeTerminalCommand ? ` running \`${activeTerminalCommand.command}\`` : ''}.`
        : '- Terminal: no shared terminal session is active.',
      `- Next step: ${nextAction}.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private summarizeRunsForAssistant(runs: AppBuilderRun[], failedOnly = false): string {
    const items = failedOnly ? runs.filter((run) => run.status === 'failed_fixable' || run.status === 'failed_unrecoverable') : runs;
    if (!items.length) {
      return failedOnly ? 'No failed App Builder runs are recorded right now.' : 'There are no App Builder runs to show yet.';
    }
    return [
      failedOnly ? 'Here are the failed App Builder runs:' : 'Here are the recent App Builder runs:',
      ...items.slice(0, 8).map((run) => `- ${run.phase} :: ${run.status} :: ${run.title}${run.error ? ` :: ${run.error}` : ''}`),
    ].join('\n');
  }

  private summarizeRegistryForAssistant(records: AppRegistryRecord[]): string {
    if (!records.length) {
      return 'No apps are registered in RawClaw yet.';
    }
    return [
      'Here are the registered RawClaw apps:',
      ...records.slice(0, 8).map((record) => `- ${record.appId} :: ${record.status} :: health=${record.healthStatus || 'unknown'} :: ${record.controlEndpoint}`),
    ].join('\n');
  }

  private summarizePreviewForAssistant(preview: AppBuilderPreviewState | null): string {
    if (!preview) {
      return 'No preview is available because no App Builder project is selected.';
    }
    return [
      `Preview status: ${preview.status}`,
      preview.title,
      preview.summary,
      preview.url ? `URL: ${preview.url}` : null,
      preview.projectPath ? `Project path: ${preview.projectPath}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private summarizeUsageForAssistant(
    detail: AppBuilderProjectDetail | null,
    preview: AppBuilderPreviewState | null,
    brief: AppBuilderBriefDraft,
  ): string {
    if (!detail) {
      return [
        'We have not opened a build project yet.',
        '',
        'Right now you can use App Builder like this:',
        '- Describe the app you want in chat.',
        '- Use Chat to refine the idea.',
        '- Use Plan when you want RawClaw to turn the brief into a build plan.',
        '- Use Build after the plan is approved or when you want the first version generated.',
      ].join('\n');
    }

    const spec = detail.artifacts.find((artifact) => artifact.kind === 'spec')?.payload as AppSpecJson | undefined;
    const manifest = detail.manifests[0]?.manifest || null;
    const features = spec?.features?.length
      ? spec.features.slice(0, 8)
      : detail.project.description
        ? [detail.project.description]
        : [];
    const routes = spec?.routes?.length
      ? spec.routes
      : manifest?.routes?.length
        ? manifest.routes
        : [];
    const actions = spec?.controlActions?.length
      ? spec.controlActions
      : manifest?.capabilities?.map((capability) => capability.command) || [];
    const events = spec?.runtimeEvents?.length
      ? spec.runtimeEvents
      : Array.isArray(manifest?.metadata?.runtimeEvents)
        ? manifest.metadata.runtimeEvents.map(String)
        : [];

    return [
      `Here is how to use **${detail.project.name}**:`,
      '',
      spec?.summary || brief.prompt || detail.project.description || 'This project is being shaped in App Builder.',
      '',
      features.length ? 'Main things it includes:' : null,
      ...features.map((feature) => `- ${feature}`),
      routes.length ? '' : null,
      routes.length ? 'Where to go in the app:' : null,
      ...routes.map((route) => `- ${route.label || route.id}: ${route.path}${route.description ? ` — ${route.description}` : ''}`),
      actions.length ? '' : null,
      actions.length ? 'RawClaw can control it through:' : null,
      ...actions.slice(0, 10).map((action) => `- ${action}`),
      events.length ? '' : null,
      events.length ? `It reports events such as ${events.slice(0, 6).join(', ')}.` : null,
      '',
      preview?.url
        ? `Open the live preview at ${preview.url}.`
        : `No live preview is connected yet. Current project status is ${this.humanizeBuilderLabel(detail.project.status)}; use Generate/Build or the Terminal tab to start a preview.`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }

  private humanizeBuilderLabel(value: string | null | undefined): string {
    if (!value) return 'unknown';
    return value.replace(/[_-]+/g, ' ');
  }

  private summarizeProvenanceForAssistant(provenance: any): string | null {
    const metadata = provenance?.metadata || {};
    const stages = Object.keys(metadata.internalResearchStages || {});
    const parts: string[] = [];
    if (metadata.agentId) parts.push(`agent=${metadata.agentId}`);
    if (metadata.routingBinding?.bindingId) parts.push(`binding=${metadata.routingBinding.bindingId}`);
    if (stages.length) parts.push(`stages=${stages.join(',')}`);
    return parts.length ? parts.join(' | ') : null;
  }

  private async answerStateQuery(
    query: BuilderStateQueryKind,
    context: {
      draftId: string;
      requestedMode: AppBuilderMode;
      projectId?: string | null;
      brief: AppBuilderBriefDraft;
      conversationTitle: string;
      userMessage: string;
      attachments?: ChatAttachment[] | null;
    },
  ): Promise<AppBuilderAssistantResponse> {
    const scopeType = context.projectId ? 'project' : 'draft';
    const scopeId = context.projectId || context.draftId;
    let detail: AppBuilderProjectDetail | null = null;
    if (context.projectId) {
      detail = await this.getProjectDetail(context.projectId);
    }
    const previewState = context.projectId ? this.buildPreviewState(detail) : this.buildPreviewState(null);

    let content = '';
    let preferredMode = context.requestedMode;
    switch (query) {
      case 'progress':
        content = this.summarizeProgressForAssistant(detail, previewState);
        preferredMode = context.projectId ? 'workspace' : context.requestedMode;
        break;
      case 'projects':
        content = this.summarizeProjectsForAssistant(await this.listProjects());
        break;
      case 'templates':
        content = [
          'Available App Builder templates:',
          ...(await this.listTemplates()).map((template) => `- ${template.name} (${template.id}) :: ${template.appType} :: ${template.starterStack}`),
        ].join('\n');
        break;
      case 'brief':
        content = ['Current builder brief:', this.summarizeBrief(context.brief, detail?.project.name)].join('\n');
        break;
      case 'failed_runs':
        content = this.summarizeRunsForAssistant(await this.listRuns(context.projectId || undefined), true);
        preferredMode = context.projectId ? 'workspace' : context.requestedMode;
        break;
      case 'runs':
        content = this.summarizeRunsForAssistant(await this.listRuns(context.projectId || undefined), false);
        preferredMode = context.projectId ? 'workspace' : context.requestedMode;
        break;
      case 'registry':
        content = this.summarizeRegistryForAssistant(await this.listRegistryRecords());
        preferredMode = 'console';
        break;
      case 'preview':
        content = this.summarizePreviewForAssistant(context.projectId ? previewState : null);
        preferredMode = context.projectId ? 'workspace' : context.requestedMode;
        break;
      case 'usage':
        content = this.summarizeUsageForAssistant(detail, context.projectId ? previewState : null, context.brief);
        preferredMode = context.projectId ? 'workspace' : context.requestedMode;
        break;
      default:
        content = 'I could not classify that builder state query cleanly.';
        break;
    }

    const assistantReply = this.builderMessage('assistant', content, `state query: ${query}`, 'default');
    const conversation = await this.appendConversationMessages(scopeType, scopeId, preferredMode, context.conversationTitle, [
      this.builderMessage('user', context.userMessage, 'prompt', 'default', {
        attachments: context.attachments || undefined,
      }),
      assistantReply,
    ]);

    return {
      draftId: context.draftId,
      projectId: context.projectId || null,
      responseKind: 'state_query',
      lane: 'discuss',
      assistantReply,
      conversation,
      brief: context.brief,
      detail,
      preview: previewState,
      suggestedActions: this.buildSuggestedActions(detail, preferredMode),
      queuedRuns: [],
      preferredMode,
      createdProject: false,
      importedProject: context.brief.sourceType === 'imported',
      provenanceSummary: null,
      researchSummary: null,
    };
  }

  private async runBuilderDraftConversation(
    input: {
      draftId: string;
      requestedMode: AppBuilderMode;
      lane: AppBuilderComposerLane;
      projectId?: string | null;
      brief: AppBuilderBriefDraft;
      conversation: AppBuilderConversation;
      projectDetail?: AppBuilderProjectDetail | null;
      userMessage: string;
      attachments?: ChatAttachment[] | null;
      chatControls?: ChatControlState | null;
      briefUpdated?: boolean;
    },
  ): Promise<{
    assistantReply: AppBuilderMessage;
    conversation: AppBuilderConversation;
    preferredMode: AppBuilderMode;
    provenanceSummary?: string | null;
    researchSummary?: string | null;
  }> {
    const nextUserMessage = this.builderMessage('user', input.userMessage, 'prompt', 'default', {
      attachments: input.attachments || undefined,
    });
    const modelConfig = await this.modelsService.getConfig();
    const laneModel =
      input.lane === 'plan'
        ? modelConfig.routing.appBuilderPlanner || modelConfig.routing.appBuilder
        : input.lane === 'build'
          ? modelConfig.routing.appBuilderBuilder || modelConfig.routing.appBuilder
          : modelConfig.routing.appBuilder;
    const request: ChatRequest = {
      session_id: `app-builder:${input.projectId ? `project:${input.projectId}` : `draft:${input.draftId}`}`,
      workspace_id: input.brief.workspaceId || 'default',
      sender_identifier: 'app-builder',
      surfaceType: 'app_builder',
      stream: false,
      model: laneModel || undefined,
      promptPackId: 'rawclaw-app-builder',
      promptOverlay: [
        this.buildBuilderPromptOverlay(input.brief, {
          scopeType: input.projectId ? 'project' : 'draft',
          projectName: input.projectDetail?.project.name || input.brief.titleOverride || 'New Builder',
          projectStatus: input.projectDetail?.project.status || null,
          previewUrl: typeof input.projectDetail?.project.metadata?.previewUrl === 'string'
            ? String(input.projectDetail?.project.metadata?.previewUrl)
            : null,
        }),
        this.buildLaneOverlay(input.lane, input.brief, input.projectDetail),
      ].filter(Boolean).join('\n\n'),
      messages: this.builderConversationToChatMessages(input.conversation, nextUserMessage),
      planMode: input.chatControls?.planMode,
      preferredWebMode: input.chatControls?.preferredWebMode,
      toolUseMode: input.chatControls?.toolUseMode,
      permissionMode: input.chatControls?.permissionMode,
      selectedPlugins: input.chatControls?.selectedPlugins,
      selectedTools: input.chatControls?.selectedTools,
    };
    const result = await this.chatOrchestrator.processNonStreamingChat(request, { skipPromptPersistence: true });
    const fallbackContent = result.error
      ? this.buildBuilderDraftRuntimeFallback(input.userMessage, result.error.message, input.brief)
      : 'I stayed in builder chat, but I did not get a usable reply back from the assistant runtime.';
    const baseContent = result.content || fallbackContent;
    const content = input.briefUpdated
      ? [
          'Brief updated: I captured that as a change to the builder brief.',
          baseContent,
        ].join('\n\n')
      : baseContent;
    const assistantReply = this.builderMessage(
      'assistant',
      content,
      result.error ? 'builder draft chat failed' : 'builder draft chat',
      result.error ? 'warning' : 'default',
      {
        modelId: laneModel || null,
        provenanceSummary: this.summarizeProvenanceForAssistant(result.provenance),
        researchSummary: result.toolCalls.length
          ? `Used ${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? '' : 's'} while shaping the builder brief.`
          : null,
        toolSummary: result.toolCalls.length ? result.toolCalls.map((call) => call.name).join(', ') : null,
      },
    );

    const scopeType = input.projectId ? 'project' : 'draft';
    const scopeId = input.projectId || input.draftId;
    const title = input.projectDetail?.project.name || input.conversation.title || 'New Builder';
    const conversation = await this.appendConversationMessages(scopeType, scopeId, 'chat', title, [nextUserMessage, assistantReply]);
    const provenanceSummary = this.summarizeProvenanceForAssistant(result.provenance);
    const researchSummary = result.toolCalls.length
      ? `Used ${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? '' : 's'} while shaping the builder brief.`
      : null;

    return {
      assistantReply,
      conversation,
      preferredMode: 'chat',
      provenanceSummary,
      researchSummary,
    };
  }

  private buildBuilderDraftRuntimeFallback(userMessage: string, errorMessage: string, brief: AppBuilderBriefDraft): string {
    const latestBrief = brief.prompt?.trim() || userMessage.trim();
    const briefLine = latestBrief
      ? `I still have the current brief: ${latestBrief.slice(0, 220)}${latestBrief.length > 220 ? '...' : ''}`
      : 'I still have the current builder draft saved.';
    return [
      'The chat model route stopped responding before it could answer, so I kept this in draft instead of pretending the step worked.',
      briefLine,
      `Runtime detail: ${errorMessage}`,
      'You can switch to Plan or Build to use the deterministic builder pipeline, or retry Chat after changing the App Builder model route.',
    ].join('\n');
  }

  private async runPlannerModelReview(
    project: AppBuilderProject,
    intent: AppBuilderIntent,
    spec: AppSpecJson,
    architecture: ArchitecturePlan,
  ): Promise<{ summary: string; model: string | null }> {
    const modelConfig = await this.modelsService.getConfig();
    const model = modelConfig.routing.appBuilderPlanner || modelConfig.routing.appBuilder || null;
    const request: ChatRequest = {
      session_id: `app-builder:planner:${project.id}`,
      workspace_id: project.workspaceId || 'default',
      sender_identifier: 'app-builder-planner',
      surfaceType: 'app_builder',
      stream: false,
      model: model || undefined,
      promptPackId: 'rawclaw-app-builder',
      promptOverlay: [
        'You are the RawClaw App Builder Planner lane.',
        'Review the intent, structured spec, and architecture plan.',
        'Return a concise planning review with three short sections: plan summary, architecture concerns, and approval checklist.',
        'Keep it short, concrete, and ready for a human approval stop before generation begins.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            project: {
              id: project.id,
              name: project.name,
              appType: project.appType,
              controlMode: project.controlMode,
            },
            intent,
            spec,
            architecture,
          }, null, 2),
          createdAt: new Date().toISOString(),
        },
      ],
    };
    try {
      const result = await this.chatOrchestrator.processNonStreamingChat(request, { skipPromptPersistence: true });
      const summary = (result.content || '').trim();
      if (summary) {
        return { summary, model };
      }
    } catch (error) {
      this.logger.warn(`Planner lane model review failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      model,
      summary: [
        `Plan summary: ${spec.summary}`,
        `Architecture: ${architecture.framework} + ${architecture.buildTool} with ${architecture.sdkTransport} control transport.`,
        `Approval checklist: confirm scope, confirm control mode (${project.controlMode}), and confirm the next generation step.`,
      ].join('\n'),
    };
  }

  private async runBuilderModelBrief(
    project: AppBuilderProject,
    spec: AppSpecJson,
    architecture: ArchitecturePlan,
  ): Promise<{ summary: string; model: string | null }> {
    const modelConfig = await this.modelsService.getConfig();
    const model = modelConfig.routing.appBuilderBuilder || modelConfig.routing.appBuilder || null;
    const request: ChatRequest = {
      session_id: `app-builder:builder:${project.id}`,
      workspace_id: project.workspaceId || 'default',
      sender_identifier: 'app-builder-builder',
      surfaceType: 'app_builder',
      stream: false,
      model: model || undefined,
      promptPackId: 'rawclaw-app-builder',
      promptOverlay: [
        'You are the RawClaw App Builder Build lane.',
        'Prepare a concise implementation brief for generation.',
        'Focus on the first version, the highest-signal files, and any control-hook obligations.',
        'Keep it short and practical.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            project: {
              id: project.id,
              name: project.name,
              appType: project.appType,
              controlMode: project.controlMode,
            },
            spec,
            architecture,
          }, null, 2),
          createdAt: new Date().toISOString(),
        },
      ],
    };
    try {
      const result = await this.chatOrchestrator.processNonStreamingChat(request, { skipPromptPersistence: true });
      const summary = (result.content || '').trim();
      if (summary) {
        return { summary, model };
      }
    } catch (error) {
      this.logger.warn(`Build lane model brief failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      model,
      summary: `Build the first version around ${spec.domain}, prioritize ${spec.uiSections.slice(0, 3).join(', ') || 'the primary UI'}, and keep RawClaw control hooks intact.`,
    };
  }

  private extractJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async generateModelFileMap(input: {
    project: AppBuilderProject;
    spec: AppSpecJson;
    architecture: ArchitecturePlan;
    fileGraph: FileGraph;
    manifest: RawClawAppManifest;
    mode: Extract<AppBuilderGenerationMode, 'ai_scaffold' | 'ai_edit' | 'ai_repair'>;
    targetedPaths?: string[] | null;
    userRequest?: string | null;
    validationOutput?: string | null;
  }): Promise<{ files: Record<string, string>; model: string | null; rationale: Record<string, unknown> | null }> {
    const allowedPaths = new Set(input.fileGraph.generationOrder);
    const targets = (input.targetedPaths?.length ? input.targetedPaths : input.fileGraph.generationOrder)
      .map((filePath) => this.normalizeWorkspacePath(filePath))
      .filter((filePath) => allowedPaths.has(filePath));
    const currentFiles: Record<string, string> = {};
    if (input.mode !== 'ai_scaffold') {
      const managedPath = await this.ensureProjectRoot(input.project);
      for (const filePath of targets.slice(0, 12)) {
        const absolute = this.securePaths.resolveInside(managedPath, filePath);
        currentFiles[filePath] = existsSync(absolute) ? await fs.readFile(absolute, 'utf8') : '';
      }
    }
    const uploadRecords = await this.listArtifactsByKind<Record<string, unknown>>(input.project.id, 'upload_record', 40);
    const referenceImages = await this.listArtifactsByKind<Record<string, unknown>>(input.project.id, 'reference_image', 40);
    const referenceDocuments = await this.listArtifactsByKind<Record<string, unknown>>(input.project.id, 'reference_document', 40);
    const referenceCodes = await this.listArtifactsByKind<Record<string, unknown>>(input.project.id, 'reference_code', 40);
    const referenceArtifacts = [...referenceImages, ...referenceDocuments, ...referenceCodes];
    const selectedUploadIds = new Set(uploadRecords
      .filter((record) => record.selectedForContext !== false)
      .map((record) => String(record.id || record.uploadId || '')));
    const includedReferences = referenceArtifacts.filter((artifact) => {
      const status = String(artifact.status || 'ready');
      const uploadId = String(artifact.uploadId || artifact.id || '');
      const hasSelectionRecord = uploadRecords.some((record) => String(record.id || record.uploadId || '') === uploadId);
      if (hasSelectionRecord && !selectedUploadIds.has(uploadId)) return false;
      if (status === 'ready') return true;
      if (status === 'partial_extraction') return selectedUploadIds.has(uploadId);
      if (status === 'partial_contract') return selectedUploadIds.has(uploadId);
      return false;
    }).slice(0, 12);
    const excludedReferences = referenceArtifacts
      .filter((artifact) => !includedReferences.some((included) => included.id === artifact.id))
      .map((artifact) => ({
        uploadId: String(artifact.uploadId || artifact.id || 'unknown'),
        reason: `status ${String(artifact.status || 'unknown')} not included`,
      }));
    const targetBudget = input.mode === 'ai_scaffold' ? 24_000 : input.mode === 'ai_edit' ? 18_000 : 12_000;
    const hardCeiling = input.mode === 'ai_scaffold' ? 32_000 : input.mode === 'ai_edit' ? 24_000 : 18_000;
    let tokenEstimate = Math.ceil(JSON.stringify({
      spec: input.spec,
      architecture: input.architecture,
      fileGraph: input.fileGraph.generationOrder,
      currentFiles,
      validationOutput: input.validationOutput || null,
      referenceMaterials: includedReferences,
    }).length / 4);
    if (tokenEstimate > hardCeiling) {
      const keepFiles = Object.fromEntries(Object.entries(currentFiles).slice(0, Math.max(1, input.mode === 'ai_repair' ? 4 : 8)));
      Object.keys(currentFiles).forEach((key) => delete currentFiles[key]);
      Object.assign(currentFiles, keepFiles);
      includedReferences.splice(Math.max(1, input.mode === 'ai_scaffold' ? 6 : 3));
      tokenEstimate = Math.ceil(JSON.stringify({
        spec: input.spec,
        architecture: input.architecture,
        fileGraph: input.fileGraph.generationOrder,
        currentFiles,
        validationOutput: input.validationOutput || null,
        referenceMaterials: includedReferences,
      }).length / 4);
    }
    const contextPack: AppBuilderContextPackSummary = {
      id: `context-${randomUUID()}`,
      mode: input.mode,
      tokenEstimate,
      targetBudget,
      hardCeiling,
      includedFiles: Object.keys(currentFiles),
      excludedFiles: input.fileGraph.generationOrder
        .filter((filePath) => !targets.includes(filePath))
        .map((filePath) => ({ path: filePath, reason: 'not targeted for this generation mode' })),
      includedUploadIds: includedReferences.map((artifact) => String(artifact.uploadId || artifact.id)),
      excludedUploadIds: excludedReferences,
      createdAt: new Date().toISOString(),
    };
    await this.storeArtifact(input.project.id, null, 'context_pack', 'codegen', `${input.mode} context pack`, contextPack);

    const modelConfig = await this.modelsService.getConfig();
    const model = modelConfig.routing.appBuilderBuilder || modelConfig.routing.appBuilder || null;
    const request: ChatRequest = {
      session_id: `app-builder:${input.mode}:${input.project.id}`,
      workspace_id: input.project.workspaceId || 'default',
      sender_identifier: `app-builder-${input.mode}`,
      surfaceType: 'app_builder',
      stream: false,
      model: model || undefined,
      promptPackId: 'rawclaw-app-builder',
      promptOverlay: [
        'You are the RawClaw App Builder code generation model.',
        'Return ONLY valid JSON. No markdown and no prose outside JSON.',
        'The JSON shape is {"rationale":{"approach":"string","files":["path"],"assumptions":["string"],"confidence":0.0},"files":[{"path":"allowed/path","content":"full file content","purpose":"string"}]}.',
        'Use React, Vite, TypeScript, the existing RawClaw SDK file contract, and the allowed file graph only.',
        'Do not add network calls except RawClaw control endpoints. Do not import fs, child_process, or process APIs.',
        'For edit and repair modes, return full replacement content only for the targeted files that need changes.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            mode: input.mode,
            userRequest: input.userRequest || input.project.description || input.project.name,
            project: {
              id: input.project.id,
              name: input.project.name,
              appType: input.project.appType,
              sourceType: input.project.sourceType,
              controlMode: input.project.controlMode,
            },
            spec: input.spec,
            architecture: input.architecture,
            allowedPaths: Array.from(allowedPaths),
            targetedPaths: targets,
            manifest: input.manifest,
            currentFiles,
            validationOutput: input.validationOutput || null,
            uploadRecords: uploadRecords.slice(0, 12),
            referenceMaterials: includedReferences,
            excludedContext: contextPack.excludedFiles,
            excludedUploads: contextPack.excludedUploadIds || [],
          }, null, 2),
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const result = await this.chatOrchestrator.processNonStreamingChat(request, { skipPromptPersistence: true });
    const parsed = this.extractJsonObject(result.content || '');
    await this.validateModelFileMapBeforeStaging(input.project.id, parsed, allowedPaths);
    const returnedFiles = Array.isArray(parsed?.files) ? parsed.files as Array<Record<string, unknown>> : [];
    const files: Record<string, string> = {};
    for (const file of returnedFiles) {
      const relativePath = typeof file.path === 'string' ? this.normalizeWorkspacePath(file.path) : '';
      const content = typeof file.content === 'string' ? file.content : '';
      if (!relativePath || !content || !allowedPaths.has(relativePath)) continue;
      if (input.targetedPaths?.length && !targets.includes(relativePath)) continue;
      files[relativePath] = content;
    }
    if (!Object.keys(files).length) {
      throw new Error(`${input.mode} did not return any valid allowed files.`);
    }
    await this.recordActivity(input.project.id, {
      phase: input.mode === 'ai_repair' ? 'validate' : 'generate',
      lane: 'build',
      kind: 'builder',
      status: 'success',
      title: `${input.mode} model output received`,
      summary: `Model returned ${Object.keys(files).length} file replacement(s) for staging.`,
      modelId: model,
      metadata: {
        mode: input.mode,
        contextPackId: contextPack.id,
        rationale: this.normalizeReferenceInfluence(parsed?.rationale),
      },
    });
    return {
      files,
      model,
      rationale: this.normalizeReferenceInfluence(parsed?.rationale),
    };
  }

  private async validateModelFileMapBeforeStaging(
    projectId: string,
    parsed: Record<string, unknown> | null,
    allowedPaths: Set<string>,
  ): Promise<void> {
    const fail = async (reason: string, detail?: Record<string, unknown>) => {
      await this.storeArtifact(projectId, null, 'code_patch', 'codegen', 'Blocked AI file map', {
        id: `blocked-ai-file-map-${randomUUID()}`,
        status: 'blocked_invalid_additions',
        reason,
        detail: detail || null,
        createdAt: new Date().toISOString(),
      }).catch(() => undefined);
      throw new Error(reason);
    };
    if (!parsed || !Array.isArray(parsed.files)) {
      await fail('AI generation returned invalid JSON file-map shape.');
    }
    const fileMap = parsed as Record<string, unknown> & { files: Array<Record<string, unknown>> };
    const additions = Array.isArray(fileMap.fileGraphAdditions) ? fileMap.fileGraphAdditions as Array<Record<string, unknown>> : [];
    const additionPaths = new Set<string>();
    for (const addition of additions) {
      const additionPath = typeof addition.path === 'string' ? this.normalizeWorkspacePath(addition.path) : '';
      const allowedAddition = /^(src|public)\//.test(additionPath) || /\.test\.(ts|tsx|js|jsx)$/.test(additionPath);
      if (!additionPath || !allowedAddition || additionPath.includes('..') || path.isAbsolute(additionPath)) {
        await fail('AI fileGraphAdditions contained an unsafe or unsupported path.', { path: additionPath });
      }
      if (/(^|\/)(package\.json|vite\.config|tsconfig|\.env)/i.test(additionPath)) {
        await fail('AI fileGraphAdditions attempted to modify restricted project configuration.', { path: additionPath });
      }
      additionPaths.add(additionPath);
    }
    for (const file of fileMap.files) {
      const filePath = typeof file.path === 'string' ? this.normalizeWorkspacePath(file.path) : '';
      const content = typeof file.content === 'string' ? file.content : '';
      if (!filePath || !content) {
        await fail('AI generation returned a file without path or content.', { path: filePath });
      }
      if (!allowedPaths.has(filePath) && !additionPaths.has(filePath)) {
        await fail('AI generation returned a file outside the allowed graph without a valid fileGraphAdditions entry.', { path: filePath });
      }
      if (additionPaths.has(filePath)) {
        const imports = Array.from(content.matchAll(/\bfrom\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g))
          .map((match) => String(match[1] || match[2] || ''))
          .filter((entry) => entry.startsWith('.'));
        if (imports.some((entry) => entry.includes('..'))) {
          await fail('AI fileGraphAdditions contained an unsafe relative import.', { path: filePath, imports });
        }
        const baseName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
        if (imports.some((entry) => entry.includes(baseName))) {
          await fail('AI fileGraphAdditions contained a cyclic self-import.', { path: filePath, imports });
        }
      }
    }
    for (const additionPath of additionPaths) allowedPaths.add(additionPath);
  }

  private normalizeReferenceInfluence(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const explicit = raw.referenceInfluence && typeof raw.referenceInfluence === 'object'
      ? raw.referenceInfluence as Record<string, unknown>
      : raw;
    const files = explicit.files;
    return {
      ...raw,
      scope: files && typeof files === 'object' && !Array.isArray(files) ? 'file' : 'generation',
    };
  }

  private plannerReplyText(detail: AppBuilderProjectDetail, fallbackSummary: string): string {
    const plannerReviewSummary =
      typeof detail.project.metadata?.plannerReviewSummary === 'string'
        ? String(detail.project.metadata.plannerReviewSummary).trim()
        : '';
    const docs = detail.docs || [];
    const docsSummary = docs.length
      ? docs.map((doc) => doc.path).join(', ')
      : 'docs/PROJECT_BRIEF.md, docs/PLAN.md, docs/TASKS.md, docs/DECISIONS.md, docs/AGENT_MEMORY.md, docs/STATUS.md';
    const taskCount = detail.taskList?.tasks.length || 0;
    return [
      `Planner finished the first planning pass for ${detail.project.name}.`,
      plannerReviewSummary || fallbackSummary,
      `Project bible written: ${docsSummary}.`,
      taskCount ? `Task list initialized with ${taskCount} layered task${taskCount === 1 ? '' : 's'}.` : 'Task list initialized for the next execution layer.',
      'Review the plan in Activity or Docs, then approve plan when you want RawClaw to unlock build.',
    ].join('\n');
  }

  private async executePhaseInline(
    projectId: string,
    phase: AppBuilderPhase,
    prompt?: string | null,
  ): Promise<{ run: AppBuilderRun; detail: AppBuilderProjectDetail; result: ExecuteQueuedRunResult }> {
    const queuedRun = await this.queueProjectPhase(projectId, phase, prompt ? { prompt } : null);
    if (!queuedRun.queueJobId) {
      throw new Error(`Inline ${phase} could not start because the builder job handle was missing.`);
    }
    const workerId = 'app-builder-inline';
    await this.markQueuedRunStarted(queuedRun.queueJobId, workerId);
    try {
      const result = await this.executeQueuedRun(queuedRun.queueJobId, workerId);
      await this.completeQueuedRun({
        jobId: queuedRun.queueJobId,
        workerId,
        summary: result.summary,
        output: (result.output && typeof result.output === 'object') ? result.output as Record<string, unknown> : null,
      });
      return {
        run: await this.getRun(queuedRun.id),
        detail: await this.getProjectDetail(projectId),
        result,
      };
    } catch (error) {
      await this.failQueuedRun({
        jobId: queuedRun.queueJobId,
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async startProjectPhaseForeground(
    projectId: string,
    phase: AppBuilderPhase,
    requestPayload?: Record<string, unknown> | null,
  ): Promise<{ run: AppBuilderRun; capacityState: Record<string, unknown>; foregroundStarted: boolean }> {
    const startedAt = Date.now();
    const windowMs = this.appBuilderConfig.values.foregroundStartWindowMs;
    let latestCapacity = await this.builderCapacity(phase);
    while (!latestCapacity.canStart && Date.now() - startedAt < windowMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, windowMs)));
      latestCapacity = await this.builderCapacity(phase);
    }
    if (!latestCapacity.canStart) {
      throw new ServiceUnavailableException({
        code: 'capacity_delayed',
        message: `The ${phase} phase could not start inside the foreground start window.`,
        retryAfterMs: windowMs,
        canRetry: true,
        capacity: latestCapacity,
      });
    }

    const queuedRun = await this.queueProjectPhase(projectId, phase, {
      ...(requestPayload || {}),
      backgroundable: false,
      foregroundStartWindowMs: windowMs,
    });
    if (!queuedRun.queueJobId) {
      throw new Error(`Foreground ${phase} could not start because the builder job handle was missing.`);
    }
    const workerId = `app-builder-foreground-${randomUUID()}`;
    await this.markQueuedRunStarted(queuedRun.queueJobId, workerId);
    void this.executeForegroundStartedRun(queuedRun.queueJobId, workerId);
    return {
      run: await this.getRun(queuedRun.id),
      capacityState: {
        aiJobsAvailable: latestCapacity.aiJobsAvailable,
        validationJobsAvailable: latestCapacity.validationJobsAvailable,
        previewSlotsAvailable: latestCapacity.previewSlotsAvailable,
        queueDepth: latestCapacity.queueDepth,
      },
      foregroundStarted: true,
    };
  }

  private async executeForegroundStartedRun(jobId: string, workerId: string): Promise<void> {
    try {
      const result = await this.executeQueuedRun(jobId, workerId);
      await this.completeQueuedRun({
        jobId,
        workerId,
        summary: result.summary,
        output: (result.output && typeof result.output === 'object') ? result.output as Record<string, unknown> : null,
      });
    } catch (error) {
      await this.failQueuedRun({
        jobId,
        workerId,
        error: error instanceof Error ? error.message : String(error),
      }).catch((failure) => {
        this.logger.warn(`Foreground failure recording failed for ${jobId}: ${failure instanceof Error ? failure.message : String(failure)}`);
      });
    }
  }

  async sendAssistantMessage(input: BuilderAssistantInput): Promise<AppBuilderAssistantResponse> {
    await this.ensureSchema();
    const message = input.message.trim();
    if (!message) {
      throw new Error('Builder prompt cannot be empty.');
    }

    const draftId = this.builderDraftId(input.draftId);
    const requestedMode = input.mode || 'chat';
    const requestedLane: AppBuilderComposerLane = input.lane || 'discuss';
    const classification = this.classifyAssistantTurn(message, Boolean(input.projectId));

    if (!input.projectId) {
      const conversation = await this.loadConversation('draft', draftId, requestedMode, 'New Builder');
      const currentDraftBrief = await this.getBriefDraft({ draftId });
      if (classification.kind === 'state_query') {
        const stateBrief = await this.saveBrief('draft', draftId, {
          ...currentDraftBrief,
          ...(input.brief || {}),
        });
        return this.answerStateQuery(classification.query, {
          draftId,
          requestedMode,
          brief: stateBrief,
          conversationTitle: conversation.title,
          userMessage: message,
          attachments: input.attachments,
        });
      }
      const shouldCapturePrompt = this.shouldCapturePromptInBrief(message);
      const existingPrompt = currentDraftBrief.prompt?.trim() || '';
      const mergedPrompt = shouldCapturePrompt
        ? (existingPrompt ? this.mergeProjectDescription(existingPrompt, message) : message)
        : (currentDraftBrief.prompt || null);
      const inferenceText = mergedPrompt || currentDraftBrief.prompt || currentDraftBrief.titleOverride || message;
      const sourcePathHint = input.brief?.sourcePath ?? currentDraftBrief.sourcePath;
      const sourceType = this.resolveSourceType(inferenceText, input.brief?.sourceType || currentDraftBrief.sourceType, sourcePathHint);
      const appType = this.inferAppType(inferenceText, input.brief?.appType || currentDraftBrief.appType);
      const controlMode = this.inferControlMode(inferenceText, input.brief?.controlMode || currentDraftBrief.controlMode);
      const templateId = sourceType === 'generated'
        ? this.inferTemplateId(inferenceText, appType, input.brief?.templateId || currentDraftBrief.templateId)
        : 'external-project-adapter';
      const sourcePath = sourceType === 'imported'
        ? ((input.brief?.sourcePath || currentDraftBrief.sourcePath || this.inferSourcePath(inferenceText))?.trim() || null)
        : null;
      const projectName = (input.brief?.titleOverride || currentDraftBrief.titleOverride || '').trim()
        || ((shouldCapturePrompt || Boolean(currentDraftBrief.prompt))
          ? this.inferProjectName(inferenceText, sourceType, appType)
          : '');
      const nextBrief = await this.saveBrief('draft', draftId, {
        ...currentDraftBrief,
        ...(input.brief || {}),
        sourceType,
        appType,
        controlMode,
        templateId,
        titleOverride: input.brief?.titleOverride ?? currentDraftBrief.titleOverride ?? (projectName || null),
        sourcePath,
        prompt: shouldCapturePrompt ? mergedPrompt : currentDraftBrief.prompt,
      });
      const effectiveClassification = this.applyLaneExecution(classification, requestedLane, sourceType);

      if (effectiveClassification.kind === 'execution') {
        const effectivePrompt = nextBrief.prompt || currentDraftBrief.prompt || message;
        const resolvedProjectName = projectName || this.inferProjectName(effectivePrompt, sourceType, appType);
        const intent = this.intentParser.parse({
          prompt: effectivePrompt,
          sourceType,
          appType,
          controlMode,
          templateId,
        });
        const readiness = this.assessDraftReadiness({
          prompt: effectivePrompt,
          sourceType,
          appType,
          controlMode,
          templateId,
          sourcePath,
          intent,
        });

        if (!readiness.ready) {
          const assistantReply = this.builderMessage(
            'assistant',
            this.summarizeDraftClarification({
              sourceType,
              appType,
              controlMode,
              template: sourceType === 'generated' ? this.pickTemplateForType(appType, templateId) : null,
              followUps: readiness.followUps,
            }),
            'brief needs refinement',
            'warning',
          );
          const nextConversation = await this.appendConversationMessages('draft', draftId, 'chat', conversation.title, [
            this.builderMessage('user', message, 'prompt', 'default', {
              attachments: input.attachments || undefined,
            }),
            assistantReply,
          ]);
          return {
            draftId,
            projectId: null,
            responseKind: 'draft_chat',
            lane: requestedLane,
            assistantReply,
            conversation: nextConversation,
            brief: await this.saveBrief('draft', draftId, { ...nextBrief, prompt: effectivePrompt }),
            detail: null,
            preview: this.buildPreviewState(null),
            suggestedActions: this.buildSuggestedActions(null, requestedMode),
            queuedRuns: [],
            preferredMode: 'chat',
            createdProject: false,
            importedProject: sourceType === 'imported',
            provenanceSummary: null,
            researchSummary: null,
          };
        }

        const detail = sourceType === 'generated'
          ? await this.createProject({
              name: resolvedProjectName,
              description: effectivePrompt,
              workspaceId: nextBrief.workspaceId || 'default',
              appType,
              templateId,
              controlMode,
            })
          : await this.importProject({
              name: resolvedProjectName,
              description: effectivePrompt,
              workspaceId: nextBrief.workspaceId || 'default',
              appType,
              sourcePath,
              controlMode,
            });

        const requestedPhase: AppBuilderPhase = effectiveClassification.phase || (sourceType === 'generated' ? 'plan' : 'adapter-generate');
        const buildGateIssue = this.isBuildPhase(requestedPhase)
          ? this.planApprovalIssue(detail.project, effectivePrompt)
          : null;
        const autoPhase: AppBuilderPhase = buildGateIssue ? 'plan' : requestedPhase;
        let queuedRun: AppBuilderRun | null = null;
        let createdDetail = detail;
        let assistantReply: AppBuilderMessage;
        try {
          if (autoPhase === 'plan') {
            const inlinePlan = await this.executePhaseInline(detail.project.id, 'plan', effectivePrompt);
            queuedRun = inlinePlan.run;
            createdDetail = inlinePlan.detail;
            assistantReply = this.builderMessage(
              'assistant',
              buildGateIssue
                ? [
                    `Opened ${createdDetail.project.name} as a generated ${createdDetail.project.appType.replace('_', ' ')} project.`,
                    this.buildPlanGateMessage(createdDetail.project.name, buildGateIssue, this.plannerReplyText(createdDetail, inlinePlan.result.summary)),
                  ].join('\n')
                : [
                    `Opened ${createdDetail.project.name} as a generated ${createdDetail.project.appType.replace('_', ' ')} project.`,
                    `Template: ${this.pickTemplateForType(appType, templateId).name} (${this.pickTemplateForType(appType, templateId).starterStack}).`,
                    `Control mode starts at ${createdDetail.project.controlMode.replace(/_/g, ' ')}.`,
                    this.plannerReplyText(createdDetail, inlinePlan.result.summary),
                  ].join('\n'),
              'plan ready for approval',
              'success',
            );
          } else {
            queuedRun = await this.queueProjectPhase(detail.project.id, autoPhase, { prompt: effectivePrompt });
            assistantReply = this.builderMessage(
              'assistant',
              [
                `Asked: ${message}`,
                `Opened ${detail.project.name} as a ${sourceType === 'generated' ? 'generated' : 'wrapped'} ${detail.project.appType.replace('_', ' ')} project.`,
                sourceType === 'generated'
                  ? `Workflow started: ${queuedRun.phase} is now running with ${this.pickTemplateForType(appType, templateId).name} (${this.pickTemplateForType(appType, templateId).starterStack}).`
                  : `Workflow started: ${queuedRun.phase} is now running for the imported adapter path.`,
                `Current state: ${detail.project.status.replace(/_/g, ' ')} / control ${detail.project.controlMode.replace(/_/g, ' ')}.`,
                'What comes next: this conversation stays live while the workflow posts progress, docs updates, terminal output, and the final walkthrough back here.',
              ].join('\n'),
              `${autoPhase} started`,
              'default',
            );
          }
        } catch (error) {
          this.logger.warn(`Unable to start ${autoPhase} for project ${detail.project.id}: ${error instanceof Error ? error.message : String(error)}`);
          assistantReply = this.builderMessage(
            'assistant',
            `I opened ${detail.project.name}, but ${autoPhase} could not start cleanly yet: ${error instanceof Error ? error.message : String(error)}`,
            `${autoPhase} failed`,
            'warning',
          );
        }

        const projectConversation: AppBuilderConversation = {
          ...this.emptyConversation('project', detail.project.id, 'chat', detail.project.name),
          messages: [...conversation.messages, this.builderMessage('user', message, 'prompt', 'default', {
            attachments: input.attachments || undefined,
          }), assistantReply],
        };
        await this.saveConversation(projectConversation);
        await this.saveConversation(this.emptyConversation('draft', draftId, 'chat', 'New Builder'));

        const projectBrief = await this.saveBrief('project', detail.project.id, {
          ...nextBrief,
          workspaceId: detail.project.workspaceId,
          sourceType,
          appType,
          controlMode,
          templateId,
          titleOverride: detail.project.name,
          sourcePath,
          prompt: effectivePrompt,
        });

        return {
          draftId,
          projectId: detail.project.id,
          responseKind: 'execution',
          lane: requestedLane,
          assistantReply,
          conversation: projectConversation,
          brief: projectBrief,
          detail: await this.getProjectDetail(detail.project.id),
          preview: await this.getPreviewState(detail.project.id),
          suggestedActions: this.buildSuggestedActions(createdDetail, requestedMode === 'chat' ? 'chat' : 'workspace'),
          queuedRuns: queuedRun ? [queuedRun] : [],
          preferredMode: requestedMode === 'chat' ? 'chat' : 'workspace',
          createdProject: true,
          importedProject: sourceType === 'imported',
          provenanceSummary: null,
          researchSummary: null,
        };
      }

      const draftChat = await this.runBuilderDraftConversation({
        draftId,
        requestedMode,
        lane: requestedLane,
        brief: nextBrief,
        conversation,
        userMessage: message,
        attachments: input.attachments,
        chatControls: input.chatControls,
        briefUpdated: shouldCapturePrompt,
      });

      return {
        draftId,
        projectId: null,
        responseKind: 'draft_chat',
        lane: requestedLane,
        assistantReply: draftChat.assistantReply,
        conversation: draftChat.conversation,
        brief: nextBrief,
        detail: null,
        preview: this.buildPreviewState(null),
        suggestedActions: this.buildSuggestedActions(null, requestedMode),
        queuedRuns: [],
        preferredMode: draftChat.preferredMode,
        createdProject: false,
        importedProject: sourceType === 'imported',
        provenanceSummary: draftChat.provenanceSummary || null,
        researchSummary: draftChat.researchSummary || null,
      };
    }

    const detail = await this.getProjectDetail(input.projectId);
    const conversation = await this.getConversation({ projectId: input.projectId, mode: requestedMode });
    const currentBrief = await this.getBriefDraft({ projectId: input.projectId });
    if (classification.kind === 'state_query') {
      const stateBrief = await this.saveBrief('project', input.projectId, {
        ...currentBrief,
        ...(input.brief || {}),
        titleOverride: input.brief?.titleOverride ?? currentBrief.titleOverride ?? detail.project.name,
      });
      return this.answerStateQuery(classification.query, {
        draftId,
        requestedMode,
        projectId: input.projectId,
        brief: stateBrief,
        conversationTitle: detail.project.name,
        userMessage: message,
        attachments: input.attachments,
      });
    }
    let shouldCapturePrompt = this.shouldCapturePromptInBrief(message);
    if (this.classifyPostBuildEditRequest(message, detail).shouldStageEdit) {
      shouldCapturePrompt = false;
    }
    const existingPrompt = currentBrief.prompt || detail.project.description || '';
    const mergedPrompt = shouldCapturePrompt
      ? (existingPrompt ? this.mergeProjectDescription(existingPrompt, message) : message)
      : existingPrompt;
    const inferenceText = mergedPrompt || currentBrief.prompt || detail.project.description || message;
    const nextControlMode = this.inferControlMode(inferenceText, detail.project.controlMode);
    const nextAppType = this.inferAppType(inferenceText, detail.project.appType);
    const nextTemplateId = detail.project.sourceType === 'generated'
      ? this.inferTemplateId(inferenceText, nextAppType, input.brief?.templateId || detail.project.templateId || currentBrief.templateId)
      : detail.project.templateId;
    let brief = await this.saveBrief('project', input.projectId, {
      ...currentBrief,
      ...(input.brief || {}),
      appType: nextAppType,
      controlMode: nextControlMode,
      templateId: nextTemplateId,
      titleOverride: input.brief?.titleOverride ?? currentBrief.titleOverride ?? detail.project.name,
      sourcePath: detail.project.sourceType === 'imported'
        ? ((input.brief?.sourcePath || currentBrief.sourcePath || this.inferSourcePath(inferenceText) || detail.project.sourcePath)?.trim() || null)
        : detail.project.sourcePath,
      prompt: shouldCapturePrompt ? mergedPrompt : currentBrief.prompt,
    });

    let nextDetail = detail;
    const queuedRuns: AppBuilderRun[] = [];
    let assistantReply: AppBuilderMessage;
    let preferredMode: AppBuilderMode = requestedMode;
    const effectiveClassification = this.applyLaneExecution(classification, requestedLane, nextDetail.project.sourceType);
    const effectivePromptForExecution = brief.prompt || mergedPrompt || message;
    const postBuildEdit = this.classifyPostBuildEditRequest(message, nextDetail);

    if (effectiveClassification.kind !== 'execution' && postBuildEdit.shouldStageEdit) {
      const queued = await this.queueProjectPhase(nextDetail.project.id, 'generate', {
        prompt: message,
        generationMode: 'ai_edit',
        targetedPaths: postBuildEdit.targetedPaths,
        backgroundable: true,
      });
      queuedRuns.push(queued);
      nextDetail = await this.getProjectDetail(nextDetail.project.id);
      assistantReply = this.builderMessage(
        'assistant',
        [
          `I understood that as a code edit request for ${nextDetail.project.name}.`,
          `I queued an ai_edit staged patch as run ${queued.id}; it will produce reviewable diffs before anything is applied.`,
          `Targeted files: ${postBuildEdit.targetedPaths.join(', ')}.`,
        ].join('\n'),
        'code edit queued',
        'default',
      );
      preferredMode = 'workspace';
      const nextConversation = await this.appendConversationMessages('project', nextDetail.project.id, preferredMode, nextDetail.project.name, [
        this.builderMessage('user', message, 'prompt', 'default', {
          attachments: input.attachments || undefined,
        }),
        assistantReply,
      ]);
      return {
        draftId,
        projectId: nextDetail.project.id,
        responseKind: 'execution',
        lane: requestedLane,
        assistantReply,
        conversation: nextConversation,
        brief,
        detail: await this.getProjectDetail(nextDetail.project.id),
        preview: await this.getPreviewState(nextDetail.project.id),
        suggestedActions: this.buildSuggestedActions(await this.getProjectDetail(nextDetail.project.id), preferredMode),
        queuedRuns,
        preferredMode,
        createdProject: false,
        importedProject: nextDetail.project.sourceType === 'imported',
        provenanceSummary: null,
        researchSummary: null,
      };
    }

    if (effectiveClassification.kind === 'execution') {
      if (effectiveClassification.approve) {
        nextDetail = await this.approveProject(detail.project.id, {
          reviewer: 'builder-chat',
          notes: `Approved from builder conversation on ${new Date().toISOString()}.`,
          controlMode: detail.project.controlMode,
        });
        assistantReply = this.builderMessage(
          'assistant',
          `Control gate approved for ${nextDetail.project.name}. We can deploy, register, or raise the control mode with a follow-up prompt.`,
          'approval granted',
          'success',
        );
        preferredMode = 'workspace';
      } else if (
        (effectiveClassification.phase === 'deploy' || effectiveClassification.phase === 'register') &&
        nextDetail.approvalGate?.required &&
        !nextDetail.approvalGate.approved
      ) {
        assistantReply = this.builderMessage(
          'assistant',
          'I can queue that next, but this project still needs the human approval gate. Approve it from Workspace or say "approve this project" first.',
          'approval required',
          'warning',
        );
      } else if (effectiveClassification.phase) {
        const buildGateIssue = this.isBuildPhase(effectiveClassification.phase)
          ? this.planApprovalIssue(nextDetail.project, effectivePromptForExecution)
          : null;
        if (effectiveClassification.phase === 'plan' || buildGateIssue) {
          const inlinePlan = await this.executePhaseInline(nextDetail.project.id, 'plan', effectivePromptForExecution);
          queuedRuns.push(inlinePlan.run);
          nextDetail = inlinePlan.detail;
          assistantReply = this.builderMessage(
            'assistant',
            buildGateIssue
              ? this.buildPlanGateMessage(nextDetail.project.name, buildGateIssue, this.plannerReplyText(nextDetail, inlinePlan.result.summary))
              : this.plannerReplyText(nextDetail, inlinePlan.result.summary),
            'plan ready for approval',
            'success',
          );
          preferredMode = 'workspace';
        } else {
          const queued = await this.queueProjectPhase(nextDetail.project.id, effectiveClassification.phase, { prompt: effectivePromptForExecution });
          queuedRuns.push(queued);
          nextDetail = await this.getProjectDetail(nextDetail.project.id);
          assistantReply = this.builderMessage(
            'assistant',
            [
              `Asked: ${message}`,
              `Started: ${effectiveClassification.phase} for ${nextDetail.project.name} as run ${queued.id}.`,
              `Current state: ${nextDetail.project.status.replace(/_/g, ' ')}.`,
              'What comes next: this conversation stays live while the workflow posts progress, docs updates, terminal output, and the final walkthrough back here.',
            ].join('\n'),
            `${effectiveClassification.phase} started`,
            'default',
          );
          preferredMode = effectiveClassification.phase === 'register' || effectiveClassification.phase === 'control-test' ? 'console' : 'workspace';
        }
      } else {
        assistantReply = this.builderMessage(
          'assistant',
          'I understood that as an execution request, but I still need the exact builder phase. Try "create a plan", "generate the first version", "run validation", "deploy locally", or "register it".',
          'phase needed',
          'warning',
        );
      }
    } else {
      nextDetail = await this.updateProject(detail.project.id, {
        description: shouldCapturePrompt ? mergedPrompt : detail.project.description,
        appType: nextAppType,
        templateId: nextTemplateId,
        controlMode: nextControlMode,
        sourcePath: detail.project.sourceType === 'imported'
          ? brief.sourcePath || detail.project.sourcePath
          : detail.project.sourcePath,
      });
      brief = await this.saveBrief('project', nextDetail.project.id, {
        ...brief,
        prompt: shouldCapturePrompt ? mergedPrompt : brief.prompt,
      });
      const draftChat = await this.runBuilderDraftConversation({
        draftId,
        requestedMode,
        lane: requestedLane,
        projectId: nextDetail.project.id,
        brief,
        conversation,
        projectDetail: nextDetail,
        userMessage: message,
        attachments: input.attachments,
        chatControls: input.chatControls,
        briefUpdated: shouldCapturePrompt,
      });
      assistantReply = draftChat.assistantReply;
      preferredMode = draftChat.preferredMode;
      return {
        draftId,
        projectId: nextDetail.project.id,
        responseKind: 'draft_chat',
        lane: requestedLane,
        assistantReply,
        conversation: draftChat.conversation,
        brief,
        detail: await this.getProjectDetail(nextDetail.project.id),
        preview: await this.getPreviewState(nextDetail.project.id),
        suggestedActions: this.buildSuggestedActions(await this.getProjectDetail(nextDetail.project.id), preferredMode),
        queuedRuns: [],
        preferredMode,
        createdProject: false,
        importedProject: nextDetail.project.sourceType === 'imported',
        provenanceSummary: draftChat.provenanceSummary || null,
        researchSummary: draftChat.researchSummary || null,
      };
    }

    const nextConversation = await this.appendConversationMessages('project', nextDetail.project.id, preferredMode, nextDetail.project.name, [
      this.builderMessage('user', message, 'prompt', 'default', {
        attachments: input.attachments || undefined,
      }),
      assistantReply,
    ]);
    return {
      draftId,
      projectId: nextDetail.project.id,
      responseKind: 'execution',
      lane: requestedLane,
      assistantReply,
      conversation: nextConversation,
      brief,
      detail: await this.getProjectDetail(nextDetail.project.id),
      preview: await this.getPreviewState(nextDetail.project.id),
      suggestedActions: this.buildSuggestedActions(await this.getProjectDetail(nextDetail.project.id), preferredMode),
      queuedRuns,
      preferredMode,
      createdProject: false,
      importedProject: nextDetail.project.sourceType === 'imported',
      provenanceSummary: null,
      researchSummary: null,
    };
  }

  async createProject(input: CreateProjectInput): Promise<AppBuilderProjectDetail> {
    await this.ensureSchema();
    const appType = input.appType || 'web_app';
    const sourceType = input.sourceType || 'generated';
    const template = sourceType === 'imported'
      ? APP_BUILDER_TEMPLATES.find((entry) => entry.id === 'external-project-adapter')!
      : input.templateId
        ? await this.getTemplate(input.templateId)
        : this.templateFor({ appType, sourceType });
    const slug = await this.uniqueSlug(input.name);
    const managedPath = path.join(this.projectsRoot(), slug);
    const projectRecord = await this.prisma.appBuilderProject.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        workspaceId: input.workspaceId || 'default',
        appType,
        sourceType,
        templateId: template.id,
        status: sourceType === 'imported' ? 'importing' : 'draft',
        controlMode: input.controlMode || 'observe_only',
        approvalRequired: true,
        approvalGranted: false,
        requestedPermissionsJson: JSON.stringify(input.requestedPermissions || template.manifestDefaults.permissions.required),
        requestedCapabilitiesJson: JSON.stringify(
          input.requestedCapabilities || (APP_BUILDER_CAPABILITIES[template.id] || []).map((capability) => capability.command),
        ),
        sourcePath: input.sourcePath ?? null,
        managedPath,
        metadataJson: JSON.stringify({
          ...(input.metadata || {}),
          templateId: template.id,
        }),
      },
    });
    await this.ensureDataRoots();
    if (sourceType === 'imported') {
      await this.prisma.importedProjectAdapter.create({
        data: {
          projectId: projectRecord.id,
          adapterType: 'mcp_plugin',
          sourcePath: input.sourcePath || managedPath,
          outputPath: path.join(managedPath, 'adapter'),
          status: 'draft',
          warningsJson: JSON.stringify(['Imported projects default to limited control until approved.']),
        },
      });
    }
    await this.generateManifest(projectRecord.id);
    await this.gatewayEvents.publish({
      type: 'app_builder.project.updated',
      summary: `App Builder project ${projectRecord.name} created`,
      payload: {
        projectId: projectRecord.id,
        sourceType,
        templateId: template.id,
      },
    });
    return this.getProjectDetail(projectRecord.id);
  }

  async importProject(input: CreateProjectInput): Promise<AppBuilderProjectDetail> {
    return this.createProject({
      ...input,
      sourceType: 'imported',
      templateId: 'external-project-adapter',
      controlMode: input.controlMode || 'assist_only',
    });
  }

  async updateProject(id: string, input: Partial<CreateProjectInput> & { approvalGranted?: boolean; deployPath?: string | null; exportPath?: string | null }): Promise<AppBuilderProjectDetail> {
    const existing = await this.prisma.appBuilderProject.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`App Builder project ${id} not found.`);
    }
    const updatedMetadata = {
      ...this.parseJson(existing.metadataJson, {}),
      ...(input.metadata || {}),
    };
    await this.prisma.appBuilderProject.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        workspaceId: input.workspaceId ?? undefined,
        appType: input.appType ?? undefined,
        sourceType: input.sourceType ?? undefined,
        templateId: input.templateId === undefined ? undefined : input.templateId,
        controlMode: input.controlMode ?? undefined,
        approvalGranted: input.approvalGranted === undefined ? undefined : input.approvalGranted,
        sourcePath: input.sourcePath === undefined ? undefined : input.sourcePath,
        deployPath: input.deployPath === undefined ? undefined : input.deployPath,
        exportPath: input.exportPath === undefined ? undefined : input.exportPath,
        requestedPermissionsJson: input.requestedPermissions ? JSON.stringify(input.requestedPermissions) : undefined,
        requestedCapabilitiesJson: input.requestedCapabilities ? JSON.stringify(input.requestedCapabilities) : undefined,
        metadataJson: JSON.stringify(updatedMetadata),
      },
    });
    return this.getProjectDetail(id);
  }

  async deleteProject(id: string): Promise<{ success: true }> {
    await this.ensureSchema();
    const existing = await this.prisma.appBuilderProject.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`App Builder project ${id} not found.`);
    }
    const project = this.toProject(existing);

    try {
      await this.stopTerminalSession(id);
    } catch (error) {
      this.logger.warn(`Failed to stop terminal session before deleting App Builder project ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    await Promise.allSettled([
      this.redis.delete(this.conversationKey('project', id)),
      this.redis.delete(this.briefKey('project', id)),
      this.redis.delete(this.terminalSessionKey(id)),
    ]);
    const memoryCleanupTargets = [
      { kind: 'project_memory', collection: this.projectMemoryCollection(id) },
      { kind: 'semantic_index', collection: this.appBuilderIndexCollection(id) },
      { kind: 'suggestion_vectors', collection: this.appBuilderSuggestionCollection(id) },
    ];
    const memoryCleanupResults = await Promise.allSettled(
      memoryCleanupTargets.map((target) => this.memoryService.clear(target.collection)),
    );
    const cleanupFailures = memoryCleanupResults
      .map((result, index) => ({ result, target: memoryCleanupTargets[index] }))
      .filter((entry): entry is { result: PromiseRejectedResult; target: { kind: string; collection: string } } => entry.result.status === 'rejected');

    await this.prisma.$executeRawUnsafe(`DELETE FROM app_builder_artifacts WHERE projectId = ?`, id);
    await this.prisma.appBuilderProject.delete({ where: { id } });
    for (const failure of cleanupFailures) {
      await this.insertCleanupTask(id, failure.target.collection, failure.target.kind, failure.result.reason).catch((error) => {
        this.logger.warn(`Failed to record cleanup task for deleted App Builder project ${id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    await Promise.allSettled([
      this.deleteManagedAsset(project.deployPath),
      this.deleteManagedAsset(project.exportPath),
      this.deleteManagedAsset(project.managedPath),
    ]);

    await this.gatewayEvents.publish({
      type: 'app_builder.project.updated',
      summary: `App Builder project ${project.name} deleted`,
      payload: {
        projectId: id,
        slug: project.slug,
      },
    });

    return { success: true };
  }

  private async insertCleanupTask(projectId: string, collection: string, cleanupKind: string, error: unknown): Promise<void> {
    const now = new Date().toISOString();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO app_builder_artifacts (id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `cleanup-${randomUUID()}`,
      projectId,
      null,
      'cleanup_task',
      'activity',
      `Cleanup task ${cleanupKind}`,
      JSON.stringify({
        id: `cleanup-${randomUUID()}`,
        projectId,
        cleanupKind,
        collection,
        status: 'pending',
        attempts: 0,
        lastError: error instanceof Error ? error.message : String(error),
        createdAt: now,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      now,
      now,
    );
  }

  async processCleanupTasks(): Promise<void> {
    const records = await this.listArtifactRecordsByKind('__cleanup__', 'cleanup_task', 100).catch(() => [] as any[]);
    const fallbackRows = records.length ? [] : await this.prisma.$queryRawUnsafe<ArtifactRow[]>(
      `SELECT id, projectId, runId, kind, stage, label, payloadJson, createdAt, updatedAt
         FROM app_builder_artifacts
        WHERE kind = ?
        ORDER BY createdAt ASC
        LIMIT 100`,
      'cleanup_task',
    ).catch(() => []);
    const tasks = records.length ? records : fallbackRows.map((row) => this.toArtifact(row));
    for (const task of tasks) {
      const payload = task.payload as Record<string, unknown>;
      if (payload.status === 'resolved' || payload.status === 'cleanup_failed') continue;
      const expiresAt = typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : 0;
      if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
        await this.updateArtifactPayload(task.id, {
          ...payload,
          status: 'cleanup_failed',
          failedAt: new Date().toISOString(),
        }).catch(() => undefined);
        continue;
      }
      const collection = String(payload.collection || '');
      if (!collection) continue;
      try {
        await this.memoryService.clear(collection);
        await this.updateArtifactPayload(task.id, {
          ...payload,
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
          attempts: Number(payload.attempts || 0) + 1,
        }).catch(() => undefined);
      } catch (error) {
        await this.updateArtifactPayload(task.id, {
          ...payload,
          status: 'pending',
          attempts: Number(payload.attempts || 0) + 1,
          lastError: error instanceof Error ? error.message : String(error),
          lastAttemptAt: new Date().toISOString(),
        }).catch(() => undefined);
      }
    }
  }

  private manifestVersion(existingCount: number): string {
    return `0.1.${existingCount + 1}`;
  }

  private capabilitiesForSpec(templateId: string, spec: AppSpecJson | null): RawClawAppManifest['capabilities'] {
    if (!spec) {
      return APP_BUILDER_CAPABILITIES[templateId] || [];
    }
    return spec.controlActions.map((command, index) => ({
      id: command.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
      name: command.split('.').pop()?.replace(/_/g, ' ') || command,
      description: `Generated control action for ${spec.title}.`,
      command,
      requiresApproval: /create|update|delete|deploy|run/i.test(command),
      inputSchema:
        command === 'calculator.press_digit'
          ? { digit: 'string' }
          : command === 'calculator.press_operator'
            ? { operator: 'string' }
            : index === 0
              ? null
              : {},
      outputSchema: command.includes('get_') || command === 'app.status' ? { state: 'object' } : null,
    }));
  }

  private buildManifest(project: AppBuilderProject, template: AppBuilderTemplate, version: string, spec?: AppSpecJson | null): RawClawAppManifest {
    const baseUrl = this.configService.get<string>('rawclawApiUrl') || 'http://localhost:3000';
    const appId = `${project.slug}-${version.replace(/\./g, '-')}`;
    const deploymentLocation = project.deployPath || project.managedPath || null;
    return {
      appId,
      name: project.name,
      appType: project.appType,
      sourceType: project.sourceType,
      version,
      compatibility: createCompatibility({
        sdkVersion: RAWCLAW_APP_SDK_VERSION,
        protocolVersion: RAWCLAW_APP_PROTOCOL_VERSION,
        supportedFeatures: ['http_commands', 'event_stream', 'app_registry'],
      }),
      controlMode: project.controlMode,
      routes: spec?.routes?.length ? spec.routes : template.manifestDefaults.routes,
      capabilities: this.capabilitiesForSpec(template.id, spec || null),
      permissions: {
        required: project.requestedPermissions.length ? project.requestedPermissions : [...template.manifestDefaults.permissions.required],
        dangerous: [...template.manifestDefaults.permissions.dangerous],
        approvalRequired: project.approvalRequired,
      },
      controlEndpoints: {
        commands: `${baseUrl}/api/app-builder/apps/${appId}/control`,
        events: `${baseUrl}/api/app-builder/apps/${appId}/events/stream`,
        health: `${baseUrl}/api/app-builder/apps/${appId}/health`,
      },
      envRequirements: [...template.manifestDefaults.envRequirements],
      deployment: {
        target: project.sourceType === 'imported' ? 'external_import' : 'local_managed',
        location: deploymentLocation,
      },
      metadata: {
        projectId: project.id,
        templateId: template.id,
        workspaceId: project.workspaceId,
        sourcePath: project.sourcePath,
        domain: spec?.domain || null,
        runtimeEvents: spec?.runtimeEvents || [],
        uiSections: spec?.uiSections || [],
      },
    };
  }

  async generateManifest(projectId: string): Promise<AppBuilderManifestRecord> {
    const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!projectRecord) {
      throw new NotFoundException(`App Builder project ${projectId} not found.`);
    }
    const project = this.toProject(projectRecord);
    const template = this.templateFor(project);
    const spec = await this.latestArtifact<AppSpecJson>(projectId, 'spec');
    const existingCount = await this.prisma.appBuilderManifest.count({ where: { projectId } });
    const manifest = this.buildManifest(project, template, this.manifestVersion(existingCount), spec);
    const manifestRecord = await this.prisma.appBuilderManifest.create({
      data: {
        projectId,
        version: manifest.version,
        manifestJson: JSON.stringify(manifest),
      },
    });
    await this.prisma.appBuilderProject.update({
      where: { id: projectId },
      data: {
        latestManifestId: manifestRecord.id,
        metadataJson: JSON.stringify({
          ...this.parseJson(projectRecord.metadataJson, {}),
          lastManifestVersion: manifest.version,
        }),
      },
    });
    return this.toManifest(manifestRecord);
  }

  async getLatestManifest(projectId: string): Promise<AppBuilderManifestRecord | null> {
    const record = await this.prisma.appBuilderManifest.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return record ? this.toManifest(record) : null;
  }

  private async ensurePlanningArtifacts(
    project: AppBuilderProject,
    runId: string | null,
    prompt?: string | null,
  ): Promise<{ intent: AppBuilderIntent; spec: AppSpecJson; architecture: ArchitecturePlan }> {
    const latestIntent = await this.latestArtifact<AppBuilderIntent>(project.id, 'intent');
    const latestSpec = await this.latestArtifact<AppSpecJson>(project.id, 'spec');
    const latestArchitecture = await this.latestArtifact<ArchitecturePlan>(project.id, 'architecture');
    if (latestIntent && latestSpec && latestArchitecture && !prompt) {
      if (!(await this.latestArtifact<{ docs: ProjectBibleDocument[] }>(project.id, 'project_bible'))) {
        const brief = await this.getBriefDraft({ projectId: project.id });
        const taskList = (await this.latestArtifact<AppBuilderTaskList>(project.id, 'task_list')) || this.initialTaskList(project, latestSpec);
        const memorySnapshot = await this.buildProjectMemorySnapshot(project);
        await this.writeProjectDocs(project, brief, taskList, latestSpec, latestArchitecture, memorySnapshot);
      }
      return { intent: latestIntent, spec: latestSpec, architecture: latestArchitecture };
    }

    const template = this.templateFor(project);
    const intent = this.intentParser.parse({
      prompt: prompt || project.description || project.name,
      sourceType: project.sourceType,
      appType: project.appType,
      controlMode: project.controlMode,
      templateId: project.templateId || template.id,
    });
    const spec = this.plannerAi.createSpec(intent, project.name);
    const architecture = this.architectureEngine.createPlan(spec, template);
    const plannerReview = await this.runPlannerModelReview(project, intent, spec, architecture);
    const brief = await this.getBriefDraft({ projectId: project.id });
    const taskList = this.initialTaskList(project, spec);
    const memorySnapshot = await this.captureProjectMemory(
      project,
      `Planner prepared a structured plan for ${project.name}. Summary: ${spec.summary}`,
      ['app-builder', 'planner', 'project-bible', spec.domain],
    );

    await this.storeArtifact(project.id, runId, 'intent', 'intent', 'Parsed builder intent', intent);
    await this.storeArtifact(project.id, runId, 'spec', 'spec', 'Structured app spec', spec);
    await this.storeArtifact(project.id, runId, 'architecture', 'architecture', 'Architecture plan', architecture);
    await this.writeProjectDocs(project, brief, taskList, spec, architecture, memorySnapshot);
    await this.recordActivity(project.id, {
      runId,
      phase: 'plan',
      lane: 'plan',
      kind: 'planner',
      status: 'success',
      title: 'Planner output ready',
      summary: 'Intent, spec, architecture, docs, and task list were created for approval.',
      modelId: plannerReview.model,
      metadata: {
        taskCount: taskList.tasks.length,
        summary: spec.summary,
      },
    });
    await this.patchProjectMetadata(project, {
      plannerReviewSummary: plannerReview.summary,
      plannerReviewModel: plannerReview.model,
      plannerReviewedAt: new Date().toISOString(),
      planBriefFingerprint: this.briefFingerprint(prompt || project.description || project.name),
      planApprovedAt: null,
      planApprovedBriefFingerprint: null,
      planApprovalReviewer: null,
      planApprovalNotes: null,
      templateConfidence: intent.templateConfidence ?? null,
      recommendedGenerationMode: intent.recommendedGenerationMode || null,
      selectedGenerationMode: intent.selectedGenerationMode || intent.recommendedGenerationMode || null,
      generationMode: intent.selectedGenerationMode || intent.recommendedGenerationMode || null,
    });
    await this.generateManifest(project.id);
    return { intent, spec, architecture };
  }

  private async ensureFileGraphArtifact(
    project: AppBuilderProject,
    runId: string | null,
    spec: AppSpecJson,
    architecture: ArchitecturePlan,
  ): Promise<FileGraph> {
    const graph = this.fileGraphGenerator.createGraph(project.managedPath || path.join(this.projectsRoot(), project.slug), project, spec, architecture);
    await this.storeArtifact(project.id, runId, 'file_graph', 'file_graph', 'File graph', graph);
    return graph;
  }

  private generationModeFor(project: AppBuilderProject): AppBuilderGenerationMode {
    const selected = this.parseGenerationMode(project.metadata?.selectedGenerationMode)
      || this.parseGenerationMode(project.metadata?.generationMode);
    if (selected) return selected;
    return project.sourceType === 'imported' ? 'adapter' : 'template';
  }

  private parseGenerationMode(value: unknown): AppBuilderGenerationMode | null {
    if (value === 'template' || value === 'ai_scaffold' || value === 'ai_edit' || value === 'ai_repair' || value === 'adapter') {
      return value;
    }
    return null;
  }

  private async createStagedGeneration(input: {
    project: AppBuilderProject;
    runId: string | null;
    managedPath: string;
    files: Record<string, string>;
    generationMode: AppBuilderGenerationMode;
    securityStatus: StagedGenerationPayload['securityStatus'];
    stagingId?: string | null;
    parentStagingId?: string | null;
    referenceInfluence?: Record<string, unknown> | null;
  }): Promise<{ stagedGeneration: StagedGenerationPayload; diff: StagedDiffPayload; baseSnapshot: AppBuilderGenerationSnapshot }> {
    const { project, runId, managedPath, files, generationMode, securityStatus } = input;
    const workspaceId = project.workspaceId || 'default';
    const stagingId = input.stagingId || `staging-${runId || randomUUID()}`;
    const baseSnapshot = await this.appBuilderStorage.createSnapshot({
      workspaceRoot: managedPath,
      workspaceId,
      projectId: project.id,
      status: 'initial',
    });
    await this.storeArtifact(project.id, runId, 'generation_snapshot', 'codegen', `Base snapshot ${baseSnapshot.id}`, baseSnapshot);
    await this.appBuilderStorage.stageFiles({ workspaceRoot: managedPath, stagingId, files });

    const diffs: WorkspaceFileDiff[] = [];
    const stagedFileHashes: Record<string, string> = {};
    const fileStates: StagedGenerationFileState[] = [];

    for (const [relativePath, contents] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
      const normalized = this.normalizeWorkspacePath(relativePath);
      const currentPath = this.safeProjectPath({ ...project, managedPath }, normalized);
      const previousContent = existsSync(currentPath) ? await fs.readFile(currentPath, 'utf8') : null;
      const stagedHash = this.appBuilderStorage.hashContent(contents);
      const baseHash = baseSnapshot.fileHashes[normalized] || null;
      stagedFileHashes[normalized] = stagedHash;
      diffs.push(this.buildLineDiff(normalized, previousContent, contents));
      fileStates.push({
        path: normalized,
        hash: stagedHash,
        baseHash,
        status: !baseHash ? 'added' : baseHash === stagedHash ? 'unchanged' : 'modified',
      });
    }

    const diffPayload: StagedDiffPayload = {
      id: `diff-${stagingId}`,
      projectId: project.id,
      stagingId,
      files: diffs,
      unifiedDiff: this.renderUnifiedDiff(diffs),
      summary: this.summarizeDiffs(diffs),
      createdAt: new Date().toISOString(),
    };

    const now = new Date().toISOString();
    const approvalLineage = input.parentStagingId
      ? [...(await this.securityApprovalLineage(project.id, input.parentStagingId))]
      : [];
    const stagedGeneration: StagedGenerationPayload = {
      id: stagingId,
      projectId: project.id,
      generationMode,
      baseSnapshotId: baseSnapshot.id,
      parentStagingId: input.parentStagingId || null,
      status: 'open',
      changedFiles: Object.keys(files).map((filePath) => this.normalizeWorkspacePath(filePath)).sort((a, b) => a.localeCompare(b)),
      securityStatus,
      diffSummary: diffPayload.summary,
      validationStatus: 'not_run',
      createdAt: now,
      updatedAt: now,
      stagingRoot: path.join(managedPath, '.app-builder', 'staging', stagingId),
      baseFileHashes: baseSnapshot.fileHashes,
      stagedFileHashes,
      files: fileStates,
      appliedFilePaths: [],
      discardedFilePaths: [],
      conflicts: [],
      conflictResolutions: [],
      securityApprovalLineage: approvalLineage,
      referenceInfluence: input.referenceInfluence || null,
    };

    await this.storeArtifact(project.id, runId, 'staged_generation', 'codegen', `Staged generation ${stagingId}`, stagedGeneration);
    await this.storeArtifact(project.id, runId, 'staged_diff', 'codegen', `Staged diff ${stagingId}`, diffPayload);
    await this.patchProjectMetadata(project, {
      latestStagingId: stagingId,
      latestStagingBaseSnapshotId: baseSnapshot.id,
      generationMode,
    });
    await this.pruneProjectSnapshots(project, managedPath).catch((error) => {
      this.logger.warn(`Snapshot pruning failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
    });

    return { stagedGeneration, diff: diffPayload, baseSnapshot };
  }

  private async writeGeneratedFiles(managedPath: string, files: Record<string, string>): Promise<void> {
    await fs.mkdir(managedPath, { recursive: true });
    for (const [relativePath, contents] of Object.entries(files)) {
      await this.writeFile(path.join(managedPath, relativePath), contents);
    }
  }

  private async generateManagedProjectFromArtifacts(
    project: AppBuilderProject,
    runId: string | null,
    targetedPaths?: string[] | null,
    generationModeOverride?: AppBuilderGenerationMode | null,
    modelContext?: { userRequest?: string | null; validationOutput?: string | null } | null,
    parentStagingId?: string | null,
  ): Promise<Record<string, unknown>> {
    const { spec, architecture } = await this.ensurePlanningArtifacts(project, runId);
    const graph = await this.ensureFileGraphArtifact(project, runId, spec, architecture);
    const manifestRecord = (await this.getLatestManifest(project.id)) || (await this.generateManifest(project.id));
    const managedPath = await this.ensureProjectRoot(project);
    const builderBrief = await this.runBuilderModelBrief(project, spec, architecture);
    const brief = await this.getBriefDraft({ projectId: project.id });
    const existingTaskList = (await this.latestArtifact<AppBuilderTaskList>(project.id, 'task_list')) || this.initialTaskList(project, spec);
    const nextTaskList = this.updateTaskStatuses(existingTaskList, [
      { id: 'plan-review', status: 'completed', detail: 'Planner output approved and handed off to the builder lane.' },
      { id: 'workspace-bootstrap', status: 'completed' },
      ...existingTaskList.tasks
        .filter((task) => task.phase === 'generate')
        .slice(0, 3)
        .map((task, index) => ({
          id: task.id,
          status: index === 0 ? 'in_progress' as const : task.status,
        })),
    ]);
    const generationMode = generationModeOverride || this.generationModeFor(project);
    const aiMode = generationMode === 'ai_scaffold' || generationMode === 'ai_edit' || generationMode === 'ai_repair';
    const modelFileMap = aiMode
      ? await this.generateModelFileMap({
          project: { ...project, managedPath },
          spec,
          architecture,
          fileGraph: graph,
          manifest: manifestRecord.manifest,
          mode: generationMode,
          targetedPaths,
          userRequest: modelContext?.userRequest || project.description || null,
          validationOutput: modelContext?.validationOutput || null,
        })
      : null;
    const files = modelFileMap?.files || this.codeGenerationEngine.generateFiles({
      project: { ...project, managedPath },
      spec,
      architecture,
      fileGraph: graph,
      manifest: manifestRecord.manifest,
      targetedPaths,
    });
    const stagingId = `staging-${runId || randomUUID()}`;
    const securityScan = this.contentSecurity.scan(
      Object.entries(files).map(([filePath, content]) => ({ path: filePath, content })),
      stagingId,
    );
    const generatedTestFiles = Object.keys(files).filter((filePath) => /\.test\.(ts|tsx|js|jsx)$/.test(filePath));
    if (generatedTestFiles.length) {
      await this.storeArtifact(project.id, runId, 'generated_tests', 'validation', 'Generated test files', {
        files: generatedTestFiles,
        mode: generationMode,
        requiredCategories: ['smoke_render', 'primary_user_workflow', 'rawclaw_manifest_capability_coverage', 'runtime_handler_coverage'],
        createdAt: new Date().toISOString(),
      });
    }
    await this.storeArtifact(project.id, runId, 'security_scan', 'validation', 'Generated content security scan', securityScan);
    if (securityScan.status === 'blocked') {
      throw new Error(`Generated content was blocked by security scan: ${securityScan.findings.filter((finding) => finding.status === 'blocked').map((finding) => finding.summary).join(' ')}`);
    }
    await this.ensureDataRoots();
    const staged = await this.createStagedGeneration({
      project,
      runId,
      managedPath,
      files,
      generationMode,
      securityStatus: securityScan.status,
      stagingId,
      parentStagingId,
      referenceInfluence: modelFileMap?.rationale || null,
    });
    await this.patchProjectMetadata(project, {
      lastBuilderBriefSummary: builderBrief.summary,
      lastBuilderBriefModel: builderBrief.model,
      lastBuilderBriefAt: new Date().toISOString(),
    });
    const memorySnapshot = await this.captureProjectMemory(
      project,
      `Builder generated files for ${project.name}. Files: ${Object.keys(files).slice(0, 8).join(', ') || 'none'}.`,
      ['app-builder', 'builder', 'generated-files'],
    );
    await this.writeProjectDocs(project, brief, nextTaskList, spec, architecture, memorySnapshot);
    await this.recordActivity(project.id, {
      runId,
      phase: 'generate',
      lane: 'build',
      kind: 'builder',
      status: 'success',
      title: 'Builder staged project files',
      summary: `Staged ${Object.keys(files).length} files for review before applying to ${project.name}.`,
      modelId: builderBrief.model,
      metadata: {
        stagingId: staged.stagedGeneration.id,
        baseSnapshotId: staged.baseSnapshot.id,
        paths: Object.keys(files),
        diffSummary: staged.diff.summary,
        generationMode,
        modelRationale: modelFileMap?.rationale || null,
      },
    });
    return {
      managedPath,
      stagingId: staged.stagedGeneration.id,
      baseSnapshotId: staged.baseSnapshot.id,
      diffSummary: staged.diff.summary,
      generatedFiles: Object.keys(files),
      fileGraph: graph.generationOrder,
      specSummary: spec.summary,
      builderBrief: builderBrief.summary,
      securityScanStatus: securityScan.status,
      generationMode,
      modelRationale: modelFileMap?.rationale || null,
    };
  }

  private failedFilesFromValidation(session: ValidationSession, fileGraph: FileGraph): string[] {
    const failedOutput = session.commands
      .filter((command) => command.status === 'failed' && command.output)
      .map((command) => command.output || '')
      .join('\n');
    const matched = fileGraph.files
      .filter((file) => file.validationOwner && failedOutput.includes(file.validationOwner))
      .map((file) => file.path);
    if (matched.length) {
      return matched;
    }
    const generated = fileGraph.files.filter((file) => file.sourceKind === 'generated').map((file) => file.path);
    return generated.length ? generated : fileGraph.generationOrder;
  }

  private async runValidationLoop(project: AppBuilderProject, runId: string | null, options: ValidationRunOptions = {}): Promise<{ validation: AppBuilderValidationResult; session: ValidationSession; healingAttempts: HealingAttempt[] }> {
    const { spec, architecture } = await this.ensurePlanningArtifacts(project, runId);
    const graph = await this.ensureFileGraphArtifact(project, runId, spec, architecture);
    const manifestRecord = (await this.getLatestManifest(project.id)) || (await this.generateManifest(project.id));
    const template = this.templateFor(project);
    const projectRoot = project.managedPath || path.join(this.projectsRoot(), project.slug);
    const validationSnapshotId = options.validationSnapshotId || `validation-${runId || randomUUID()}`;
    const trigger = options.trigger || 'user_requested';
    const harnessMetadata = this.harnessMetadata.create({
      projectId: project.id,
      appBuilderRunId: runId,
      snapshotId: validationSnapshotId,
      stagingId: options.stagingId || null,
      generationMode: project.sourceType === 'imported' ? 'adapter' : 'template',
      validationTrigger: trigger,
      commandKind: 'other',
      fileHashSummary: null,
      timeoutPolicy: { timeoutMs: 120_000, gracefulCancelMs: 5_000 },
      supersededBy: null,
      rawOutputArtifactIds: [],
    });
    const initialSession = await this.validationEngine.runValidation(projectRoot, template, 1, {
      snapshotId: validationSnapshotId,
      trigger,
      harnessMetadata,
      timeoutMs: 120_000,
    });
    const { session, healingAttempts } = await this.selfHealingLoop.recover({
      initialSession,
      maxAttempts: 3,
      determineFailedFiles: (currentSession) => this.failedFilesFromValidation(currentSession, graph),
      regenerate: async (failedFiles, _attempt, currentSession) => {
        const validationOutput = currentSession.commands
          .filter((command) => command.status === 'failed')
          .map((command) => command.output || '')
          .filter(Boolean)
          .join('\n');
        const staged = await this.generateManagedProjectFromArtifacts(project, runId, failedFiles, 'ai_repair', {
          validationOutput,
          userRequest: `Repair validation failures in ${failedFiles.join(', ')}`,
        });
        if (typeof staged.stagingId === 'string') {
          await this.applyRepairPatch(project, staged.stagingId, failedFiles, runId);
        }
      },
      rerunValidation: async (attempts) => this.validationEngine.runValidation(projectRoot, template, attempts, {
        snapshotId: validationSnapshotId,
        trigger: 'repair_attempt',
        harnessMetadata: {
          ...harnessMetadata,
          validationTrigger: 'repair_attempt',
        },
        timeoutMs: 120_000,
      }),
      storeAttempt: async (attempt) => {
        await this.storeArtifact(project.id, runId, 'heal_attempt', 'healing', `Healing attempt ${attempt.attempt}`, attempt);
      },
    });

    const staticChecks = await this.validationChecks(project, manifestRecord.manifest, session);
    const validation: AppBuilderValidationResult = {
      id: randomUUID(),
      projectId: project.id,
      runId,
      phase: 'validate',
      ok: staticChecks.every((check) => check.status !== 'failed'),
      snapshotId: validationSnapshotId,
      status: session.status || (trigger === 'auto_post_apply' ? 'current' : null),
      harnessRunId: session.harnessRunId || null,
      checks: staticChecks,
      createdAt: new Date().toISOString(),
    };
    if (trigger === 'auto_post_apply') {
      const current = await this.prisma.appBuilderProject.findUnique({ where: { id: project.id } });
      const metadata = this.parseJson<Record<string, unknown>>(current?.metadataJson, {});
      if (metadata.latestAppliedSnapshotId !== validationSnapshotId) {
        session.status = 'stale';
        validation.status = 'stale';
        validation.ok = false;
        await this.workflowState.markValidationStale(project.id, validation.id);
      }
    }
    await this.storeArtifact(project.id, runId, 'validation', 'validation', 'Validation session', session);
    const brief = await this.getBriefDraft({ projectId: project.id });
    const existingTaskList = (await this.latestArtifact<AppBuilderTaskList>(project.id, 'task_list')) || this.initialTaskList(project, spec);
    const nextTaskList = this.updateTaskStatuses(existingTaskList, [
      { id: 'validate-build', status: validation.ok ? 'completed' : 'blocked', detail: validation.ok ? 'Validation passed and the project is ready for deploy review.' : 'Validation failed and needs a retry or file fixes.' },
    ]);
    const memorySnapshot = await this.captureProjectMemory(
      project,
      validation.ok
        ? `Validation passed for ${project.name} after ${session.attempts} attempt(s).`
        : `Validation failed for ${project.name}. Main issue: ${validation.checks.find((check) => check.status === 'failed')?.summary || 'Unknown failure.'}`,
      ['app-builder', 'validation', validation.ok ? 'passed' : 'failed'],
    );
    await this.writeProjectDocs(project, brief, nextTaskList, spec, architecture, memorySnapshot);
    await this.recordActivity(project.id, {
      runId,
      phase: 'validate',
      kind: 'validator',
      status: validation.ok ? 'success' : 'warning',
      title: validation.ok ? 'Validation passed' : 'Validation needs attention',
      summary: validation.ok
        ? `Build and typecheck passed after ${session.attempts} attempt(s).`
        : 'Validation failed and the workspace has been updated with the latest logs and healing output.',
      metadata: {
        attempts: session.attempts,
        healingAttempts: healingAttempts.length,
      },
    });
    if (validation.ok && validation.status !== 'stale' && validation.status !== 'superseded') {
      await this.workflowState.promoteValidation(project.id, validation);
      await this.generateProjectSuggestions(project, validation).catch((error) => {
        this.logger.warn(`Suggestion pass failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return { validation, session, healingAttempts };
  }

  private async generateProjectSuggestions(project: AppBuilderProject, validation: AppBuilderValidationResult): Promise<void> {
    const current = await this.prisma.appBuilderProject.findUnique({ where: { id: project.id } });
    const metadata = this.parseJson<Record<string, unknown>>(current?.metadataJson, {});
    const lastAt = typeof metadata.lastSuggestionAt === 'string' ? Date.parse(metadata.lastSuggestionAt) : 0;
    if (lastAt && Date.now() - lastAt < 10 * 60 * 1000) {
      return;
    }
    const suggestions: Array<Record<string, unknown>> = [];
    const failedChecks = validation.checks.filter((check) => check.status === 'failed');
    if (failedChecks.length) {
      suggestions.push({
        id: `suggestion-${randomUUID()}`,
        category: 'validation',
        issueCode: 'validation_failed',
        title: 'Fix failing validation checks',
        summary: failedChecks.slice(0, 3).map((check) => check.label).join(', '),
        severity: 'high',
        primaryReference: failedChecks[0]?.id || 'validation',
        createdAt: new Date().toISOString(),
      });
    }
    const coverage = validation.checks.find((check) => check.id === 'runtime_coverage');
    if (coverage?.status === 'passed') {
      suggestions.push({
        id: `suggestion-${randomUUID()}`,
        category: 'control',
        issueCode: 'control_contract_ready',
        title: 'Control contract is ready for registration',
        summary: coverage.summary,
        severity: 'info',
        primaryReference: 'runtime_coverage',
        createdAt: new Date().toISOString(),
      });
    }
    const testCheck = validation.checks.find((check) => check.id === 'test');
    if (testCheck?.status === 'passed') {
      suggestions.push({
        id: `suggestion-${randomUUID()}`,
        category: 'tests',
        issueCode: 'generated_tests_passing',
        title: 'Generated tests are passing',
        summary: 'Vitest coverage is available as a baseline for future edits.',
        severity: 'info',
        primaryReference: 'generated_tests',
        createdAt: new Date().toISOString(),
      });
    }
    for (const suggestion of suggestions.slice(0, 10)) {
      const prepared = await this.prepareSuggestionForStorage(project.id, suggestion);
      if (!prepared) continue;
      await this.storeArtifact(project.id, null, 'project_suggestion', 'validation', String(prepared.title), prepared);
      await this.recordActivity(project.id, {
        kind: 'system',
        status: prepared.severity === 'high' ? 'warning' : 'success',
        title: String(prepared.title),
        summary: String(prepared.summary),
        metadata: prepared,
      });
    }
    await this.patchProjectMetadata(project, {
      lastSuggestionAt: new Date().toISOString(),
    });
  }

  private async prepareSuggestionForStorage(projectId: string, suggestion: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const normalizedPrimaryReference = this.normalizeSuggestionReference(suggestion.primaryReference);
    const category = String(suggestion.category || 'general');
    const issueCode = String(suggestion.issueCode || 'observation');
    const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    const projectMetadata = this.parseJson<Record<string, unknown>>(projectRecord?.metadataJson, {});
    const suggestionGeneration = Number(projectMetadata.suggestionCollectionGeneration || 0);
    const active = (await this.listArtifactsByKind<Record<string, unknown>>(projectId, 'project_suggestion', 50))
      .filter((entry) => !entry.archivedAt && Number(entry.suggestionCollectionGeneration || 0) === suggestionGeneration);
    const exactDuplicate = active.some((entry) =>
      String(entry.category || 'general') === category
      && String(entry.issueCode || 'observation') === issueCode
      && this.normalizeSuggestionReference(entry.normalizedPrimaryReference || entry.primaryReference) === normalizedPrimaryReference,
    );
    if (exactDuplicate) return null;

    const content = `${suggestion.title || ''}\n${suggestion.summary || ''}\n${category}:${issueCode}:${normalizedPrimaryReference}`;
    const collection = this.appBuilderSuggestionCollection(projectId);
    try {
      const semanticMatches = await this.memoryService.search({
        query: content,
        collection,
      });
      if (semanticMatches.some((entry) =>
        entry.score >= this.appBuilderConfig.values.suggestionSimilarityThreshold
        && entry.tags?.includes(`suggestion_generation:${suggestionGeneration}`),
      )) {
        return null;
      }
      const vector = await this.memoryService.add({
        collection,
        source: `suggestion:${suggestion.id}`,
        tags: ['app_builder', projectId, 'project_suggestion', category, issueCode, `suggestion_generation:${suggestionGeneration}`],
        content,
      });
      return {
        ...suggestion,
        normalizedPrimaryReference,
        suggestionCollectionGeneration: suggestionGeneration,
        embeddingVectorId: vector.id,
        dedupMode: 'embedding',
      };
    } catch (error) {
      this.logger.warn(`Suggestion embedding dedup failed for ${projectId}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        ...suggestion,
        normalizedPrimaryReference,
        suggestionCollectionGeneration: suggestionGeneration,
        dedupMode: 'lexical_fallback',
      };
    }
  }

  private normalizeSuggestionReference(value: unknown): string {
    return String(value || 'project')
      .replace(/\\/g, '/')
      .trim()
      .toLowerCase();
  }

  private async archiveActiveProjectSuggestions(projectId: string, reason: string): Promise<void> {
    const records = await this.listArtifactRecordsByKind(projectId, 'project_suggestion', 100).catch(() => []);
    const archivedAt = new Date().toISOString();
    for (const record of records) {
      const payload = record.payload as Record<string, unknown>;
      if (payload.archivedAt) continue;
      await this.updateArtifactPayload(record.id, {
        ...payload,
        archivedAt,
        archiveReason: reason,
      }).catch(() => undefined);
    }
    const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    const project = projectRecord ? this.toProject(projectRecord) : null;
    const generation = Number(project?.metadata?.suggestionCollectionGeneration || 0) + 1;
    if (project) {
      await this.patchProjectMetadata(project, {
        suggestionCollectionGeneration: generation,
        suggestionVectorClearPending: true,
        suggestionVectorClearFailed: false,
        suggestionVectorClearAttemptCount: 0,
        suggestionVectorClearLastError: null,
        suggestionVectorClearRequestedAt: new Date().toISOString(),
      });
    }
    await this.clearSuggestionVectors(projectId, generation, 0).catch(() => undefined);
  }

  async retrySuggestionVectorClear(projectId: string): Promise<AppBuilderProjectDetail> {
    const detail = await this.getProjectDetail(projectId);
    const generation = Number(detail.project.metadata?.suggestionCollectionGeneration || 0);
    await this.clearSuggestionVectors(projectId, generation, Number(detail.project.metadata?.suggestionVectorClearAttemptCount || 0));
    await this.recordActivity(projectId, {
      kind: 'system',
      status: 'success',
      title: 'Suggestion vector clear retried',
      summary: 'Suggestion deduplication vectors were cleared for the current Plan generation.',
      metadata: { suggestionCollectionGeneration: generation },
    });
    return this.getProjectDetail(projectId);
  }

  private async clearSuggestionVectors(projectId: string, generation: number, previousAttempts: number): Promise<void> {
    const record = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!record) return;
    const project = this.toProject(record);
    try {
      await this.memoryService.clear(this.appBuilderSuggestionCollection(projectId));
      await this.patchProjectMetadata(project, {
        suggestionCollectionGeneration: generation,
        suggestionVectorClearPending: false,
        suggestionVectorClearFailed: false,
        suggestionVectorClearAttemptCount: 0,
        suggestionVectorClearLastError: null,
        suggestionVectorClearLastAttemptAt: new Date().toISOString(),
      });
    } catch (error) {
      const attemptCount = previousAttempts + 1;
      const failed = attemptCount >= this.appBuilderConfig.values.suggestionVectorClearMaxAttempts;
      await this.patchProjectMetadata(project, {
        suggestionCollectionGeneration: generation,
        suggestionVectorClearPending: !failed,
        suggestionVectorClearFailed: failed,
        suggestionVectorClearAttemptCount: attemptCount,
        suggestionVectorClearLastError: error instanceof Error ? error.message : String(error),
        suggestionVectorClearLastAttemptAt: new Date().toISOString(),
      });
      if (failed) {
        await this.recordActivity(projectId, {
          kind: 'system',
          status: 'warning',
          title: 'Suggestion deduplication degraded',
          summary: 'RawClaw could not clear stale suggestion vectors after repeated attempts.',
          metadata: { suggestionCollectionGeneration: generation, attemptCount },
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async validationChecks(project: AppBuilderProject, manifest: RawClawAppManifest | null, session?: ValidationSession | null): Promise<AppBuilderValidationCheck[]> {
    const managedPath = project.managedPath || '';
    const manifestPath = path.join(managedPath, 'rawclaw.app.manifest.json');
    const sdkHookPath = path.join(managedPath, 'src', 'rawclaw-sdk.ts');
    const checks: AppBuilderValidationCheck[] = [];
    if (manifest) {
      const result = validateManifest(manifest);
      checks.push({
        id: 'manifest',
        label: 'Manifest validity',
        status: result.ok ? 'passed' : 'failed',
        summary: result.ok ? 'Manifest satisfies the v1 RawClaw SDK contract.' : result.errors.join(' '),
      });
    }
    checks.push({
      id: 'project_layout',
      label: 'Managed project layout',
      status: managedPath && existsSync(managedPath) ? 'passed' : 'failed',
      summary: managedPath && existsSync(managedPath) ? 'Managed project path exists.' : 'Managed project path has not been generated yet.',
    });
    checks.push({
      id: 'sdk_contract',
      label: 'SDK hooks',
      status: existsSync(sdkHookPath) ? 'passed' : 'failed',
      summary: existsSync(sdkHookPath) ? 'SDK hook file is present.' : 'SDK hook file is missing.',
    });
    checks.push({
      id: 'manifest_file',
      label: 'Manifest file',
      status: existsSync(manifestPath) ? 'passed' : 'failed',
      summary: existsSync(manifestPath) ? 'Manifest file is present in the managed project.' : 'Manifest file is missing from the managed project.',
    });
    if (project.sourceType === 'generated') {
      const appTestPath = path.join(managedPath, 'src', 'App.test.tsx');
      const contractTestPath = path.join(managedPath, 'src', 'rawclaw-contract.test.ts');
      checks.push({
        id: 'generated_tests',
        label: 'Generated tests',
        status: existsSync(appTestPath) && existsSync(contractTestPath) ? 'passed' : 'failed',
        summary: existsSync(appTestPath) && existsSync(contractTestPath)
          ? 'Vitest smoke and RawClaw contract tests are present.'
          : 'Generated app tests are missing.',
      });
    } else if (project.sourceType === 'imported') {
      const bridgeConfigPath = path.join(managedPath, 'adapter', 'bridge-config.json');
      const coveragePath = path.join(managedPath, 'adapter', 'handler-coverage.json');
      checks.push({
        id: 'adapter_bridge',
        label: 'Adapter bridge files',
        status: existsSync(bridgeConfigPath) && existsSync(coveragePath) ? 'passed' : 'failed',
        summary: existsSync(bridgeConfigPath) && existsSync(coveragePath)
          ? 'Adapter bridge config and coverage report are present.'
          : 'Adapter bridge config or coverage report is missing.',
      });
    }
    if (manifest) {
      const coverage = await this.evaluateRuntimeCoverage(project, manifest);
      checks.push({
        id: 'runtime_coverage',
        label: 'Runtime handler coverage',
        status: coverage.ok ? 'passed' : 'failed',
        summary: coverage.ok
          ? `All ${coverage.capabilities.length} manifest capabilities have command handlers.`
          : `Missing handlers: ${coverage.missingCommands.join(', ')}`,
        details: JSON.stringify(coverage, null, 2),
      });
    }
    if (session) {
      for (const command of session.commands) {
        checks.push({
          id: command.id,
          label: command.label,
          status: command.status,
          summary: command.status === 'passed'
            ? `${command.label} completed successfully.`
            : command.output || `${command.label} failed.`,
          details: command.output || null,
        });
      }
    } else {
      checks.push({
        id: 'build',
        label: 'Build/lint/typecheck',
        status: 'skipped',
        summary: 'Build commands have not run yet.',
      });
    }
    checks.push({
      id: 'deployment',
      label: 'Deployment readiness',
      status: project.deployPath ? 'passed' : 'skipped',
      summary: project.deployPath ? 'A local deployment snapshot exists.' : 'Deployment has not been run yet.',
    });
    checks.push({
      id: 'registration',
      label: 'Registration readiness',
      status: manifest ? 'passed' : 'failed',
      summary: manifest ? 'Manifest can be registered after approval and deployment.' : 'Registration is blocked until a manifest exists.',
    });
    return checks;
  }

  async validateProject(projectId: string): Promise<AppBuilderValidationResult> {
    const detail = await this.getProjectDetail(projectId);
    const manifest = detail.manifests[0]?.manifest || null;
    const session = await this.latestArtifact<ValidationSession>(projectId, 'validation');
    const checks = await this.validationChecks(detail.project, manifest, session);
    return {
      id: randomUUID(),
      projectId,
      phase: 'validate',
      ok: checks.every((check) => check.status !== 'failed'),
      checks,
      createdAt: new Date().toISOString(),
    };
  }

  async approveSecurityFinding(projectId: string, payload: {
    stagingId: string;
    filePath: string;
    fileHash: string;
    patternId: string;
    decision?: 'approved' | 'rejected';
    notes?: string | null;
    approverId?: string | null;
    approverRole?: 'local_owner' | 'authenticated_user' | 'admin' | 'system';
  }) {
    const detail = await this.getProjectDetail(projectId);
    const approval = {
      id: randomUUID(),
      stagingId: payload.stagingId,
      filePath: payload.filePath,
      fileHash: payload.fileHash,
      patternId: payload.patternId,
      decision: payload.decision || 'approved',
      approverId: payload.approverId || 'local-owner',
      approverRole: payload.approverRole || 'local_owner',
      notes: payload.notes || null,
      createdAt: new Date().toISOString(),
    };
    await this.storeArtifact(detail.project.id, null, 'security_approval', 'validation', `Security approval ${approval.patternId}`, approval);
    await this.recordActivity(detail.project.id, {
      kind: 'approval',
      status: approval.decision === 'approved' ? 'success' : 'warning',
      title: `Security ${approval.decision}`,
      summary: `${approval.patternId} for ${approval.filePath} was ${approval.decision}.`,
      metadata: approval,
    });
    return approval;
  }

  async approveProject(projectId: string, payload?: { reviewer?: string | null; notes?: string | null; controlMode?: AppBuilderProject['controlMode'] }): Promise<AppBuilderProjectDetail> {
    const existing = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!existing) {
      throw new NotFoundException(`App Builder project ${projectId} not found.`);
    }
    const project = this.toProject(existing);
    const pendingStage = this.pendingApprovalStage(project);
    const metadata = this.parseJson<Record<string, unknown>>(existing.metadataJson, {});
    const stagePatch =
      pendingStage === 'plan'
                ? {
                    planApprovalReviewer: payload?.reviewer || 'planner-review',
                    planApprovalNotes: payload?.notes || null,
                    planApprovedAt: new Date().toISOString(),
                    planApprovedBriefFingerprint:
                      typeof metadata.planBriefFingerprint === 'string'
                        ? metadata.planBriefFingerprint
                        : this.briefFingerprint(existing.description || ''),
                  }
        : pendingStage === 'build'
          ? {
              buildApprovalReviewer: payload?.reviewer || 'builder-review',
              buildApprovalNotes: payload?.notes || null,
              buildApprovedAt: new Date().toISOString(),
            }
          : pendingStage === 'validate'
            ? {
                validationApprovalReviewer: payload?.reviewer || 'validation-review',
                validationApprovalNotes: payload?.notes || null,
                validationApprovedAt: new Date().toISOString(),
              }
            : pendingStage === 'deploy'
              ? {
                  deployApprovalReviewer: payload?.reviewer || 'deploy-review',
                  deployApprovalNotes: payload?.notes || null,
                  deployApprovedAt: new Date().toISOString(),
                }
              : pendingStage === 'register'
                ? {
                    registerApprovalReviewer: payload?.reviewer || 'register-review',
                    registerApprovalNotes: payload?.notes || null,
                    registerApprovedAt: new Date().toISOString(),
                  }
                : {
                    approvalReviewer: payload?.reviewer || 'operator',
                    approvalNotes: payload?.notes || null,
                    approvalReviewedAt: new Date().toISOString(),
                  };
    await this.workflowState.approvePendingStage(projectId, stagePatch, payload?.controlMode || null);
    if (pendingStage === 'plan') {
      await this.archiveActiveProjectSuggestions(projectId, 'plan_reapproved');
    }
    const refreshed = this.toProject((await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } }))!);
    const spec = await this.latestArtifact<AppSpecJson>(projectId, 'spec');
    const architecture = await this.latestArtifact<ArchitecturePlan>(projectId, 'architecture');
    const brief = await this.getBriefDraft({ projectId });
    const currentTasks = (await this.latestArtifact<AppBuilderTaskList>(projectId, 'task_list')) || this.initialTaskList(refreshed, spec);
    const nextTasks = pendingStage === 'plan'
      ? this.updateTaskStatuses(currentTasks, [
          { id: 'plan-review', status: 'completed', detail: 'Plan approved and ready for builder execution.' },
        ])
      : pendingStage === 'build'
        ? this.updateTaskStatuses(currentTasks, currentTasks.tasks.filter((task) => task.phase === 'generate').map((task) => ({ id: task.id, status: 'completed' as const })))
        : currentTasks;
    const memorySnapshot = await this.captureProjectMemory(
      refreshed,
      `Approval recorded for ${pendingStage || 'project'} on ${refreshed.name}.`,
      ['app-builder', 'approval', pendingStage || 'general'],
    );
    await this.writeProjectDocs(refreshed, brief, nextTasks, spec, architecture, memorySnapshot);
    const approvalPhase: AppBuilderPhase | null =
      pendingStage === 'plan'
        ? 'plan'
        : pendingStage === 'build'
          ? 'generate'
          : pendingStage === 'validate'
            ? 'validate'
            : pendingStage === 'deploy'
              ? 'deploy'
              : pendingStage === 'register'
                ? 'register'
                : null;
    await this.recordActivity(projectId, {
      phase: approvalPhase,
      kind: 'approval',
      status: 'success',
      title: `${pendingStage || 'project'} approved`,
      summary: payload?.notes || `Approval captured for ${pendingStage || 'project'}.`,
      metadata: {
        reviewer: payload?.reviewer || null,
      },
    });
    return this.getProjectDetail(projectId);
  }

  async acknowledgeInterruption(projectId: string, payload?: { reviewer?: string | null; notes?: string | null }): Promise<AppBuilderProjectDetail> {
    await this.workflowState.acknowledgeInterruption(projectId, payload?.reviewer || 'local-owner');
    await this.recordActivity(projectId, {
      kind: 'approval',
      status: 'info',
      title: 'Interruption acknowledged',
      summary: payload?.notes || 'The interrupted workflow state was acknowledged and retry options are available again.',
      metadata: {
        reviewer: payload?.reviewer || 'local-owner',
        notes: payload?.notes || null,
      },
    });
    return this.getProjectDetail(projectId);
  }

  async retrySmokeRestore(projectId: string): Promise<AppBuilderProjectDetail> {
    const detail = await this.getProjectDetail(projectId);
    const manifest = detail.manifests[0]?.manifest || null;
    if (!manifest) {
      throw new BadRequestException('Smoke restore requires a generated manifest.');
    }
    const snapshotState = detail.project.metadata?.smokeRestoreSnapshotState;
    const snapshotEvents = detail.project.metadata?.smokeRestoreSnapshotEvents;
    if (!snapshotState || typeof snapshotState !== 'object') {
      throw new BadRequestException('No pre-smoke control-state snapshot is available to restore.');
    }
    await this.saveControlState(manifest.appId, snapshotState as Record<string, unknown>);
    await this.redis.delete(this.appEventsKey(manifest.appId));
    if (Array.isArray(snapshotEvents)) {
      for (const event of snapshotEvents.slice().reverse()) {
        await this.redis.pushJsonList(this.appEventsKey(manifest.appId), event, 120);
      }
    }
    await this.patchProjectMetadata(detail.project, {
      smokeRestoreFailed: false,
      smokeRestorePending: false,
      smokeRestoreAttemptCount: 0,
      smokeRestoreMaxAttempts: this.appBuilderConfig.values.smokeRestoreMaxAttempts,
      smokeRestoreLastError: null,
      smokeRestoreRecoveredAt: new Date().toISOString(),
    });
    await this.recordActivity(projectId, {
      kind: 'system',
      status: 'success',
      title: 'Smoke restore retried',
      summary: 'Control state was restored from the stored pre-smoke snapshot.',
      metadata: { appId: manifest.appId },
    });
    return this.getProjectDetail(projectId);
  }

  async resetControlState(projectId: string, payload: { confirm?: boolean | null; reason?: string | null } = {}): Promise<AppBuilderProjectDetail> {
    const detail = await this.getProjectDetail(projectId);
    const manifest = detail.manifests[0]?.manifest || null;
    if (!manifest) {
      throw new BadRequestException('Control-state reset requires a generated manifest.');
    }
    if (!detail.project.metadata?.smokeRestoreFailed) {
      throw new BadRequestException({
        code: 'reset_not_allowed',
        message: 'Control-state reset is only allowed after smoke restore has failed.',
      });
    }
    if (payload.confirm !== true || !payload.reason?.trim()) {
      throw new BadRequestException({
        code: 'reset_confirmation_required',
        message: 'Control-state reset requires confirm=true and a reason.',
      });
    }
    const existingLock = await this.locks.read(this.locks.controlTestKey(projectId));
    if (existingLock) {
      const expiresAt = Date.parse(existingLock.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
        throw new ConflictException({
          code: 'control_test_active',
          message: 'Control-test state is active; wait for it to finish before resetting control state.',
        });
      }
      await this.locks.release(existingLock).catch(() => false);
    }
    const resetLock = await this.locks.acquire(this.locks.controlTestKey(projectId), `control-reset:${process.pid}`, 30_000);
    if (!resetLock) {
      throw new ConflictException({
        code: 'control_test_active',
        message: 'Control-test state is active; wait for it to finish before resetting control state.',
      });
    }
    const priorSmokeMetadata = {
      smokeRestoreFailed: detail.project.metadata?.smokeRestoreFailed || null,
      smokeRestoreLastError: detail.project.metadata?.smokeRestoreLastError || null,
      smokeRestoreAttemptCount: detail.project.metadata?.smokeRestoreAttemptCount || null,
      smokeRestoreSnapshotCapturedAt: detail.project.metadata?.smokeRestoreSnapshotCapturedAt || null,
    };
    try {
      await this.saveControlState(manifest.appId, {
        currentRoute: manifest.routes[0]?.id || null,
        health: 'healthy',
        lastCommand: null,
        records: [],
        toolHistory: [],
        resetAt: new Date().toISOString(),
        resetReason: payload.reason,
      });
      await this.redis.delete(this.appEventsKey(manifest.appId));
      await this.storeArtifact(projectId, null, 'activity', 'activity', 'Control state reset audit', {
        id: `control-reset-${randomUUID()}`,
        appId: manifest.appId,
        resetAt: new Date().toISOString(),
        reason: payload.reason,
        confirmedBy: 'local-owner',
        priorSmokeMetadata,
      });
      await this.patchProjectMetadata(detail.project, {
        smokeRestoreFailed: false,
        smokeRestorePending: false,
        smokeRestoreAttemptCount: 0,
        smokeRestoreMaxAttempts: this.appBuilderConfig.values.smokeRestoreMaxAttempts,
        smokeRestoreLastError: null,
        smokeRestoreResetAt: new Date().toISOString(),
      });
      await this.recordActivity(projectId, {
        kind: 'system',
        status: 'warning',
        title: 'Control state reset',
        summary: 'Pre-smoke restore failed repeatedly, so RawClaw reset control state to a default empty state.',
        metadata: { appId: manifest.appId, reason: payload.reason },
      });
      return this.getProjectDetail(projectId);
    } finally {
      await this.locks.release(resetLock).catch(() => false);
    }
  }

  async handleSmokeRestorePending(projectId: string, source = 'janitor'): Promise<void> {
    const detail = await this.getProjectDetail(projectId).catch(() => null);
    if (!detail?.project.metadata?.smokeRestorePending) return;
    const attemptCount = Number(detail.project.metadata.smokeRestoreAttemptCount || 0) + 1;
    const maxAttempts = Number(detail.project.metadata.smokeRestoreMaxAttempts || this.appBuilderConfig.values.smokeRestoreMaxAttempts);
    const failed = attemptCount >= maxAttempts;
    await this.patchProjectMetadata(detail.project, {
      smokeRestoreAttemptCount: attemptCount,
      smokeRestoreMaxAttempts: maxAttempts,
      smokeRestoreLastError: 'Smoke restore could not be completed by the janitor.',
      smokeRestoreLastAttemptAt: new Date().toISOString(),
      smokeRestorePending: !failed,
      smokeRestoreFailed: failed,
    });
    if (failed) {
      await this.recordActivity(projectId, {
        kind: 'system',
        status: 'warning',
        title: 'Smoke restore failed',
        summary: `Control state restore failed after ${attemptCount} ${attemptCount === 1 ? 'attempt' : 'attempts'}. Preview and control commands remain blocked until recovery.`,
        metadata: { source, attemptCount, maxAttempts },
      }).catch(() => undefined);
    }
  }

  private phaseStatus(phase: AppBuilderPhase): AppBuilderProjectStatus {
    switch (phase) {
      case 'plan':
        return 'planned';
      case 'generate':
        return 'generating';
      case 'integrate':
        return 'integrating';
      case 'validate':
        return 'validating';
      case 'deploy':
        return 'deploying';
      case 'register':
        return 'registration_pending';
      case 'import':
        return 'importing';
      case 'adapter-generate':
        return 'adapter_generating';
      default:
        return 'queued';
    }
  }

  private completedProjectStatus(phase: AppBuilderPhase, ok: boolean): AppBuilderProjectStatus {
    if (!ok) {
      return 'failed_fixable';
    }
    switch (phase) {
      case 'plan':
        return 'approval_required';
      case 'generate':
        return 'approval_required';
      case 'integrate':
        return 'approval_required';
      case 'validate':
        return 'approval_required';
      case 'deploy':
        return 'approval_required';
      case 'register':
        return 'approval_required';
      case 'import':
        return 'adapter_generating';
      case 'adapter-generate':
        return 'approval_required';
      case 'control-test':
        return 'registered';
      case 'rollback':
        return 'deployed';
      default:
        return 'planned';
    }
  }

  private async builderCapacity(phase: AppBuilderPhase): Promise<{
    canStart: boolean;
    aiJobsAvailable: boolean;
    validationJobsAvailable: boolean;
    previewSlotsAvailable: boolean;
    queueDepth: number;
    activeAiJobs: number;
    activeValidationJobs: number;
  }> {
    const activeStatuses: AppBuilderRunStatus[] = ['queued', 'generating', 'integrating', 'validating', 'deploying', 'registration_pending'];
    const runs = await this.prisma.appBuilderRun.findMany({
      where: { status: { in: activeStatuses } },
      select: { phase: true, status: true },
      take: 500,
    });
    const queueDepth = runs.filter((run) => run.status === 'queued').length;
    const activeAiJobs = runs.filter((run) => ['plan', 'generate', 'integrate', 'adapter-generate'].includes(run.phase)).length;
    const activeValidationJobs = runs.filter((run) => ['validate', 'control-test'].includes(run.phase)).length;
    const aiJobsAvailable = activeAiJobs < this.appBuilderConfig.values.aiJobLimit;
    const validationJobsAvailable = activeValidationJobs < this.appBuilderConfig.values.validationJobLimit;
    const previewSlotsAvailable = true;
    const needsValidationCapacity = phase === 'validate' || phase === 'control-test';
    const canStart = needsValidationCapacity ? validationJobsAvailable : aiJobsAvailable;
    return {
      canStart,
      aiJobsAvailable,
      validationJobsAvailable,
      previewSlotsAvailable,
      queueDepth,
      activeAiJobs,
      activeValidationJobs,
    };
  }

  async listRuns(projectId?: string): Promise<AppBuilderRun[]> {
    const records = await this.prisma.appBuilderRun.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
    return records.map((record) => this.toRun(record));
  }

  async getRun(id: string): Promise<AppBuilderRun> {
    const record = await this.prisma.appBuilderRun.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException(`App Builder run ${id} not found.`);
    }
    return this.toRun(record);
  }

  async queueProjectPhase(projectId: string, phase: AppBuilderPhase, requestPayload?: Record<string, unknown> | null): Promise<AppBuilderRun> {
    const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!projectRecord) {
      throw new NotFoundException(`App Builder project ${projectId} not found.`);
    }
    const project = this.toProject(projectRecord);
    const pendingStage = this.pendingApprovalStage(project);
    if (pendingStage && !this.phaseAllowedDuringPendingApproval(phase, pendingStage)) {
      throw new Error(`${pendingStage} approval is still pending. Approve or revise that stage before queuing ${phase}.`);
    }
    if (this.isBuildPhase(phase)) {
      const brief = await this.getBriefDraft({ projectId });
      const buildGateIssue = this.planApprovalIssue(project, brief.prompt || project.description);
      if (buildGateIssue) {
        throw new Error(buildGateIssue);
      }
    }
    if (phase === 'plan') {
      const brief = await this.getBriefDraft({ projectId });
      const managedPath = await this.ensureProjectRoot(project);
      const taskList = (await this.latestArtifact<AppBuilderTaskList>(project.id, 'task_list')) || this.initialTaskList(project);
      const memorySnapshot = await this.buildProjectMemorySnapshot(project);
      await this.writeProjectDocs(project, brief, taskList, null, null, memorySnapshot);
      await this.recordActivity(projectId, {
        phase,
        lane: 'plan',
        kind: 'docs',
        status: 'working',
        title: 'Planner docs scaffolded',
        summary: `Prepared ${path.join(managedPath, 'docs')} so the planner can write the project bible before generation starts.`,
      });
    }
    const backgroundable = requestPayload?.backgroundable !== false;
    const capacity = await this.builderCapacity(phase);
    if (capacity.queueDepth >= this.appBuilderConfig.values.maxQueuedJobs) {
      throw new BadRequestException({
        code: 'workspace_busy',
        message: 'The App Builder queue is full. Try again shortly.',
        retryAfterMs: this.appBuilderConfig.values.foregroundStartWindowMs,
        capacity,
      });
    }
    if (!backgroundable && !capacity.canStart) {
      throw new ServiceUnavailableException({
        code: 'capacity_delayed',
        message: `The ${phase} phase could not start inside the foreground start window.`,
        retryAfterMs: this.appBuilderConfig.values.foregroundStartWindowMs,
        canRetry: true,
        capacity,
      });
    }
    const title = `${project.name}: ${phase}`;
    const gatewayRun = await this.gatewayControlPlane.createRun({
      kind: 'app_builder',
      status: 'queued',
      executionMode: 'queued',
      sessionId: null,
      bindingId: null,
      agentId: 'app-builder',
      queueType: 'builder',
      summary: `Queued App Builder ${phase} run for ${project.name}`,
      queueMetadata: {
        executionMode: 'queued',
        queuedRoles: ['generic'],
        workerAssignments: [],
        queueFallbackUsed: false,
      },
      metadata: {
        projectId,
        phase,
        backgroundable,
        capacity,
      },
    });
    const runRecord = await this.prisma.appBuilderRun.create({
      data: {
        projectId,
        phase,
        status: 'queued',
        title,
        gatewayRunId: gatewayRun.id,
      },
    });
    const job = await this.gatewayControlPlane.enqueueBuilderJob({
      runId: runRecord.id,
      projectId,
      phase,
      requestPayload: requestPayload || null,
      gatewayRunId: gatewayRun.id,
    });
    await this.prisma.appBuilderRun.update({
      where: { id: runRecord.id },
      data: {
        queueJobId: job.id,
      },
    });
    await this.workflowState.queuePhase(projectId, runRecord.id, phase, {
      metadata: {
        generationMode: project.sourceType === 'imported' ? 'adapter' : 'template',
        backgroundable,
        capacityState: {
          aiJobsAvailable: capacity.aiJobsAvailable,
          validationJobsAvailable: capacity.validationJobsAvailable,
          previewSlotsAvailable: capacity.previewSlotsAvailable,
          queueDepth: capacity.queueDepth,
        },
      },
    });
    await this.gatewayControlPlane.updateRun(gatewayRun.id, {
      queueType: 'builder',
      jobId: job.id,
      summary: `Queued App Builder ${phase} run for ${project.name}`,
      metadata: {
        projectId,
        phase,
        title,
      },
    });
    await this.recordActivity(projectId, {
      runId: runRecord.id,
      phase,
      lane: phase === 'plan' ? 'plan' : phase === 'generate' || phase === 'integrate' ? 'build' : null,
      kind: phase === 'plan' ? 'planner' : phase === 'validate' ? 'validator' : phase === 'deploy' ? 'deploy' : phase === 'register' ? 'register' : 'system',
      status: 'working',
      title: `${phase} queued`,
      summary: `RawClaw queued ${phase} for ${project.name}. Activity, docs, and logs will update as the worker progresses.`,
    });
    return this.getRun(runRecord.id);
  }

  async markQueuedRunStarted(jobId: string, workerId: string): Promise<void> {
    const job = await this.gatewayControlPlane.getBuilderJob(jobId);
    if (!job) {
      throw new NotFoundException(`Builder job ${jobId} not found.`);
    }
    await this.gatewayControlPlane.markBuilderJobStarted(jobId, workerId);
    await this.workflowState.beginPhase(job.projectId, job.runId, job.phase, {
      metadata: {
        workerId,
      },
    });
    await this.recordActivity(job.projectId, {
      runId: job.runId,
      phase: job.phase,
      lane: job.phase === 'plan' ? 'plan' : job.phase === 'generate' || job.phase === 'integrate' ? 'build' : null,
      kind: job.phase === 'plan' ? 'planner' : job.phase === 'validate' ? 'validator' : job.phase === 'deploy' ? 'deploy' : job.phase === 'register' ? 'register' : 'system',
      status: 'working',
      title: `${job.phase} started`,
      summary: `Worker ${workerId} started ${job.phase}.`,
    });
    if (workerId !== 'app-builder-inline') {
      await this.appendProjectConversationUpdate(
        job.projectId,
        `Started ${job.phase} for this project. I'll keep posting progress and the final walkthrough here while the workspace updates live on the right.`,
        `${job.phase} started`,
        'default',
      );
    }
  }

  async markQueuedRunHeartbeat(jobId: string, workerId: string): Promise<void> {
    await this.gatewayControlPlane.markBuilderJobHeartbeat(jobId, workerId);
  }

  async completeQueuedRun(input: { jobId: string; workerId: string; summary: string; output?: Record<string, unknown> | null }): Promise<void> {
    const job = await this.gatewayControlPlane.getBuilderJob(input.jobId);
    if (!job) {
      throw new NotFoundException(`Builder job ${input.jobId} not found.`);
    }
    try {
      await this.workflowState.completePhase(job.projectId, job.runId, job.phase, {
        metadata: {
          phaseSummary: input.summary,
          outputKeys: input.output ? Object.keys(input.output) : [],
        },
      });
      await this.prisma.appBuilderRun.update({
        where: { id: job.runId },
        data: {
          workerId: input.workerId,
          summary: input.summary,
          outputJson: JSON.stringify(input.output || null),
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.workflowState.markCompletionStale(job.projectId, job.runId, job.phase, reason, input.output || null);
      await this.markRunStagingSupersededStale(job.projectId, job.runId, reason);
      await this.gatewayControlPlane.markBuilderJobCompleted(input.jobId, input.workerId, 'Run result ignored because project inputs changed.', input.output || null);
      await this.recordActivity(job.projectId, {
        runId: job.runId,
        phase: job.phase,
        lane: job.phase === 'plan' ? 'plan' : job.phase === 'generate' || job.phase === 'integrate' ? 'build' : null,
        kind: 'system',
        status: 'warning',
        title: 'Run result ignored',
        summary: 'Run result ignored because project inputs changed.',
        metadata: { reason },
      });
      return;
    }
    if (job.phase === 'validate' && input.output && typeof input.output === 'object') {
      const validation = input.output as unknown as AppBuilderValidationResult;
      if (validation.ok && validation.status !== 'stale' && validation.status !== 'superseded') {
        await this.workflowState.promoteValidation(job.projectId, validation);
      }
    }
    await this.gatewayControlPlane.markBuilderJobCompleted(input.jobId, input.workerId, input.summary, input.output || null);
    const run = await this.prisma.appBuilderRun.findUnique({ where: { id: job.runId } });
    if (run?.gatewayRunId) {
      const guardianOutcome: GatewayGuardianOutcome = {
        status: 'approved',
        reviewer: 'app-builder',
        reason: input.summary,
        updatedAt: new Date().toISOString(),
      };
      await this.gatewayControlPlane.updateRun(run.gatewayRunId, {
        status: 'completed',
        workerId: input.workerId,
        summary: input.summary,
        guardianOutcome,
        terminalOutcome: {
          status: 'completed',
          summary: input.summary,
          completedAt: new Date().toISOString(),
        },
        finishedAt: new Date().toISOString(),
      });
    }
    await this.recordActivity(job.projectId, {
      runId: job.runId,
      phase: job.phase,
      lane: job.phase === 'plan' ? 'plan' : job.phase === 'generate' || job.phase === 'integrate' ? 'build' : null,
      kind: job.phase === 'plan' ? 'planner' : job.phase === 'validate' ? 'validator' : job.phase === 'deploy' ? 'deploy' : job.phase === 'register' ? 'register' : 'system',
      status: 'success',
      title: `${job.phase} completed`,
      summary: input.summary,
      metadata: input.output || null,
    });
    if (input.workerId !== 'app-builder-inline') {
      await this.appendProjectConversationUpdate(
        job.projectId,
        await this.buildPhaseWalkthroughMessage(
          job.projectId,
          job.phase,
          input.summary,
          typeof job.requestPayload?.prompt === 'string' ? String(job.requestPayload.prompt) : null,
          input.output || null,
        ),
        `${job.phase} completed`,
        'success',
      );
    }
  }

  async failQueuedRun(input: { jobId: string; workerId: string; error: string; output?: Record<string, unknown> | null }): Promise<void> {
    const job = await this.gatewayControlPlane.getBuilderJob(input.jobId);
    if (!job) {
      throw new NotFoundException(`Builder job ${input.jobId} not found.`);
    }
    await this.workflowState.failPhase(job.projectId, job.runId, job.phase, input.error, input.output || null);
    await this.prisma.appBuilderRun.update({
      where: { id: job.runId },
      data: {
        workerId: input.workerId,
      },
    });
    await this.gatewayControlPlane.markBuilderJobFailed(input.jobId, input.workerId, input.error, input.output || null);
    const run = await this.prisma.appBuilderRun.findUnique({ where: { id: job.runId } });
    if (run?.gatewayRunId) {
      await this.gatewayControlPlane.updateRun(run.gatewayRunId, {
        status: 'failed',
        workerId: input.workerId,
        error: input.error,
        terminalOutcome: {
          status: 'failed',
          error: input.error,
          completedAt: new Date().toISOString(),
        },
        finishedAt: new Date().toISOString(),
      });
    }
    await this.recordActivity(job.projectId, {
      runId: job.runId,
      phase: job.phase,
      lane: job.phase === 'plan' ? 'plan' : job.phase === 'generate' || job.phase === 'integrate' ? 'build' : null,
      kind: job.phase === 'plan' ? 'planner' : job.phase === 'validate' ? 'validator' : job.phase === 'deploy' ? 'deploy' : job.phase === 'register' ? 'register' : 'system',
      status: 'error',
      title: `${job.phase} failed`,
      summary: input.error,
      metadata: input.output || null,
    });
    if (input.workerId !== 'app-builder-inline') {
      await this.appendProjectConversationUpdate(
        job.projectId,
        [
          typeof job.requestPayload?.prompt === 'string' ? `Asked: ${String(job.requestPayload.prompt)}` : null,
          `${job.phase} failed for this project.`,
          input.error,
          'Check Activity, Logs, Files, Docs, and Terminal for the latest state, then retry or revise the task.',
        ].filter(Boolean).join('\n'),
        `${job.phase} failed`,
        'warning',
      );
    }
  }

  private async writeFile(targetPath: string, contents: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, contents, 'utf-8');
  }

  private reactPackageJson(project: AppBuilderProject): string {
    return JSON.stringify(
      {
        name: project.slug,
        private: true,
        version: '0.1.0',
        scripts: {
          dev: 'vite',
          build: 'vite build',
        },
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        devDependencies: {
          vite: '^5.0.0',
          typescript: '^5.9.3',
        },
      },
      null,
      2,
    );
  }

  private renderAppSource(project: AppBuilderProject, template: AppBuilderTemplate, manifest: RawClawAppManifest): string {
    const capabilities = manifest.capabilities.map((capability) => capability.command).join(', ');
    return `import React from 'react';

export default function App() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', display: 'grid', gap: '1rem' }}>
      <h1>${project.name}</h1>
      <p>${project.description || template.description}</p>
      <section>
        <h2>RawClaw Control Ready</h2>
        <p>Control mode: ${project.controlMode}</p>
        <p>Capabilities: ${capabilities}</p>
      </section>
    </main>
  );
}
`;
  }

  private renderMainSource(): string {
    return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;
  }

  private renderRawClawSdkSource(manifest: RawClawAppManifest): string {
    return `export const rawClawManifest = ${JSON.stringify(manifest, null, 2)} as const;

export async function sendRawClawCommand(command, payload) {
  const response = await fetch(rawClawManifest.controlEndpoints.commands, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      appId: rawClawManifest.appId,
      command,
      payload,
    }),
  });
  return response.json();
}
`;
  }

  private renderReadme(project: AppBuilderProject, template: AppBuilderTemplate): string {
    return `# ${project.name}

Generated by RawClaw App Builder using the ${template.name} template.

## What this project includes

- RawClaw app manifest
- SDK hook scaffold
- Managed local project structure
- Local deployment/export compatibility

## Control mode

\`${project.controlMode}\`
`;
  }

  private renderAdapterJson(project: AppBuilderProject, manifest: RawClawAppManifest): string {
    return JSON.stringify(
      {
        projectId: project.id,
        sourcePath: project.sourcePath,
        manifestPath: 'rawclaw.app.manifest.json',
        controlMode: project.controlMode,
        bridge: 'mcp_plugin',
        commands: manifest.capabilities.map((capability) => capability.command),
      },
      null,
      2,
    );
  }

  private renderMcpPluginJson(project: AppBuilderProject): string {
    return JSON.stringify(
      {
        name: `${project.slug}-bridge`,
        version: '0.1.0',
        description: `Generated adapter bridge for ${project.name}`,
      },
      null,
      2,
    );
  }

  private async generateManagedProject(project: AppBuilderProject, manifest: RawClawAppManifest): Promise<Record<string, unknown>> {
    const template = this.templateFor(project);
    const managedPath = await this.ensureProjectRoot(project);
    const files: Record<string, string> = {
      'README.md': this.renderReadme(project, template),
      'rawclaw.app.manifest.json': JSON.stringify(manifest, null, 2),
    };

    if (project.sourceType === 'imported') {
      const coverage = await this.evaluateRuntimeCoverage(project, manifest);
      files['adapter/rawclaw-adapter.json'] = this.renderAdapterJson(project, manifest);
      files['adapter/mcp-plugin.json'] = this.renderMcpPluginJson(project);
      files['adapter/handler-coverage.json'] = JSON.stringify(coverage, null, 2);
      files['adapter/bridge-config.json'] = JSON.stringify({
        sourcePath: project.sourcePath || null,
        mode: 'bridge_only',
        allowedCapabilities: ['adapter.status', 'adapter.open', 'adapter.forward', 'adapter.health'],
        generatedAt: new Date().toISOString(),
      }, null, 2);
    } else {
      files['package.json'] = this.reactPackageJson(project);
      files['src/main.tsx'] = this.renderMainSource();
      files['src/App.tsx'] = this.renderAppSource(project, template, manifest);
      files['src/rawclaw-sdk.ts'] = this.renderRawClawSdkSource(manifest);
      files['index.html'] = '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
    }

    const stagingId = `staging-${randomUUID()}`;
    const securityScan = this.contentSecurity.scan(
      Object.entries(files).map(([filePath, content]) => ({ path: filePath, content })),
      stagingId,
    );
    await this.storeArtifact(project.id, null, 'security_scan', 'validation', 'Generated content security scan', securityScan);
    if (securityScan.status === 'blocked') {
      throw new Error(`Generated content was blocked by security scan: ${securityScan.findings.filter((finding) => finding.status === 'blocked').map((finding) => finding.summary).join(' ')}`);
    }
    const staged = await this.createStagedGeneration({
      project,
      runId: null,
      managedPath,
      files,
      generationMode: this.generationModeFor(project),
      securityStatus: securityScan.status,
      stagingId,
    });
    return {
      managedPath,
      stagingId: staged.stagedGeneration.id,
      baseSnapshotId: staged.baseSnapshot.id,
      diffSummary: staged.diff.summary,
      files: Object.keys(files),
      securityScanStatus: securityScan.status,
    };
  }

  private async copyDirectory(source: string, destination: string): Promise<void> {
    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true });
  }

  private async deployManagedProject(project: AppBuilderProject): Promise<Record<string, unknown>> {
    if (!project.managedPath || !existsSync(project.managedPath)) {
      throw new Error('Managed project has not been generated yet.');
    }
    const distPath = path.join(project.managedPath, 'dist');
    if (!existsSync(distPath)) {
      throw new Error('Build output does not exist yet. Run validation successfully before deployment.');
    }
    const previousPid = typeof project.metadata?.previewProcessId === 'string' ? String(project.metadata.previewProcessId) : null;
    const preview = await this.deploymentManager.startPreview(project.name, distPath, previousPid);
    await this.prisma.appBuilderProject.update({
      where: { id: project.id },
      data: {
        deployPath: distPath,
        metadataJson: JSON.stringify({
          ...(project.metadata || {}),
          previewUrl: preview.url,
          previewPort: preview.port,
          previewProcessId: preview.processId,
          previewProcessRunId: preview.processRunId,
          previewStartedAt: preview.startedAt,
        }),
      },
    });
    await this.storeArtifact(project.id, null, 'preview_session', 'preview', 'Managed local preview session', preview);
    await this.recordActivity(project.id, {
      phase: 'deploy',
      kind: 'preview',
      status: 'success',
      title: 'Managed preview started',
      summary: `Preview is available at ${preview.url}.`,
      metadata: {
        url: preview.url,
        port: preview.port,
      },
    });
    return {
      deployPath: distPath,
      preview,
    };
  }

  private async exportManagedProject(project: AppBuilderProject): Promise<Record<string, unknown>> {
    if (!project.managedPath || !existsSync(project.managedPath)) {
      throw new Error('Managed project has not been generated yet.');
    }
    const exportPath = path.join(this.exportsRoot(), `${project.slug}-${Date.now()}`);
    await this.copyDirectory(project.managedPath, exportPath);
    await this.prisma.appBuilderProject.update({
      where: { id: project.id },
      data: {
        exportPath,
      },
    });
    return { exportPath };
  }

  async listRegistryRecords(): Promise<AppRegistryRecord[]> {
    const records = await this.prisma.appRegistryRecord.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
    return records.map((record) => this.toRegistryRecord(record));
  }

  async getMetricsText(): Promise<string> {
    const [runs, projects, artifacts, degradedProjects] = await Promise.all([
      this.prisma.appBuilderRun.groupBy({ by: ['phase', 'status'], _count: { _all: true } }),
      this.prisma.appBuilderProject.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.$queryRawUnsafe<Array<{ kind: string; count: bigint | number }>>(
        `SELECT kind, COUNT(*) as count FROM app_builder_artifacts GROUP BY kind`,
      ).catch(() => []),
      this.prisma.appBuilderProject.findMany({ select: { metadataJson: true }, take: 1000 }).catch(() => []),
    ]);
    const suggestionVectorClearFailed = degradedProjects.filter((project) =>
      Boolean(this.parseJson<Record<string, unknown>>(project.metadataJson, {}).suggestionVectorClearFailed),
    ).length;
    const smokeRestoreFailed = degradedProjects.filter((project) =>
      Boolean(this.parseJson<Record<string, unknown>>(project.metadataJson, {}).smokeRestoreFailed),
    ).length;
    const lines = [
      '# HELP rawclaw_app_builder_runs_total App Builder runs by phase and status.',
      '# TYPE rawclaw_app_builder_runs_total counter',
      ...runs.map((run) => `rawclaw_app_builder_runs_total{phase="${this.metricLabel(run.phase)}",status="${this.metricLabel(run.status)}"} ${run._count._all}`),
      '# HELP rawclaw_app_builder_projects App Builder projects by status.',
      '# TYPE rawclaw_app_builder_projects gauge',
      ...projects.map((project) => `rawclaw_app_builder_projects{status="${this.metricLabel(project.status)}"} ${project._count._all}`),
      '# HELP rawclaw_app_builder_artifacts_total App Builder artifacts by kind.',
      '# TYPE rawclaw_app_builder_artifacts_total counter',
      ...artifacts.map((artifact) => `rawclaw_app_builder_artifacts_total{kind="${this.metricLabel(artifact.kind)}"} ${Number(artifact.count)}`),
      '# HELP app_builder_suggestion_vector_clear_failed Projects with failed suggestion vector cleanup.',
      '# TYPE app_builder_suggestion_vector_clear_failed gauge',
      `app_builder_suggestion_vector_clear_failed ${suggestionVectorClearFailed}`,
      '# HELP app_builder_smoke_restore_failed Projects with failed smoke restore.',
      '# TYPE app_builder_smoke_restore_failed gauge',
      `app_builder_smoke_restore_failed ${smokeRestoreFailed}`,
    ];
    return `${lines.join('\n')}\n`;
  }

  async getProjectHealth(projectId: string): Promise<Record<string, unknown>> {
    const detail = await this.getProjectDetail(projectId);
    const staged = detail.artifacts.filter((artifact) => artifact.kind === 'staged_generation').map((artifact) => artifact.payload as Record<string, unknown>);
    const degradedReasons = [
      ...(detail.project.metadata?.suggestionVectorClearFailed ? ['suggestion_vector_clear_failed'] : []),
      ...(detail.project.metadata?.smokeRestoreFailed ? ['smoke_restore_failed'] : []),
      ...(detail.project.metadata?.lastIndexError ? ['indexing_failed'] : []),
    ];
    return {
      projectId,
      status: detail.project.status,
      workflowState: detail.workflowState,
      degraded: degradedReasons.length > 0,
      degradedReasons,
      suggestionVectorClearFailed: Boolean(detail.project.metadata?.suggestionVectorClearFailed),
      suggestionVectorClear: detail.project.metadata?.suggestionVectorClearFailed || detail.project.metadata?.suggestionVectorClearPending ? {
        status: detail.project.metadata?.suggestionVectorClearFailed ? 'failed' : 'pending',
        collection: this.appBuilderSuggestionCollection(projectId),
        lastError: detail.project.metadata?.suggestionVectorClearLastError || null,
        attemptCount: detail.project.metadata?.suggestionVectorClearAttemptCount || 0,
        recommendedAction: detail.project.metadata?.suggestionVectorClearFailed
          ? 'Check Chroma/Memory connectivity or collection health, then retry suggestion vector cleanup from the operator UI.'
          : 'Waiting for janitor retry.',
      } : null,
      smokeRestoreFailed: Boolean(detail.project.metadata?.smokeRestoreFailed),
      latestValidation: detail.latestValidation ? {
        ok: detail.latestValidation.ok,
        status: detail.latestValidation.status || null,
        snapshotId: detail.latestValidation.snapshotId || null,
      } : null,
      openStagedGenerations: staged.filter((entry) => ['open', 'partially_applied', 'conflict'].includes(String(entry.status))).length,
      nextAllowedActions: detail.nextAllowedActions,
      indexFreshness: detail.indexFreshness,
      isIndexStale: detail.isIndexStale,
    };
  }

  async getRegistryRecord(id: string): Promise<AppRegistryRecord> {
    const record = await this.prisma.appRegistryRecord.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Registry record ${id} not found.`);
    }
    return this.toRegistryRecord(record);
  }

  private async initializeAppState(appId: string, manifest: RawClawAppManifest): Promise<void> {
    const domain = typeof manifest.metadata?.domain === 'string' ? String(manifest.metadata.domain) : null;
    await this.redis.setJson(this.appStateKey(appId), {
      currentRoute: manifest.routes[0]?.id || null,
      health: 'healthy',
      lastCommand: null,
      records: [],
      toolHistory: [],
      expression: domain === 'calculator' ? '' : undefined,
      result: domain === 'calculator' ? '0' : undefined,
      history: domain === 'calculator' ? [] : undefined,
    });
    await this.publishAppEvent(appId, createAppEvent({
      id: randomUUID(),
      appId,
      type: 'app.ready',
      summary: `${manifest.name} is registered and ready for RawClaw control.`,
      payload: {
        routeCount: manifest.routes.length,
        capabilityCount: manifest.capabilities.length,
      },
    }));
  }

  private async publishAppEvent(appId: string, event: RawClawAppEvent): Promise<void> {
    await this.redis.pushJsonList(this.appEventsKey(appId), event, 120);
    await this.redis.publish(this.appEventChannel(appId), event);
  }

  async listAppEvents(appId: string, limit = 50): Promise<RawClawAppEvent[]> {
    return this.redis.getJsonList<RawClawAppEvent>(this.appEventsKey(appId), 0, Math.max(1, Math.min(limit, 100)) - 1);
  }

  async subscribeToAppEvents(appId: string, onEvent: (event: RawClawAppEvent) => void | Promise<void>): Promise<() => Promise<void>> {
    return this.redis.subscribe(this.appEventChannel(appId), async (payload) => {
      const event = JSON.parse(payload) as RawClawAppEvent;
      await onEvent(event);
    });
  }

  private async captureControlSnapshot(appId: string): Promise<{ state: Record<string, unknown>; events: RawClawAppEvent[] }> {
    return {
      state: await this.controlState(appId),
      events: await this.listAppEvents(appId, 120),
    };
  }

  private async restoreControlSnapshot(appId: string, snapshot: { state: Record<string, unknown>; events: RawClawAppEvent[] }): Promise<void> {
    await this.saveControlState(appId, snapshot.state);
    await this.redis.delete(this.appEventsKey(appId));
    for (const event of snapshot.events.slice().reverse()) {
      await this.redis.pushJsonList(this.appEventsKey(appId), event, 120);
    }
  }

  private isControlResponseShape(value: unknown): value is RawClawControlResponse {
    const response = value as RawClawControlResponse | null;
    return Boolean(
      response
      && typeof response.id === 'string'
      && typeof response.appId === 'string'
      && typeof response.commandId === 'string'
      && typeof response.ok === 'boolean'
      && ['accepted', 'completed', 'rejected', 'failed'].includes(String(response.status))
      && typeof response.summary === 'string'
      && typeof response.respondedAt === 'string',
    );
  }

  private smokeFailureClass(error: unknown, invokedHandler: boolean): 'infrastructure_failed' | 'capability_failed' {
    const message = error instanceof Error ? error.message : String(error);
    if (!invokedHandler || /redis|control-store|timeout|unavailable|ECONN|connection|not ready/i.test(message)) {
      return 'infrastructure_failed';
    }
    return 'capability_failed';
  }

  private async runRegistrationSmokeSuite(project: AppBuilderProject, manifest: RawClawAppManifest, trigger: 'register' | 'retry_register'): Promise<any> {
    const appId = manifest.appId;
    const suiteSnapshot = await this.captureControlSnapshot(appId);
    const capturedAt = new Date().toISOString();
    await this.patchProjectMetadata(project, {
      smokeRestoreSnapshotState: suiteSnapshot.state,
      smokeRestoreSnapshotEvents: suiteSnapshot.events,
      smokeRestoreSnapshotCapturedAt: capturedAt,
      smokeRestoreMaxAttempts: this.appBuilderConfig.values.smokeRestoreMaxAttempts,
      smokeRestorePending: false,
      smokeRestoreFailed: false,
      registrationInfraFailure: null,
      registrationCapabilityFailure: null,
    });

    const results: any[] = [];
    const blockingReasons: string[] = [];
    let suiteFailureClass: 'infrastructure_failed' | 'capability_failed' | null = null;
    try {
      for (const capability of manifest.capabilities) {
        const before = await this.captureControlSnapshot(appId);
        const destructive = this.classifyDestructiveCapability(capability).destructive;
        const smokePayload = {
          __rawclawSmokeTest: true,
          dryRun: destructive,
          capabilityId: capability.id,
        };
        let response: RawClawControlResponse | null = null;
        let responseShapeOk = false;
        let dryRunMutationOk = true;
        let smokeStatus: 'passed' | 'failed' = 'passed';
        let smokeFailureClass: 'infrastructure_failed' | 'capability_failed' | null = null;
        const reasons: string[] = [];
        let invokedHandler = false;
        try {
          invokedHandler = true;
          response = await this.executeControlCommand(appId, {
            id: `smoke-${randomUUID()}`,
            appId,
            command: capability.command,
            payload: smokePayload,
            requestedBy: 'app-builder-smoke',
            requestedAt: new Date().toISOString(),
          }, { manifest, projectId: project.id, smoke: true });
          responseShapeOk = this.isControlResponseShape(response);
          if (!responseShapeOk) {
            reasons.push('invalid_control_response_shape');
          }
          if (destructive) {
            const after = await this.captureControlSnapshot(appId);
            dryRunMutationOk = JSON.stringify(before) === JSON.stringify(after);
            if (!dryRunMutationOk) {
              reasons.push('dry_run_mutated_control_state');
            }
            if (responseShapeOk && !['rejected', 'failed'].includes(response.status)) {
              reasons.push('destructive_dry_run_not_rejected');
            }
          } else if (responseShapeOk && !response.ok) {
            reasons.push(response.error || 'smoke_response_not_ok');
          }
          if (reasons.length) {
            smokeStatus = 'failed';
            smokeFailureClass = 'capability_failed';
          }
        } catch (error) {
          smokeStatus = 'failed';
          smokeFailureClass = this.smokeFailureClass(error, invokedHandler);
          reasons.push(error instanceof Error ? error.message : String(error));
        } finally {
          await this.restoreControlSnapshot(appId, before).catch((error) => {
            this.logger.warn(`Smoke state restore failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        if (smokeStatus === 'failed') {
          suiteFailureClass = suiteFailureClass === 'capability_failed' ? suiteFailureClass : smokeFailureClass;
          if (smokeFailureClass === 'capability_failed') suiteFailureClass = 'capability_failed';
          blockingReasons.push(...reasons.map((reason) => `${capability.command}:${reason}`));
        }
        results.push({
          id: capability.id,
          command: capability.command,
          smokeStatus,
          smokeFailureClass,
          smokeResponseShapeOk: responseShapeOk,
          dryRunMutationOk,
          smokePayload,
          response: response ? {
            ok: response.ok,
            status: response.status,
            error: response.error || null,
            summary: response.summary,
          } : null,
          registrationBlockingReasons: reasons,
        });
      }
    } finally {
      await this.restoreControlSnapshot(appId, suiteSnapshot).catch(async (error) => {
        await this.patchProjectMetadata(project, {
          smokeRestorePending: true,
          smokeRestoreLastError: error instanceof Error ? error.message : String(error),
          smokeRestoreAttemptCount: 0,
          smokeRestoreMaxAttempts: this.appBuilderConfig.values.smokeRestoreMaxAttempts,
        }).catch(() => undefined);
      });
    }

    const ok = blockingReasons.length === 0;
    if (ok) {
      await this.patchProjectMetadata(project, {
        registrationInfraFailure: null,
        registrationCapabilityFailure: null,
        lastRegistrationSmokeAt: new Date().toISOString(),
      });
    } else if (suiteFailureClass === 'infrastructure_failed') {
      await this.patchProjectMetadata(project, {
        registrationInfraFailure: {
          trigger,
          failureClass: 'infrastructure_failed',
          reasons: blockingReasons,
          failedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        registrationCapabilityFailure: null,
      });
    } else {
      await this.patchProjectMetadata(project, {
        registrationCapabilityFailure: {
          trigger,
          failureClass: 'capability_failed',
          reasons: blockingReasons,
          failedAt: new Date().toISOString(),
        },
        registrationInfraFailure: null,
      });
    }

    return {
      ok,
      sourceType: project.sourceType,
      generationMode: this.generationModeFor(project),
      trigger,
      smokeStatus: ok ? 'passed' : 'failed',
      smokeFailureClass: suiteFailureClass,
      capabilities: results,
      missingCommands: results.filter((entry) => entry.smokeStatus === 'failed').map((entry) => entry.command),
      registrationBlockingReasons: blockingReasons,
      checkedAt: new Date().toISOString(),
    };
  }

  private async registerProjectApp(project: AppBuilderProject): Promise<Record<string, unknown>> {
    if (!project.approvalGranted) {
      throw new Error('Human approval is required before registration.');
    }
    const manifestRecord = await this.getLatestManifest(project.id);
    if (!manifestRecord) {
      throw new Error('Manifest must exist before registration.');
    }
    const manifest = manifestRecord.manifest;
    const coverage = await this.evaluateRuntimeCoverage(project, manifest);
    await this.storeArtifact(project.id, null, 'runtime_coverage', 'validation', 'Runtime handler coverage', coverage);
    if (!coverage.ok) {
      throw new Error(`Registration blocked by runtime coverage: ${coverage.missingCommands.join(', ')}`);
    }
    await this.initializeAppState(manifest.appId, manifest);
    const smokeCoverage = await this.runRegistrationSmokeSuite(
      project,
      manifest,
      project.metadata?.registrationInfraFailure ? 'retry_register' : 'register',
    );
    await this.storeArtifact(project.id, null, 'runtime_coverage', 'validation', 'Runtime smoke coverage', smokeCoverage);
    if (!smokeCoverage.ok) {
      throw new Error(`Registration blocked by runtime smoke: ${smokeCoverage.registrationBlockingReasons.join(', ')}`);
    }
    const record = await this.prisma.appRegistryRecord.create({
      data: {
        projectId: project.id,
        appId: manifest.appId,
        version: manifest.version,
        sourceType: project.sourceType,
        status: 'registered',
        manifestJson: JSON.stringify(manifest),
        controlEndpoint: manifest.controlEndpoints.commands,
        eventStreamEndpoint: manifest.controlEndpoints.events,
        deploymentLocation: typeof project.metadata?.previewUrl === 'string'
          ? String(project.metadata.previewUrl)
          : project.deployPath || project.managedPath,
        healthStatus: 'healthy',
      },
    });
    await this.gatewayEvents.publish({
      type: 'app_builder.registered',
      summary: `Registered ${project.name} in the RawClaw App Registry`,
      payload: {
        projectId: project.id,
        registryRecordId: record.id,
        appId: manifest.appId,
      },
    });
    await this.recordActivity(project.id, {
      phase: 'register',
      kind: 'register',
      status: 'success',
      title: 'Project registered',
      summary: `${project.name} is now registered in the RawClaw App Registry as ${manifest.appId}.`,
      metadata: {
        appId: manifest.appId,
        registryRecordId: record.id,
      },
    });
    return {
      registryRecordId: record.id,
      appId: manifest.appId,
    };
  }

  private async evaluateRuntimeCoverage(project: AppBuilderProject, manifest: RawClawAppManifest): Promise<{
    ok: boolean;
    sourceType: AppBuilderSourceType;
    generationMode: AppBuilderGenerationMode;
    capabilities: Array<{
      id: string;
      command: string;
      handler: string;
      status: 'covered' | 'missing';
      handlerExists: boolean;
      structuredResponseOk: boolean;
      eventCoverageOk: boolean;
      destructive: boolean;
      destructiveNameMismatch: boolean;
      destructiveNameAllowlisted: boolean;
      destructiveDryRunOk: boolean;
      sideEffectScanOk: boolean;
      sideEffectFindings: string[];
      registrationBlockingReasons: string[];
    }>;
    missingCommands: string[];
    registrationBlockingReasons: string[];
    checkedAt: string;
  }> {
    const domain = typeof manifest.metadata?.domain === 'string' ? String(manifest.metadata.domain) : null;
    const builtIn = new Set([
      'app.status',
      'app.navigate',
      'records.create',
      'tool.run',
      'adapter.forward',
      'adapter.status',
      'adapter.open',
      'adapter.health',
    ]);
    if (domain === 'calculator') {
      for (const command of [
        'calculator.get_state',
        'calculator.get_history',
        'calculator.press_digit',
        'calculator.press_operator',
        'calculator.backspace',
        'calculator.clear',
        'calculator.percent',
        'calculator.evaluate',
      ]) {
        builtIn.add(command);
      }
    }
    const sideEffectFindings = await this.scanRuntimeHandlerSideEffects(project);
    const capabilities = manifest.capabilities.map((capability) => {
      const handlerExists = builtIn.has(capability.command) || project.sourceType === 'generated';
      const handler = builtIn.has(capability.command)
        ? 'built_in'
        : handlerExists
          ? 'generic_structured_state_handler'
          : 'missing';
      const destructive = this.classifyDestructiveCapability(capability);
      const destructiveDryRunOk = !destructive.destructive
        || capability.requiresApproval === true
        || manifest.permissions.approvalRequired === true
        || manifest.controlMode !== 'full_control'
        || capability.command.startsWith('adapter.');
      const sideEffectScanOk = sideEffectFindings.length === 0 || builtIn.has(capability.command);
      const structuredResponseOk = handlerExists;
      const eventCoverageOk = Boolean(manifest.controlEndpoints?.events);
      const registrationBlockingReasons = [
        ...(!handlerExists ? ['handler_missing'] : []),
        ...(!structuredResponseOk ? ['structured_response_missing'] : []),
        ...(!eventCoverageOk ? ['runtime_event_endpoint_missing'] : []),
        ...(!destructiveDryRunOk ? ['destructive_dry_run_missing'] : []),
        ...(!sideEffectScanOk ? sideEffectFindings.map((finding) => `import_side_effect:${finding}`) : []),
      ];
      return {
        id: capability.id,
        command: capability.command,
        handler,
        status: registrationBlockingReasons.length ? 'missing' as const : 'covered' as const,
        handlerExists,
        structuredResponseOk,
        eventCoverageOk,
        destructive: destructive.destructive,
        destructiveNameMismatch: destructive.destructiveNameMismatch,
        destructiveNameAllowlisted: destructive.allowlisted,
        destructiveDryRunOk,
        sideEffectScanOk,
        sideEffectFindings: sideEffectScanOk ? [] : sideEffectFindings,
        registrationBlockingReasons,
      };
    });
    const missingCommands = capabilities
      .filter((capability) => capability.status === 'missing')
      .map((capability) => capability.command);
    const registrationBlockingReasons = capabilities.flatMap((capability) =>
      capability.registrationBlockingReasons.map((reason) => `${capability.command}:${reason}`),
    );
    const coverage = {
      ok: missingCommands.length === 0,
      sourceType: project.sourceType,
      generationMode: this.generationModeFor(project),
      capabilities,
      missingCommands,
      registrationBlockingReasons,
      checkedAt: new Date().toISOString(),
    };
    await this.storeArtifact(project.id, null, 'runtime_handler', 'validation', 'Runtime command handler table', {
      appId: manifest.appId,
      handlers: capabilities,
      generatedAt: coverage.checkedAt,
    });
    return coverage;
  }

  private classifyDestructiveCapability(capability: { command: string; destructive?: boolean | null }): {
    destructive: boolean;
    destructiveNameMismatch: boolean;
    allowlisted: boolean;
  } {
    const command = String(capability.command || '').trim();
    const verbMatch = DESTRUCTIVE_COMMAND_VERBS.test(command.replace(/[._-]+/g, ' '));
    const allowlisted = SAFE_DESTRUCTIVE_NAME_ALLOWLIST.some((entry) => entry.command === command);
    if (capability.destructive === true) {
      return { destructive: true, destructiveNameMismatch: false, allowlisted };
    }
    if (capability.destructive === false && verbMatch) {
      return { destructive: !allowlisted, destructiveNameMismatch: true, allowlisted };
    }
    if (capability.destructive === false) {
      return { destructive: false, destructiveNameMismatch: false, allowlisted };
    }
    return { destructive: verbMatch && !allowlisted, destructiveNameMismatch: false, allowlisted };
  }

  private async scanRuntimeHandlerSideEffects(project: AppBuilderProject): Promise<string[]> {
    if (!project.managedPath) return [];
    const candidates = [
      path.join('src', 'rawclaw-handlers.ts'),
      path.join('src', 'rawclaw-runtime-handlers.ts'),
      path.join('src', 'rawclaw-control.ts'),
    ];
    const findings: string[] = [];
    for (const relPath of candidates) {
      const absolute = this.securePaths.resolveInside(project.managedPath, relPath);
      const content = await fs.readFile(absolute, 'utf8').catch(() => null);
      if (!content) continue;
      findings.push(...this.scanTopLevelSideEffects(content).map((finding) => `${relPath}:${finding}`));
    }
    return findings;
  }

  private scanTopLevelSideEffects(content: string): string[] {
    const findings: string[] = [];
    let depth = 0;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      const topLevel = depth === 0;
      if (topLevel && line) {
        const staticImport = line.match(/^import\s+.*?from\s+['"]([^'"]+)['"]/);
        const requireImport = line.match(/require\(['"]([^'"]+)['"]\)/);
        const importTarget = staticImport?.[1] || requireImport?.[1] || null;
        if (importTarget && FORBIDDEN_HANDLER_IMPORTS.has(importTarget)) {
          findings.push(`line ${index + 1} forbidden import ${importTarget}`);
        }
        if (/\bimport\s*\(/.test(line)) {
          findings.push(`line ${index + 1} top-level dynamic import`);
        }
        if (/\b(setInterval|setTimeout|fetch|WebSocket)\s*\(/.test(line)) {
          findings.push(`line ${index + 1} top-level runtime side effect`);
        }
        if (/\b(exec|spawn|writeFile|appendFile|rm|unlink)\s*\(/.test(line)) {
          findings.push(`line ${index + 1} top-level process or filesystem side effect`);
        }
      }
      if (!topLevel && /\b(fetch|WebSocket)\s*\(|\bnew\s+[A-Za-z0-9_]*(Client|Socket|Connection)\s*\(|\bimport\s*\(\s*['"](http|https|net|tls|fs|child_process|process)['"]\s*\)/.test(line)) {
        const guardContext = lines.slice(Math.max(0, index - 8), index + 1).join('\n');
        if (!/(dryRun|__rawclawSmokeTest|smokeTest|smoke)\b[\s\S]{0,240}\breturn\b|\breturn\b[\s\S]{0,240}(dryRun|__rawclawSmokeTest|smokeTest|smoke)\b/i.test(guardContext)) {
          findings.push(`line ${index + 1} unguarded lazy external initialization`);
        }
      }
      for (const char of rawLine) {
        if (char === '{') depth += 1;
        if (char === '}') depth = Math.max(0, depth - 1);
      }
    }
    return findings;
  }

  private async controlState(appId: string): Promise<Record<string, unknown>> {
    return (await this.redis.getJson<Record<string, unknown>>(this.appStateKey(appId))) || {
      currentRoute: null,
      health: 'healthy',
      lastCommand: null,
      records: [],
      toolHistory: [],
    };
  }

  private async saveControlState(appId: string, state: Record<string, unknown>): Promise<void> {
    await this.redis.setJson(this.appStateKey(appId), state);
  }

  async executeControlCommand(appId: string, command: RawClawControlCommand, options: {
    manifest?: RawClawAppManifest | null;
    projectId?: string | null;
    smoke?: boolean;
  } = {}): Promise<RawClawControlResponse> {
    const registry = options.manifest
      ? null
      : await this.prisma.appRegistryRecord.findFirst({
        where: { appId, status: 'registered' },
        orderBy: { createdAt: 'desc' },
      });
    if (!registry && !options.manifest) {
      return createControlResponse({
        id: randomUUID(),
        appId,
        commandId: command.id,
        ok: false,
        status: 'failed',
        summary: `App ${appId} is not registered.`,
        error: 'app_not_registered',
      });
    }
    const manifest = options.manifest || (registry ? this.parseManifestJson(registry.manifestJson) : null);
    if (!manifest) {
      return createControlResponse({
        id: randomUUID(),
        appId,
        commandId: command.id,
        ok: false,
        status: 'failed',
        summary: `App ${appId} is registered without a valid manifest.`,
        error: 'manifest_invalid',
      });
    }
    const registryProjectId = options.projectId || registry?.projectId || null;
    if (registryProjectId) {
      const projectRecord = await this.prisma.appBuilderProject.findUnique({
        where: { id: registryProjectId },
        select: { metadataJson: true },
      }).catch(() => null);
      const projectMetadata = this.parseJson<Record<string, unknown>>(projectRecord?.metadataJson, {});
      if (projectMetadata.smokeRestoreFailed || projectMetadata.smokeRestorePending) {
        return createControlResponse({
          id: randomUUID(),
          appId,
          commandId: command.id,
          ok: false,
          status: 'failed',
          summary: projectMetadata.smokeRestoreFailed
            ? 'Control commands are unavailable because smoke restore failed.'
            : 'Control commands are temporarily unavailable while smoke restore is pending.',
          error: projectMetadata.smokeRestoreFailed ? 'smoke_restore_failed' : 'smoke_restore_pending',
        });
      }
    }
    const capability = manifest.capabilities.find(
      (entry) => entry.command === command.command || entry.id === command.command,
    );
    if (!capability) {
      const rejected = createControlResponse({
        id: randomUUID(),
        appId,
        commandId: command.id,
        ok: false,
        status: 'rejected',
        summary: `Command ${command.command} is not part of the registered capability contract.`,
        error: 'capability_not_supported',
      });
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'control.rejected',
        summary: rejected.summary,
        payload: {
          command: command.command,
        },
      }));
      return rejected;
    }
    const smokePayload = command.payload || {};
    const isSmoke = options.smoke || smokePayload.__rawclawSmokeTest === true;
    const isDryRun = smokePayload.dryRun === true;

    if (!isSmoke && manifest.controlMode === 'observe_only' && command.command !== 'app.status') {
      const rejected = createControlResponse({
        id: randomUUID(),
        appId,
        commandId: command.id,
        ok: false,
        status: 'rejected',
        summary: `App ${appId} is currently in observe-only mode.`,
        error: 'observe_only_mode',
      });
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'control.rejected',
        summary: rejected.summary,
        payload: {
          command: command.command,
        },
      }));
      return rejected;
    }

    const state = await this.controlState(appId);
    if (state.smokeRestorePending || state.smoke_restore_pending || state.smokeRestoreFailed || state.smoke_restore_failed) {
      return createControlResponse({
        id: randomUUID(),
        appId,
        commandId: command.id,
        ok: false,
        status: 'failed',
        summary: state.smokeRestoreFailed || state.smoke_restore_failed
          ? 'Control commands are unavailable because smoke restore failed.'
          : 'Control commands are temporarily unavailable while smoke restore is pending.',
        error: state.smokeRestoreFailed || state.smoke_restore_failed ? 'smoke_restore_failed' : 'smoke_restore_pending',
      });
    }
    let summary = `Executed ${command.command}`;
    let data: Record<string, unknown> | null = null;
    const domain = typeof manifest.metadata?.domain === 'string' ? String(manifest.metadata.domain) : null;
    const destructive = this.classifyDestructiveCapability(capability).destructive;

    if (isSmoke && isDryRun && destructive) {
      return createControlResponse({
        id: randomUUID(),
        appId,
        commandId: command.id,
        ok: false,
        status: 'rejected',
        summary: `Dry-run smoke rejected destructive command ${command.command} without mutating control state.`,
        error: 'dry_run_requires_approval',
        data: {
          dryRun: true,
          approvalRequired: true,
        },
      });
    }

    if (command.command === 'app.status') {
      data = {
        health: state.health || 'healthy',
        currentRoute: state.currentRoute || manifest.routes[0]?.id || null,
        controlMode: manifest.controlMode,
      };
      summary = `${manifest.name} is healthy and ready.`;
    } else if (domain === 'calculator' && command.command === 'calculator.get_state') {
      data = {
        expression: String(state.expression || ''),
        result: String(state.result || '0'),
      };
      summary = `Returned calculator state for ${manifest.name}.`;
    } else if (domain === 'calculator' && command.command === 'calculator.get_history') {
      data = {
        history: Array.isArray(state.history) ? state.history : [],
      };
      summary = `Returned calculator history for ${manifest.name}.`;
    } else if (domain === 'calculator' && command.command === 'calculator.press_digit') {
      const digit = String(command.payload?.digit || '');
      state.expression = `${String(state.expression || '')}${digit}`;
      data = { expression: state.expression };
      summary = `Pressed digit ${digit}.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'state.updated',
        summary: 'Calculator expression changed.',
        payload: data,
      }));
    } else if (domain === 'calculator' && command.command === 'calculator.press_operator') {
      const operator = String(command.payload?.operator || '');
      state.expression = `${String(state.expression || '')}${operator}`;
      data = { expression: state.expression };
      summary = `Pressed operator ${operator}.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'state.updated',
        summary: 'Calculator expression changed.',
        payload: data,
      }));
    } else if (domain === 'calculator' && command.command === 'calculator.backspace') {
      state.expression = String(state.expression || '').slice(0, -1);
      data = { expression: state.expression };
      summary = `Removed the last calculator character.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'state.updated',
        summary: 'Calculator expression changed.',
        payload: data,
      }));
    } else if (domain === 'calculator' && command.command === 'calculator.clear') {
      state.expression = '';
      state.result = '0';
      data = { expression: '', result: '0' };
      summary = `Cleared calculator state.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'state.updated',
        summary: 'Calculator cleared.',
        payload: data,
      }));
    } else if (domain === 'calculator' && command.command === 'calculator.percent') {
      state.expression = `${String(state.expression || '')}/100`;
      data = { expression: state.expression };
      summary = `Applied percent transformation.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'state.updated',
        summary: 'Calculator expression changed.',
        payload: data,
      }));
    } else if (domain === 'calculator' && command.command === 'calculator.evaluate') {
      const expression = String(state.expression || '');
      try {
        const result = Function(`return (${expression || '0'})`)();
        state.result = Number.isFinite(result) ? String(Number(result.toFixed(12))) : 'Error';
      } catch {
        state.result = 'Error';
      }
      const history = Array.isArray(state.history) ? [...state.history] : [];
      history.unshift({ expression, result: state.result, createdAt: new Date().toISOString() });
      state.history = history.slice(0, 10);
      data = { expression, result: state.result, history: state.history };
      summary = `Calculated the current expression.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'action.completed',
        summary: 'Calculator result calculated.',
        payload: data,
      }));
    } else if (command.command === 'app.navigate') {
      const routeId = String(command.payload?.routeId || manifest.routes[0]?.id || '');
      state.currentRoute = routeId;
      data = { currentRoute: routeId };
      summary = `Navigated ${manifest.name} to ${routeId}.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'route.changed',
        summary,
        payload: data,
      }));
    } else if (command.command === 'records.create') {
      const records = Array.isArray(state.records) ? [...state.records] : [];
      const nextRecord = {
        id: randomUUID(),
        ...(command.payload || {}),
      };
      records.push(nextRecord);
      state.records = records;
      data = { record: nextRecord, total: records.length };
      summary = `Created record ${nextRecord.id}.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'action.completed',
        summary,
        payload: data,
      }));
    } else if (command.command === 'tool.run') {
      const toolHistory = Array.isArray(state.toolHistory) ? [...state.toolHistory] : [];
      const toolRun = {
        id: randomUUID(),
        task: command.payload?.task || 'unspecified',
        finishedAt: new Date().toISOString(),
      };
      toolHistory.push(toolRun);
      state.toolHistory = toolHistory;
      data = { run: toolRun, total: toolHistory.length };
      summary = `Queued AI tool action "${toolRun.task}".`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'action.completed',
        summary,
        payload: data,
      }));
    } else if (command.command === 'adapter.forward') {
      data = {
        forwarded: true,
        targetCommand: command.payload?.command || null,
      };
      summary = `Forwarded adapter bridge command for ${manifest.name}.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'action.completed',
        summary,
        payload: data,
      }));
    } else if (command.command === 'adapter.status' || command.command === 'adapter.health') {
      data = {
        bridge: 'ready',
        sourceType: manifest.sourceType,
        target: manifest.deployment.location || null,
      };
      summary = `Adapter bridge is ready for ${manifest.name}.`;
    } else if (command.command === 'adapter.open') {
      data = {
        opened: true,
        route: command.payload?.routeId || manifest.routes[0]?.id || null,
      };
      summary = `Opened adapter route for ${manifest.name}.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'route.changed',
        summary,
        payload: data,
      }));
    } else {
      const genericHistory = Array.isArray(state.genericCommandHistory) ? [...state.genericCommandHistory] : [];
      const genericEntry = {
        id: randomUUID(),
        command: command.command,
        payload: command.payload || null,
        handledAt: new Date().toISOString(),
      };
      genericHistory.unshift(genericEntry);
      state.genericCommandHistory = genericHistory.slice(0, 20);
      const storedGenericHistory = Array.isArray(state.genericCommandHistory) ? state.genericCommandHistory : [];
      data = {
        command: command.command,
        accepted: true,
        state: {
          lastGenericCommand: genericEntry,
          historyCount: storedGenericHistory.length,
        },
      };
      summary = `Handled ${command.command} through the generated structured state handler.`;
      await this.publishAppEvent(appId, createAppEvent({
        id: randomUUID(),
        appId,
        type: 'action.completed',
        summary,
        payload: data,
      }));
    }

    state.lastCommand = {
      command: command.command,
      requestedAt: command.requestedAt,
    };
    await this.saveControlState(appId, state);
    return createControlResponse({
      id: randomUUID(),
      appId,
      commandId: command.id,
      ok: true,
      status: 'completed',
      summary,
      data,
    });
  }

  async executeQueuedRun(jobId: string, workerId: string): Promise<ExecuteQueuedRunResult> {
    const job = await this.gatewayControlPlane.getBuilderJob(jobId);
    if (!job) {
      throw new NotFoundException(`Builder job ${jobId} not found.`);
    }
    const projectRecord = await this.prisma.appBuilderProject.findUnique({ where: { id: job.projectId } });
    const runRecord = await this.prisma.appBuilderRun.findUnique({ where: { id: job.runId } });
    if (!projectRecord || !runRecord) {
      throw new Error('Builder project or run no longer exists.');
    }
    const project = this.toProject(projectRecord);
    const manifest = (await this.getLatestManifest(project.id))?.manifest || (await this.generateManifest(project.id)).manifest;
    const requestPrompt = typeof (job as any).requestPayload?.prompt === 'string'
      ? String((job as any).requestPayload.prompt)
      : project.description || project.name;

    if (runRecord.gatewayRunId) {
      await this.gatewayControlPlane.updateRun(runRecord.gatewayRunId, {
        status: 'running',
        workerId,
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        summary: `Running ${job.phase} for ${project.name}`,
      });
    }

    switch (job.phase) {
      case 'plan': {
        const { intent, spec, architecture } = await this.ensurePlanningArtifacts(project, runRecord.id, requestPrompt);
        const refreshedProject = await this.getProjectDetail(project.id);
        return {
          summary: `Planned ${project.name} through intent, spec, and architecture stages, and returned the planner review for approval.`,
          output: {
            phase: 'plan',
            template: this.templateFor(project).id,
            controlMode: project.controlMode,
            intent,
            spec,
            architecture,
            plannerReviewSummary: String(refreshedProject.project.metadata?.plannerReviewSummary || ''),
            plannerReviewModel: refreshedProject.project.metadata?.plannerReviewModel || null,
          },
        };
      }
      case 'generate': {
        const brief = await this.getBriefDraft({ projectId: project.id });
        const buildGateIssue = this.planApprovalIssue(project, brief.prompt || requestPrompt);
        if (buildGateIssue) {
          throw new Error(buildGateIssue);
        }
        const targetedPaths = Array.isArray((job as any).requestPayload?.targetedPaths)
          ? (job as any).requestPayload.targetedPaths.map((entry: unknown) => String(entry)).filter(Boolean)
          : null;
        const requestedGenerationMode = this.parseGenerationMode((job as any).requestPayload?.generationMode)
          || (typeof (job as any).requestPayload?.aiMode === 'string' ? this.parseGenerationMode((job as any).requestPayload.aiMode) : null)
          || null;
        const parentStagingId = typeof (job as any).requestPayload?.parentStagingId === 'string'
          ? String((job as any).requestPayload.parentStagingId)
          : typeof (job as any).requestPayload?.regenerateFromStagingId === 'string'
            ? String((job as any).requestPayload.regenerateFromStagingId)
            : null;
        const output = await this.generateManagedProjectFromArtifacts(project, runRecord.id, targetedPaths, requestedGenerationMode, {
          userRequest: requestPrompt,
        }, parentStagingId);
        return {
          summary: `Generated a ${String(output.generationMode || this.generationModeFor(project))} staged project for ${project.name}.`,
          output,
        };
      }
      case 'integrate': {
        const brief = await this.getBriefDraft({ projectId: project.id });
        const buildGateIssue = this.planApprovalIssue(project, brief.prompt || requestPrompt);
        if (buildGateIssue) {
          throw new Error(buildGateIssue);
        }
        const output = await this.generateManagedProjectFromArtifacts(project, runRecord.id, [
          'src/rawclaw-sdk.ts',
          'rawclaw.app.manifest.json',
          'src/App.tsx',
        ], null, { userRequest: requestPrompt });
        return {
          summary: `Integrated manifest, SDK hooks, and app shell wiring for ${project.name}.`,
          output,
        };
      }
      case 'validate': {
        if (!project.managedPath || !existsSync(project.managedPath)) {
          const staged = await this.generateManagedProjectFromArtifacts(project, runRecord.id);
          throw new Error(`Generation was staged as ${String(staged.stagingId || 'a staged generation')}. Apply the staged files before validation.`);
        }
        const validationTrigger = (job as any).requestPayload?.validationTrigger === 'auto_post_apply'
          ? 'auto_post_apply' as const
          : 'user_requested' as const;
        const validationSnapshotId = typeof (job as any).requestPayload?.validationSnapshotId === 'string'
          ? String((job as any).requestPayload.validationSnapshotId)
          : null;
        const stagingId = typeof (job as any).requestPayload?.stagingId === 'string'
          ? String((job as any).requestPayload.stagingId)
          : null;
        const { validation, session, healingAttempts } = await this.runValidationLoop(project, runRecord.id, {
          trigger: validationTrigger,
          validationSnapshotId,
          stagingId,
        });
        if (validation.status === 'stale') {
          return {
            summary: `Validation for ${project.name} completed but was stale because newer files were applied.`,
            output: {
              ...validation,
              session,
              healingAttempts,
            },
          };
        }
        if (!validation.ok) {
          throw new Error(validation.checks.filter((check) => check.status === 'failed').map((check) => check.summary).join(' '));
        }
        return {
          summary: `Validated ${project.name} with real build and typecheck commands.`,
          output: {
            ...validation,
            session,
            healingAttempts,
          },
        };
      }
      case 'deploy': {
        if (!project.approvalGranted) {
          throw new Error('Deployment is blocked until a human approval gate is satisfied.');
        }
        if (!project.managedPath || !existsSync(project.managedPath)) {
          const staged = await this.generateManagedProjectFromArtifacts(project, runRecord.id);
          throw new Error(`Generation was staged as ${String(staged.stagingId || 'a staged generation')}. Apply and validate the staged files before deployment.`);
        }
        const output = await this.deployManagedProject(project);
        const { spec, architecture } = await this.ensurePlanningArtifacts(project, runRecord.id);
        const brief = await this.getBriefDraft({ projectId: project.id });
        const existingTaskList = (await this.latestArtifact<AppBuilderTaskList>(project.id, 'task_list')) || this.initialTaskList(project, spec);
        const nextTaskList = this.updateTaskStatuses(existingTaskList, [
          { id: 'preview-register', status: 'in_progress', detail: 'Preview is live. Registration is the next shared step.' },
        ]);
        const memorySnapshot = await this.captureProjectMemory(project, `Deployment preview started for ${project.name}.`, ['app-builder', 'deploy', 'preview']);
        await this.writeProjectDocs(project, brief, nextTaskList, spec, architecture, memorySnapshot);
        return {
          summary: `Started a managed local preview for ${project.name}.`,
          output,
        };
      }
      case 'register': {
        if (!project.approvalGranted) {
          throw new Error('Registration is blocked until a human approval gate is satisfied.');
        }
        const output = await this.registerProjectApp(project);
        const { spec, architecture } = await this.ensurePlanningArtifacts(project, runRecord.id);
        const brief = await this.getBriefDraft({ projectId: project.id });
        const existingTaskList = (await this.latestArtifact<AppBuilderTaskList>(project.id, 'task_list')) || this.initialTaskList(project, spec);
        const nextTaskList = this.updateTaskStatuses(existingTaskList, [
          { id: 'preview-register', status: 'completed', detail: 'Preview started and the app is registered in RawClaw.' },
        ]);
        const memorySnapshot = await this.captureProjectMemory(project, `${project.name} was registered in RawClaw and is ready for control.`, ['app-builder', 'register', 'ready']);
        await this.writeProjectDocs(project, brief, nextTaskList, spec, architecture, memorySnapshot);
        return {
          summary: `Registered ${project.name} in the RawClaw App Registry.`,
          output,
        };
      }
      case 'import': {
        const adapter = await this.prisma.importedProjectAdapter.findFirst({
          where: { projectId: project.id },
          orderBy: { createdAt: 'desc' },
        });
        return {
          summary: `Imported external project metadata for ${project.name}.`,
          output: {
            sourcePath: project.sourcePath,
            adapterId: adapter?.id || null,
          },
        };
      }
      case 'adapter-generate': {
        const brief = await this.getBriefDraft({ projectId: project.id });
        const buildGateIssue = this.planApprovalIssue(project, brief.prompt || requestPrompt);
        if (buildGateIssue) {
          throw new Error(buildGateIssue);
        }
        const output = await this.generateManagedProject(project, manifest);
        const adapter = await this.prisma.importedProjectAdapter.findFirst({
          where: { projectId: project.id },
          orderBy: { createdAt: 'desc' },
        });
        if (adapter) {
          await this.prisma.importedProjectAdapter.update({
            where: { id: adapter.id },
            data: {
              status: 'staged',
              outputPath: path.join(String(output.managedPath || project.managedPath || ''), 'adapter'),
            },
          });
        }
        return {
          summary: `Generated adapter files for imported project ${project.name}.`,
          output,
        };
      }
      case 'export': {
        if (!project.managedPath || !existsSync(project.managedPath)) {
          const staged = await this.generateManagedProjectFromArtifacts(project, runRecord.id);
          throw new Error(`Generation was staged as ${String(staged.stagingId || 'a staged generation')}. Apply the staged files before export.`);
        }
        return {
          summary: `Exported ${project.name} into a managed bundle directory.`,
          output: await this.exportManagedProject(project),
        };
      }
      case 'control-test': {
        const registry = await this.prisma.appRegistryRecord.findFirst({
          where: { projectId: project.id, status: 'registered' },
          orderBy: { createdAt: 'desc' },
        });
        if (!registry) {
          throw new Error('Control test requires a registered app.');
        }
        const response = await this.executeControlCommand(registry.appId, {
          id: randomUUID(),
          appId: registry.appId,
          command: 'app.status',
          requestedAt: new Date().toISOString(),
        });
        if (!response.ok) {
          throw new Error(response.error || response.summary);
        }
        return {
          summary: `Control test passed for ${project.name}.`,
          output: response.data,
        };
      }
      case 'rollback': {
        const previousRecord = await this.prisma.appRegistryRecord.findFirst({
          where: { projectId: project.id, status: 'registered' },
          orderBy: [{ createdAt: 'desc' }],
          skip: 1,
        });
        if (!previousRecord?.deploymentLocation) {
          throw new Error('No previous deployment snapshot is available for rollback.');
        }
        await this.prisma.appBuilderProject.update({
          where: { id: project.id },
          data: {
            deployPath: previousRecord.deploymentLocation,
          },
        });
        return {
          summary: `Rolled ${project.name} back to ${previousRecord.version}.`,
          output: {
            deployPath: previousRecord.deploymentLocation,
            version: previousRecord.version,
          },
        };
      }
      default:
        throw new Error(`Unsupported builder phase ${job.phase}.`);
    }
  }

  private metricLabel(value: unknown): string {
    return String(value ?? 'unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '');
  }
}
