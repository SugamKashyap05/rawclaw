import type { ChatAttachment, ChatControlState } from './chat';

export type AppBuilderProjectStatus =
  | 'draft'
  | 'planned'
  | 'approval_required'
  | 'queued'
  | 'generating'
  | 'integrating'
  | 'generated_unvalidated'
  | 'validating'
  | 'deployment_ready'
  | 'deploying'
  | 'deployed'
  | 'registration_pending'
  | 'registered'
  | 'failed_fixable'
  | 'failed_unrecoverable'
  | 'interrupted'
  | 'importing'
  | 'adapter_generating';

export type AppBuilderRunStatus = AppBuilderProjectStatus | 'completed' | 'cancelled' | 'stale' | 'superseded';

export type AppBuilderSourceType = 'generated' | 'imported';
export type AppBuilderAppType = 'web_app' | 'ai_tool';
export type AppBuilderControlMode = 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
export type AppBuilderMode = 'chat' | 'workspace' | 'console';
export type AppBuilderComposerLane = 'discuss' | 'plan' | 'build';
export type AppBuilderApprovalStage = 'plan' | 'build' | 'validate' | 'deploy' | 'register';
export type AppBuilderGenerationMode = 'template' | 'ai_scaffold' | 'ai_edit' | 'ai_repair' | 'adapter';
export type AppBuilderSecurityScanStatus = 'pass' | 'needs_approval' | 'blocked';
export type AppBuilderWorkflowActionKind =
  | 'phase'
  | 'approve'
  | 'open_mode'
  | 'refresh'
  | 'resolve_conflict'
  | 'apply_staging'
  | 'rollback'
  | 'security_approval'
  | 'upload'
  | 'search'
  | 'explain';
export type AppBuilderPhase =
  | 'plan'
  | 'generate'
  | 'integrate'
  | 'validate'
  | 'deploy'
  | 'register'
  | 'import'
  | 'adapter-generate'
  | 'export'
  | 'control-test'
  | 'rollback';

export type AppBuilderStage =
  | 'intent'
  | 'spec'
  | 'architecture'
  | 'file_graph'
  | 'codegen'
  | 'integration'
  | 'validation'
  | 'healing'
  | 'preview'
  | 'registration'
  | 'docs'
  | 'tasking'
  | 'terminal'
  | 'memory'
  | 'activity';

export type AppBuilderArtifactKind =
  | 'intent'
  | 'spec'
  | 'architecture'
  | 'file_graph'
  | 'validation'
  | 'heal_attempt'
  | 'preview_session'
  | 'task_list'
  | 'project_bible'
  | 'memory_snapshot'
  | 'terminal_session'
  | 'file_revision'
  | 'activity'
  | 'generation_snapshot'
  | 'staged_generation'
  | 'staged_diff'
  | 'code_patch'
  | 'generated_tests'
  | 'runtime_handler'
  | 'context_pack'
  | 'brief_revision'
  | 'edit_session'
  | 'security_scan'
  | 'security_approval'
  | 'runtime_coverage'
  | 'harness_output'
  | 'reference_image'
  | 'reference_document'
  | 'reference_code'
  | 'upload_record'
  | 'project_suggestion'
  | 'index_retry'
  | 'cleanup_task';

export type RawClawSdkTransport = 'http' | 'event_stream' | 'mcp_plugin' | 'adapter_bridge';

export interface RawClawSdkCompatibility {
  sdkVersion: string;
  protocolVersion: string;
  minimumRuntimeVersion: string;
  supportedFeatures: string[];
  deprecatedFeatures?: string[];
}

export interface RawClawAppCapability {
  id: string;
  name: string;
  description: string;
  command: string;
  destructive?: boolean;
  requiresApproval?: boolean;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface RawClawAppManifest {
  appId: string;
  name: string;
  appType: AppBuilderAppType;
  sourceType: AppBuilderSourceType;
  version: string;
  compatibility: RawClawSdkCompatibility;
  controlMode: AppBuilderControlMode;
  routes: Array<{
    id: string;
    path: string;
    label: string;
    description?: string | null;
  }>;
  capabilities: RawClawAppCapability[];
  permissions: {
    required: string[];
    dangerous: string[];
    approvalRequired: boolean;
  };
  controlEndpoints: {
    commands: string;
    events: string;
    health?: string | null;
  };
  envRequirements: string[];
  deployment: {
    target: 'local_managed' | 'local_export_bundle' | 'external_import';
    location?: string | null;
  };
  metadata?: Record<string, unknown> | null;
}

export interface RawClawControlCommand {
  id: string;
  appId: string;
  command: string;
  routeId?: string | null;
  payload?: Record<string, unknown> | null;
  requestedBy?: string | null;
  requestedAt: string;
}

export interface RawClawControlResponse {
  id: string;
  appId: string;
  commandId: string;
  ok: boolean;
  status: 'accepted' | 'completed' | 'rejected' | 'failed';
  summary: string;
  data?: Record<string, unknown> | null;
  error?: string | null;
  respondedAt: string;
}

export interface RawClawAppEvent {
  id: string;
  appId: string;
  type:
    | 'app.ready'
    | 'app.health'
    | 'route.changed'
    | 'action.completed'
    | 'action.failed'
    | 'state.updated'
    | 'validation.failed'
    | 'control.rejected';
  summary: string;
  payload?: Record<string, unknown> | null;
  timestamp: string;
}

export interface AppBuilderManifestRecord {
  id: string;
  projectId: string;
  version: string;
  manifest: RawClawAppManifest;
  createdAt: string;
  updatedAt: string;
}

export interface AppBuilderTemplate {
  id: string;
  name: string;
  description: string;
  appType: AppBuilderAppType;
  starterStack: string;
  deployTargets: Array<'local_managed' | 'local_export_bundle' | 'external_import'>;
  validationCommands?: Array<{
    id: string;
    label: string;
    tool: 'typescript' | 'vite_build' | 'eslint' | 'vitest';
    optional?: boolean;
  }>;
  previewRuntime?: {
    kind: 'python_http_server';
    host: string;
    basePort: number;
  } | null;
  manifestDefaults: Pick<RawClawAppManifest, 'routes' | 'permissions' | 'envRequirements'>;
  generatedFiles: string[];
  validationChecks: string[];
}

export interface AppBuilderIntent {
  prompt: string;
  sourceType: AppBuilderSourceType;
  appType: AppBuilderAppType;
  controlMode: AppBuilderControlMode;
  templateId: string;
  domain: 'calculator' | 'dashboard' | 'crud' | 'ai_console' | 'generic_web' | 'imported_adapter';
  templateConfidence?: number;
  recommendedGenerationMode?: AppBuilderGenerationMode;
  selectedGenerationMode?: AppBuilderGenerationMode;
  summary: string;
  requestedFeatures: string[];
  controlActions: string[];
  runtimeEvents: string[];
  authRequired: boolean;
  dataMode: 'client' | 'server' | 'hybrid';
  requestedPhases: AppBuilderPhase[];
}

export interface AppSpecJson {
  title: string;
  summary: string;
  appType: AppBuilderAppType;
  templateId: string;
  domain: AppBuilderIntent['domain'];
  routes: Array<{
    id: string;
    path: string;
    label: string;
    description?: string | null;
  }>;
  features: string[];
  uiSections: string[];
  dataModel: Array<{
    id: string;
    label: string;
    fields: string[];
  }>;
  controlActions: string[];
  runtimeEvents: string[];
  notes?: string[];
}

export interface ArchitecturePlan {
  framework: 'react';
  buildTool: 'vite';
  language: 'typescript';
  styling: 'css';
  stateStrategy: 'local_state';
  sdkTransport: RawClawSdkTransport;
  routes: string[];
  dependencies: string[];
  devDependencies: string[];
  validationCommands: string[];
  previewStrategy: 'dist_http_server';
}

export interface FileTask {
  id: string;
  path: string;
  purpose: string;
  sourceKind: 'template' | 'generated' | 'control_hook' | 'config' | 'manifest' | 'style' | 'support';
  dependsOn: string[];
  validationOwner?: string | null;
}

export interface FileGraph {
  rootDir: string;
  generationOrder: string[];
  files: FileTask[];
}

export interface ValidationSession {
  ok: boolean;
  attempts: number;
  snapshotId?: string | null;
  status?: 'current' | 'stale' | 'superseded' | null;
  trigger?: 'auto_post_apply' | 'user_requested' | 'repair_attempt' | null;
  harnessRunId?: string | null;
  startedAt: string;
  finishedAt: string;
  commands: Array<{
    id: string;
    label: string;
    tool: string;
    status: 'passed' | 'failed' | 'skipped';
    output?: string | null;
  }>;
}

export interface AppBuilderHarnessMetadataV1 {
  schemaVersion: 1;
  projectId: string;
  appBuilderRunId?: string | null;
  snapshotId?: string | null;
  stagingId?: string | null;
  generationMode?: AppBuilderGenerationMode | null;
  validationTrigger?: 'auto_post_apply' | 'user_requested' | 'repair_attempt' | null;
  commandKind?: 'typecheck' | 'test' | 'build' | 'preview' | 'repair_validation' | 'other' | null;
  fileHashSummary?: Record<string, string> | null;
  timeoutPolicy?: {
    timeoutMs: number;
    gracefulCancelMs?: number;
  } | null;
  supersededBy?: string | null;
  rawOutputArtifactIds?: string[];
}

export interface AppBuilderWorkflowState {
  status: AppBuilderProjectStatus;
  phase?: AppBuilderPhase | null;
  generationMode?: AppBuilderGenerationMode | null;
  pendingApprovalStage?: AppBuilderApprovalStage | null;
  planCurrent: boolean;
  buildAllowed: boolean;
  validationState: 'none' | 'current' | 'stale' | 'failed' | 'superseded';
  recoveryFreeze?: {
    active: boolean;
    expiresAt: string;
    reason?: string | null;
  } | null;
  interrupted?: {
    phase?: AppBuilderPhase | null;
    retryCount: number;
    lastStableSnapshotId?: string | null;
    recoveryActions: string[];
  } | null;
  capacityState?: {
    aiJobsAvailable?: boolean;
    validationJobsAvailable?: boolean;
    previewSlotsAvailable?: boolean;
    queueDepth?: number;
  } | null;
}

export interface AppBuilderSecurityScanFinding {
  id: string;
  status: AppBuilderSecurityScanStatus;
  filePath: string;
  fileHash?: string | null;
  patternId: string;
  summary: string;
  details?: string | null;
}

export interface AppBuilderSecurityScan {
  id: string;
  status: AppBuilderSecurityScanStatus;
  stagingId?: string | null;
  findings: AppBuilderSecurityScanFinding[];
  createdAt: string;
}

export interface AppBuilderSecurityApproval {
  id: string;
  stagingId: string;
  filePath: string;
  fileHash: string;
  patternId: string;
  decision: 'approved' | 'rejected';
  approverId: string;
  approverRole: 'local_owner' | 'authenticated_user' | 'admin' | 'system';
  notes?: string | null;
  createdAt: string;
}

export interface AppBuilderGenerationSnapshot {
  id: string;
  projectId: string;
  baseSnapshotId?: string | null;
  status: 'initial' | 'staged' | 'applied' | 'validated' | 'stale' | 'superseded';
  validationPassedAt?: string | null;
  manifestPath: string;
  fileHashes: Record<string, string>;
  createdAt: string;
}

export interface AppBuilderStagedGeneration {
  id: string;
  projectId: string;
  generationMode: AppBuilderGenerationMode;
  baseSnapshotId: string;
  status: 'open' | 'partially_applied' | 'applied' | 'discarded' | 'conflict' | 'superseded' | 'superseded_stale';
  changedFiles: string[];
  parentStagingId?: string | null;
  stale?: boolean;
  retentionExpiresAt?: string | null;
  conflictResolutions?: Array<{ filePath: string; decision: string; resolvedAt: string; linkedStagingId?: string | null; linkedRunId?: string | null }>;
  securityApprovalLineage?: string[];
  referenceInfluence?: { scope: 'file' | 'generation'; references?: unknown[]; files?: Record<string, unknown> } | Record<string, unknown> | null;
  securityStatus?: AppBuilderSecurityScanStatus | null;
  diffSummary?: string | null;
  validationStatus?: 'not_run' | 'queued' | 'running' | 'passed' | 'failed' | 'stale' | 'superseded' | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppBuilderContextPackSummary {
  id: string;
  mode: AppBuilderGenerationMode | 'codebase_chat' | 'explain';
  tokenEstimate: number;
  targetBudget: number;
  hardCeiling: number;
  includedFiles: string[];
  excludedFiles: Array<{ path: string; reason: string }>;
  includedUploadIds?: string[];
  excludedUploadIds?: Array<{ uploadId: string; reason: string }>;
  createdAt: string;
}

export interface HealingAttempt {
  attempt: number;
  ok: boolean;
  failedFiles: string[];
  summary: string;
  logs: string[];
  createdAt: string;
}

export interface PreviewSession {
  status: 'starting' | 'ready' | 'failed';
  url?: string | null;
  port?: number | null;
  servedPath: string;
  processRunId?: string | null;
  processId?: string | null;
  startedAt: string;
}

export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WorkspaceFileNode[];
}

export interface WorkspaceFileTree {
  rootPath: string;
  tree: WorkspaceFileNode[];
  projectPath: string;
}

export interface WorkspaceFileRecord {
  path: string;
  name: string;
  content: string;
  exists: boolean;
  updatedAt?: string | null;
  size?: number | null;
  language?: string | null;
}

export interface WorkspaceFileDiff {
  path: string;
  previousContent: string | null;
  currentContent: string | null;
  summary: string;
  hunks: Array<{
    kind: 'context' | 'add' | 'remove';
    lineNumberOld?: number | null;
    lineNumberNew?: number | null;
    content: string;
  }>;
  generatedAt: string;
}

export interface WorkspaceFileEditRequest {
  path: string;
  content?: string | null;
  newPath?: string | null;
  isDirectory?: boolean;
}

export interface AppBuilderTaskItem {
  id: string;
  title: string;
  detail?: string | null;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed';
  phase?: AppBuilderPhase | null;
  owner?: 'planner' | 'builder' | 'validator' | 'operator' | 'system' | null;
  source?: 'brief' | 'plan' | 'build' | 'validation' | 'deploy' | 'register' | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppBuilderTaskList {
  projectId: string;
  updatedAt: string;
  tasks: AppBuilderTaskItem[];
}

export interface ProjectBibleDocument {
  id: string;
  path: string;
  title: string;
  summary: string;
  updatedAt: string;
}

export interface ProjectMemorySnapshot {
  projectId: string;
  collection: string;
  latestSummary: string | null;
  entries: Array<{
    id: string;
    preview: string;
    tags: string[];
    updatedAt: string;
  }>;
  agentMemoryPath?: string | null;
  updatedAt: string;
}

export interface TerminalCommandRecord {
  id: string;
  sessionId: string;
  command: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  background: boolean;
  cwd: string;
  requestedBy: string;
  output: string;
  exitCode?: number | null;
  previewUrl?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalSessionRecord {
  id: string;
  projectId: string;
  cwd: string;
  status: 'idle' | 'running' | 'stopped' | 'error';
  shared: boolean;
  activeCommandId?: string | null;
  previewUrl?: string | null;
  previewPort?: number | null;
  lastCommandAt?: string | null;
  commands: TerminalCommandRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PreviewConnectionState {
  mode: 'activity' | 'dev_server' | 'deploy_preview' | 'none';
  status: 'idle' | 'starting' | 'ready' | 'disconnected' | 'fallback' | 'failed';
  title: string;
  summary: string;
  url?: string | null;
  projectPath?: string | null;
  source?: 'terminal' | 'deploy' | 'fallback' | 'none';
  updatedAt: string;
}

export interface AppBuilderActivityEvent {
  id: string;
  projectId: string;
  runId?: string | null;
  phase?: AppBuilderPhase | null;
  lane?: AppBuilderComposerLane | null;
  kind:
    | 'system'
    | 'planner'
    | 'builder'
    | 'validator'
    | 'deploy'
    | 'register'
    | 'docs'
    | 'file'
    | 'terminal'
    | 'memory'
    | 'preview'
    | 'approval';
  status: 'info' | 'working' | 'success' | 'warning' | 'error';
  title: string;
  summary: string;
  modelId?: string | null;
  filePath?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AppBuilderArtifactRecord {
  id: string;
  projectId: string;
  runId?: string | null;
  kind: AppBuilderArtifactKind;
  stage: AppBuilderStage;
  label: string;
  payload:
    | AppBuilderIntent
    | AppSpecJson
    | ArchitecturePlan
    | FileGraph
    | ValidationSession
    | HealingAttempt
    | PreviewSession
    | Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AppBuilderValidationCheck {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  summary: string;
  details?: string | null;
}

export interface AppBuilderValidationResult {
  id: string;
  projectId: string;
  runId?: string | null;
  phase: AppBuilderPhase;
  ok: boolean;
  snapshotId?: string | null;
  status?: 'current' | 'stale' | 'superseded' | null;
  harnessRunId?: string | null;
  checks: AppBuilderValidationCheck[];
  createdAt: string;
}

export interface ImportedProjectAdapter {
  id: string;
  projectId: string;
  adapterType: 'mcp_plugin' | 'http_proxy' | 'sdk_wrapper';
  sourcePath: string;
  outputPath?: string | null;
  status: 'draft' | 'generated' | 'validated' | 'failed';
  warnings: string[];
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppBuilderProject {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  workspaceId: string;
  appType: AppBuilderAppType;
  sourceType: AppBuilderSourceType;
  templateId?: string | null;
  status: AppBuilderProjectStatus;
  controlMode: AppBuilderControlMode;
  approvalRequired: boolean;
  approvalGranted: boolean;
  requestedPermissions: string[];
  requestedCapabilities: string[];
  sourcePath?: string | null;
  managedPath?: string | null;
  deployPath?: string | null;
  exportPath?: string | null;
  latestManifestId?: string | null;
  latestRunId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppBuilderRun {
  id: string;
  projectId: string;
  phase: AppBuilderPhase;
  status: AppBuilderRunStatus;
  title: string;
  summary?: string | null;
  error?: string | null;
  gatewayRunId?: string | null;
  queueJobId?: string | null;
  workerId?: string | null;
  output?: Record<string, unknown> | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
}

export interface AppRegistryRecord {
  id: string;
  projectId?: string | null;
  appId: string;
  version: string;
  sourceType: AppBuilderSourceType;
  status: 'pending' | 'registered' | 'degraded' | 'disabled';
  manifest: RawClawAppManifest;
  controlEndpoint: string;
  eventStreamEndpoint: string;
  deploymentLocation?: string | null;
  healthStatus?: 'unknown' | 'healthy' | 'degraded' | 'offline' | null;
  capabilityList: string[];
  registeredAt: string;
  updatedAt: string;
}

export interface AppBuilderApprovalGate {
  projectId: string;
  runId?: string | null;
  required: boolean;
  approved: boolean;
  stage?: AppBuilderApprovalStage | null;
  reviewedAt?: string | null;
  reviewer?: string | null;
  notes?: string | null;
}

export interface AppBuilderQueueJob {
  id: string;
  turn_id?: string | null;
  runId: string;
  projectId: string;
  phase: AppBuilderPhase;
  gatewayRunId?: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  requestPayload?: Record<string, unknown> | null;
  workerId?: string | null;
  createdAt: string;
}

export type AppBuilderMessageRole = 'user' | 'assistant' | 'system';
export type AppBuilderMessageTone = 'default' | 'success' | 'warning' | 'error';

export interface AppBuilderModelRouteSnapshot {
  chat: string;
  planner: string;
  build: string;
}

export interface AppBuilderMessage {
  id: string;
  role: AppBuilderMessageRole;
  content: string;
  createdAt: string;
  tone?: AppBuilderMessageTone;
  meta?: string | null;
  attachments?: ChatAttachment[];
  modelId?: string | null;
  provenanceSummary?: string | null;
  researchSummary?: string | null;
  toolSummary?: string | null;
}

export interface AppBuilderConversation {
  id: string;
  scopeType: 'draft' | 'project';
  scopeId: string;
  projectId?: string | null;
  draftId?: string | null;
  title: string;
  mode: AppBuilderMode;
  messages: AppBuilderMessage[];
  updatedAt: string;
}

export interface AppBuilderSuggestedAction {
  id: string;
  label: string;
  labelTemplate?: string | null;
  resolvedLabel?: string | null;
  kind: AppBuilderWorkflowActionKind;
  phase?: AppBuilderPhase | null;
  mode?: AppBuilderMode | null;
  endpoint?: string | null;
  params?: Record<string, unknown> | null;
  requiresInput?: boolean;
  disabled?: boolean;
  reason?: string | null;
  emphasis?: 'primary' | 'secondary' | 'ghost';
}

export interface AppBuilderPreviewState {
  status: 'empty' | 'ready' | 'fallback' | 'starting' | 'disconnected';
  title: string;
  summary: string;
  url?: string | null;
  projectPath?: string | null;
  connection?: PreviewConnectionState | null;
  currentTab?: 'activity' | 'preview' | 'files' | 'docs' | 'terminal' | 'logs' | 'project';
  availableTabs: Array<'activity' | 'preview' | 'files' | 'docs' | 'terminal' | 'logs' | 'project'>;
  logs?: string[];
}

export interface AppBuilderBriefDraft {
  id: string;
  draftId?: string | null;
  projectId?: string | null;
  workspaceId: string;
  sourceType: AppBuilderSourceType;
  appType: AppBuilderAppType;
  controlMode: AppBuilderControlMode;
  templateId?: string | null;
  titleOverride?: string | null;
  sourcePath?: string | null;
  prompt?: string | null;
  updatedAt: string;
}

export type AppBuilderAssistantResponseKind = 'state_query' | 'draft_chat' | 'execution';

export interface AppBuilderAssistantResponse {
  draftId: string;
  projectId?: string | null;
  responseKind?: AppBuilderAssistantResponseKind;
  lane?: AppBuilderComposerLane;
  workflowState?: AppBuilderWorkflowState | null;
  generationMode?: AppBuilderGenerationMode | null;
  stagingId?: string | null;
  diffSummary?: string | null;
  validationSnapshotId?: string | null;
  harnessRunId?: string | null;
  capacityState?: AppBuilderWorkflowState['capacityState'] | null;
  indexFreshness?: string | null;
  isIndexStale?: boolean;
  contextFreshness?: string | null;
  isContextStale?: boolean;
  assistantReply: AppBuilderMessage;
  conversation: AppBuilderConversation;
  brief: AppBuilderBriefDraft;
  detail?: AppBuilderProjectDetail | null;
  preview: AppBuilderPreviewState;
  suggestedActions: AppBuilderSuggestedAction[];
  queuedRuns: AppBuilderRun[];
  preferredMode: AppBuilderMode;
  createdProject?: boolean;
  importedProject?: boolean;
  researchSummary?: string | null;
  provenanceSummary?: string | null;
}

export interface AppBuilderAssistantRequest {
  message: string;
  draftId?: string | null;
  projectId?: string | null;
  mode?: AppBuilderMode | null;
  lane?: AppBuilderComposerLane | null;
  attachments?: ChatAttachment[] | null;
  chatControls?: ChatControlState | null;
  brief?: Partial<{
    workspaceId: string;
    sourceType: AppBuilderSourceType;
    appType: AppBuilderAppType;
    controlMode: AppBuilderControlMode;
    templateId: string | null;
    titleOverride: string | null;
    sourcePath: string | null;
    prompt: string | null;
  }> | null;
}

export interface AppBuilderProjectDetail {
  project: AppBuilderProject;
  manifests: AppBuilderManifestRecord[];
  runs: AppBuilderRun[];
  registryRecords: AppRegistryRecord[];
  adapters: ImportedProjectAdapter[];
  artifacts: AppBuilderArtifactRecord[];
  latestValidation?: AppBuilderValidationResult | null;
  approvalGate?: AppBuilderApprovalGate | null;
  modelRoutes?: AppBuilderModelRouteSnapshot | null;
  docs?: ProjectBibleDocument[];
  taskList?: AppBuilderTaskList | null;
  fileTree?: WorkspaceFileTree | null;
  terminal?: TerminalSessionRecord | null;
  previewConnection?: PreviewConnectionState | null;
  memory?: ProjectMemorySnapshot | null;
  activity?: AppBuilderActivityEvent[];
  workflowState?: AppBuilderWorkflowState | null;
  generationMode?: AppBuilderGenerationMode | null;
  stagingId?: string | null;
  diffSummary?: string | null;
  nextAllowedActions?: AppBuilderSuggestedAction[];
  validationSnapshotId?: string | null;
  harnessRunId?: string | null;
  capacityState?: AppBuilderWorkflowState['capacityState'] | null;
  indexFreshness?: string | null;
  isIndexStale?: boolean;
  contextFreshness?: string | null;
  isContextStale?: boolean;
}
