import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AppBuilderAssistantResponse,
  AppBuilderBriefDraft,
  AppBuilderConversation,
  AppBuilderManifestRecord,
  AppBuilderPreviewState,
  AppBuilderProject,
  AppBuilderProjectDetail,
  AppBuilderRun,
  AppBuilderTemplate,
  AppBuilderValidationResult,
  AppRegistryRecord,
  RawClawAppManifest,
} from '@rawclaw/shared';
import AppBuilder from './AppBuilder';

const mockApproveAppBuilderProject = vi.fn();
const mockFetchAppBuilderBrief = vi.fn();
const mockFetchAppBuilderConversation = vi.fn();
const mockFetchAppBuilderPreview = vi.fn();
const mockFetchAppBuilderProjectDetail = vi.fn();
const mockFetchAppBuilderProjects = vi.fn();
const mockFetchAppBuilderRuns = vi.fn();
const mockFetchAppBuilderTemplates = vi.fn();
const mockFetchAppRegistryRecords = vi.fn();
const mockFetchAppBuilderWorkspaceFile = vi.fn();
const mockFetchAppBuilderWorkspaceDiff = vi.fn();
const mockSaveAppBuilderWorkspaceFile = vi.fn();
const mockDeleteAppBuilderProject = vi.fn();
const mockStartAppBuilderTerminalSession = vi.fn();
const mockStopAppBuilderTerminalSession = vi.fn();
const mockSubmitAppBuilderTerminalCommand = vi.fn();
const mockCreateAppBuilderWorkspaceFolder = vi.fn();
const mockRenameAppBuilderWorkspacePath = vi.fn();
const mockDeleteAppBuilderWorkspacePath = vi.fn();
const mockFormatAppBuilderWorkspaceFile = vi.fn();
const mockQueueAppBuilderPhase = vi.fn();
const mockSendAppBuilderAssistantMessage = vi.fn();
const mockUpdateAppBuilderBrief = vi.fn();
const mockUpdateAppBuilderProject = vi.fn();
const mockRetryAppBuilderSmokeRestore = vi.fn();
const mockResetAppBuilderControlState = vi.fn();
const mockRetryAppBuilderSuggestionVectorClear = vi.fn();

vi.mock('../lib/app-builder', () => ({
  approveAppBuilderProject: (...args: unknown[]) => mockApproveAppBuilderProject(...args),
  fetchAppBuilderBrief: (...args: unknown[]) => mockFetchAppBuilderBrief(...args),
  fetchAppBuilderConversation: (...args: unknown[]) => mockFetchAppBuilderConversation(...args),
  fetchAppBuilderPreview: (...args: unknown[]) => mockFetchAppBuilderPreview(...args),
  fetchAppBuilderProjectDetail: (...args: unknown[]) => mockFetchAppBuilderProjectDetail(...args),
  fetchAppBuilderProjects: (...args: unknown[]) => mockFetchAppBuilderProjects(...args),
  fetchAppBuilderRuns: (...args: unknown[]) => mockFetchAppBuilderRuns(...args),
  fetchAppBuilderTemplates: (...args: unknown[]) => mockFetchAppBuilderTemplates(...args),
  fetchAppRegistryRecords: (...args: unknown[]) => mockFetchAppRegistryRecords(...args),
  fetchAppBuilderWorkspaceFile: (...args: unknown[]) => mockFetchAppBuilderWorkspaceFile(...args),
  fetchAppBuilderWorkspaceDiff: (...args: unknown[]) => mockFetchAppBuilderWorkspaceDiff(...args),
  saveAppBuilderWorkspaceFile: (...args: unknown[]) => mockSaveAppBuilderWorkspaceFile(...args),
  deleteAppBuilderProject: (...args: unknown[]) => mockDeleteAppBuilderProject(...args),
  startAppBuilderTerminalSession: (...args: unknown[]) => mockStartAppBuilderTerminalSession(...args),
  stopAppBuilderTerminalSession: (...args: unknown[]) => mockStopAppBuilderTerminalSession(...args),
  submitAppBuilderTerminalCommand: (...args: unknown[]) => mockSubmitAppBuilderTerminalCommand(...args),
  createAppBuilderWorkspaceFolder: (...args: unknown[]) => mockCreateAppBuilderWorkspaceFolder(...args),
  renameAppBuilderWorkspacePath: (...args: unknown[]) => mockRenameAppBuilderWorkspacePath(...args),
  deleteAppBuilderWorkspacePath: (...args: unknown[]) => mockDeleteAppBuilderWorkspacePath(...args),
  formatAppBuilderWorkspaceFile: (...args: unknown[]) => mockFormatAppBuilderWorkspaceFile(...args),
  queueAppBuilderPhase: (...args: unknown[]) => mockQueueAppBuilderPhase(...args),
  sendAppBuilderAssistantMessage: (...args: unknown[]) => mockSendAppBuilderAssistantMessage(...args),
  updateAppBuilderBrief: (...args: unknown[]) => mockUpdateAppBuilderBrief(...args),
  updateAppBuilderProject: (...args: unknown[]) => mockUpdateAppBuilderProject(...args),
  retryAppBuilderSmokeRestore: (...args: unknown[]) => mockRetryAppBuilderSmokeRestore(...args),
  resetAppBuilderControlState: (...args: unknown[]) => mockResetAppBuilderControlState(...args),
  retryAppBuilderSuggestionVectorClear: (...args: unknown[]) => mockRetryAppBuilderSuggestionVectorClear(...args),
}));

const mockApiGet = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

function makeManifest(): RawClawAppManifest {
  return {
    appId: 'support-dashboard',
    name: 'Support Dashboard',
    appType: 'web_app',
    sourceType: 'generated',
    version: '0.1.0',
    compatibility: {
      sdkVersion: '1.0.0',
      protocolVersion: 'v1',
      minimumRuntimeVersion: '0.1.0',
      supportedFeatures: ['http_control', 'event_stream'],
      deprecatedFeatures: [],
    },
    controlMode: 'assist_only',
    routes: [{ id: 'home', path: '/', label: 'Home', description: 'Primary route.' }],
    capabilities: [{ id: 'status', name: 'Status', description: 'Read state.', command: 'app.status' }],
    permissions: {
      required: ['project.read', 'project.control'],
      dangerous: ['project.deploy'],
      approvalRequired: true,
    },
    controlEndpoints: {
      commands: 'http://localhost:3000/api/app-builder/apps/support-dashboard/control',
      events: 'http://localhost:3000/api/app-builder/apps/support-dashboard/events/stream',
      health: 'http://localhost:3000/api/app-builder/apps/support-dashboard/health',
    },
    envRequirements: ['RAWCLAW_API_URL'],
    deployment: {
      target: 'local_managed',
      location: 'data/app-builder/projects/support-dashboard/current',
    },
    metadata: { templateId: 'web-dashboard' },
  };
}

function makeTemplate(): AppBuilderTemplate {
  return {
    id: 'web-dashboard',
    name: 'Web Dashboard',
    description: 'A managed React dashboard scaffold with RawClaw control hooks.',
    appType: 'web_app',
    starterStack: 'React + Vite',
    deployTargets: ['local_managed', 'local_export_bundle'],
    manifestDefaults: {
      routes: [{ id: 'home', path: '/', label: 'Home', description: 'Primary route.' }],
      permissions: {
        required: ['project.read', 'project.control'],
        dangerous: ['project.deploy'],
        approvalRequired: true,
      },
      envRequirements: ['RAWCLAW_API_URL'],
    },
    generatedFiles: ['package.json', 'src/App.tsx', 'src/rawclaw-sdk.ts'],
    validationChecks: ['manifest', 'sdk_contract'],
  };
}

function makeAiTemplate(): AppBuilderTemplate {
  return {
    id: 'ai-tool-web-console',
    name: 'AI Tool Console',
    description: 'An operator-facing AI console scaffold.',
    appType: 'ai_tool',
    starterStack: 'React + FastAPI',
    deployTargets: ['local_managed', 'local_export_bundle'],
    manifestDefaults: {
      routes: [{ id: 'console', path: '/', label: 'Console', description: 'Primary route.' }],
      permissions: {
        required: ['project.read', 'project.control'],
        dangerous: ['project.deploy'],
        approvalRequired: true,
      },
      envRequirements: ['RAWCLAW_API_URL'],
    },
    generatedFiles: ['package.json', 'src/App.tsx', 'src/rawclaw-sdk.ts'],
    validationChecks: ['manifest', 'sdk_contract'],
  };
}

function makeProject(): AppBuilderProject {
  return {
    id: 'project-1',
    name: 'Support Dashboard',
    slug: 'support-dashboard',
    description: 'Controllable support dashboard.',
    workspaceId: 'default',
    appType: 'web_app',
    sourceType: 'generated',
    templateId: 'web-dashboard',
    status: 'deployment_ready',
    controlMode: 'assist_only',
    approvalRequired: true,
    approvalGranted: false,
    requestedPermissions: ['project.read', 'project.control'],
    requestedCapabilities: ['app.status'],
    sourcePath: null,
    managedPath: 'data/app-builder/projects/support-dashboard/current',
    deployPath: null,
    exportPath: null,
    latestManifestId: 'manifest-1',
    latestRunId: 'run-1',
    metadata: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:05:00.000Z',
  };
}

function makeManifestRecord(): AppBuilderManifestRecord {
  return {
    id: 'manifest-1',
    projectId: 'project-1',
    version: '0.1.0',
    manifest: makeManifest(),
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:01:00.000Z',
  };
}

function makeRun(overrides: Partial<AppBuilderRun> = {}): AppBuilderRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    phase: 'generate',
    status: 'completed',
    title: 'Generate Support Dashboard',
    summary: 'Managed project generated.',
    error: null,
    gatewayRunId: 'gateway-run-1',
    queueJobId: 'queue-job-1',
    workerId: 'worker-1',
    output: { managedPath: 'data/app-builder/projects/support-dashboard/current' },
    createdAt: '2026-05-01T10:02:00.000Z',
    startedAt: '2026-05-01T10:02:30.000Z',
    finishedAt: '2026-05-01T10:03:00.000Z',
    updatedAt: '2026-05-01T10:03:00.000Z',
    ...overrides,
  };
}

function makeRegistryRecord(): AppRegistryRecord {
  return {
    id: 'registry-1',
    projectId: 'project-1',
    appId: 'support-dashboard',
    version: '0.1.0',
    sourceType: 'generated',
    status: 'registered',
    manifest: makeManifest(),
    controlEndpoint: 'http://localhost:3000/api/app-builder/apps/support-dashboard/control',
    eventStreamEndpoint: 'http://localhost:3000/api/app-builder/apps/support-dashboard/events/stream',
    deploymentLocation: 'http://localhost:4173',
    healthStatus: 'healthy',
    capabilityList: ['app.status'],
    registeredAt: '2026-05-01T10:04:00.000Z',
    updatedAt: '2026-05-01T10:04:00.000Z',
  };
}

function makeValidation(): AppBuilderValidationResult {
  return {
    id: 'validation-1',
    projectId: 'project-1',
    phase: 'validate',
    ok: true,
    checks: [
      {
        id: 'manifest',
        label: 'Manifest',
        status: 'passed',
        summary: 'Manifest matches the RawClaw App SDK contract.',
      },
    ],
    createdAt: '2026-05-01T10:03:30.000Z',
  };
}

function makeDetail(): AppBuilderProjectDetail {
  return {
    project: makeProject(),
    manifests: [makeManifestRecord()],
    runs: [makeRun()],
    registryRecords: [makeRegistryRecord()],
    adapters: [],
    artifacts: [
      {
        id: 'artifact-spec',
        projectId: 'project-1',
        runId: 'run-1',
        kind: 'spec',
        stage: 'spec',
        label: 'Structured app spec',
        payload: {
          title: 'Support Dashboard',
          summary: 'A controllable support dashboard with queue, approvals, and analytics views.',
          appType: 'web_app',
          templateId: 'web-dashboard',
          domain: 'dashboard',
          routes: [{ id: 'home', path: '/', label: 'Home', description: 'Primary route.' }],
          features: ['ticket queue', 'approval inbox', 'analytics'],
          uiSections: ['hero', 'kpi cards', 'queue table'],
          dataModel: [],
          controlActions: ['app.status'],
          runtimeEvents: ['app.ready'],
        },
        createdAt: '2026-05-01T10:01:00.000Z',
        updatedAt: '2026-05-01T10:01:00.000Z',
      },
      {
        id: 'artifact-architecture',
        projectId: 'project-1',
        runId: 'run-1',
        kind: 'architecture',
        stage: 'architecture',
        label: 'Architecture plan',
        payload: {
          framework: 'react',
          buildTool: 'vite',
          language: 'typescript',
          styling: 'css',
          stateStrategy: 'local_state',
          sdkTransport: 'http',
          routes: ['/'],
          dependencies: ['react', 'react-dom'],
          devDependencies: ['vite', 'typescript'],
          validationCommands: ['typecheck', 'build'],
          previewStrategy: 'dist_http_server',
        },
        createdAt: '2026-05-01T10:01:10.000Z',
        updatedAt: '2026-05-01T10:01:10.000Z',
      },
      {
        id: 'artifact-file-graph',
        projectId: 'project-1',
        runId: 'run-1',
        kind: 'file_graph',
        stage: 'file_graph',
        label: 'File graph',
        payload: {
          rootDir: 'data/app-builder/projects/support-dashboard/current',
          generationOrder: ['package.json', 'README.md', 'src/App.tsx'],
          files: [
            { id: 'package', path: 'package.json', purpose: 'Package', sourceKind: 'config', dependsOn: [] },
            { id: 'readme', path: 'README.md', purpose: 'Readme', sourceKind: 'support', dependsOn: ['package'] },
            { id: 'app', path: 'src/App.tsx', purpose: 'App shell', sourceKind: 'generated', dependsOn: ['package'] },
          ],
        },
        createdAt: '2026-05-01T10:01:20.000Z',
        updatedAt: '2026-05-01T10:01:20.000Z',
      },
      {
        id: 'artifact-validation',
        projectId: 'project-1',
        runId: 'run-1',
        kind: 'validation',
        stage: 'validation',
        label: 'Validation session',
        payload: {
          ok: true,
          attempts: 1,
          startedAt: '2026-05-01T10:03:00.000Z',
          finishedAt: '2026-05-01T10:03:10.000Z',
          commands: [
            { id: 'typecheck', label: 'TypeScript typecheck', tool: 'typescript', status: 'passed', output: '' },
            { id: 'build', label: 'Vite production build', tool: 'vite_build', status: 'passed', output: '' },
          ],
        },
        createdAt: '2026-05-01T10:03:10.000Z',
        updatedAt: '2026-05-01T10:03:10.000Z',
      },
      {
        id: 'artifact-preview',
        projectId: 'project-1',
        runId: 'run-1',
        kind: 'preview_session',
        stage: 'preview',
        label: 'Preview session',
        payload: {
          status: 'ready',
          url: 'http://127.0.0.1:4173',
          port: 4173,
          servedPath: 'data/app-builder/projects/support-dashboard/current/dist',
          processRunId: 'preview-run-1',
          processId: '5012',
          startedAt: '2026-05-01T10:04:00.000Z',
        },
        createdAt: '2026-05-01T10:04:00.000Z',
        updatedAt: '2026-05-01T10:04:00.000Z',
      },
    ],
    latestValidation: makeValidation(),
    approvalGate: {
      projectId: 'project-1',
      runId: 'run-1',
      required: true,
      approved: false,
      stage: 'deploy',
      reviewedAt: null,
      reviewer: null,
      notes: null,
    },
    modelRoutes: {
      chat: 'gpt-5.5',
      planner: 'gpt-5.4',
      build: 'gpt-5.3-codex',
    },
    docs: [
      {
        id: 'doc-plan',
        path: 'docs/PLAN.md',
        title: 'PLAN',
        summary: 'Planner scope and execution outline.',
        updatedAt: '2026-05-01T10:01:00.000Z',
      },
    ],
    taskList: {
      projectId: 'project-1',
      updatedAt: '2026-05-01T10:01:00.000Z',
      tasks: [
        {
          id: 'plan-review',
          title: 'Review planner output',
          status: 'in_progress',
          phase: 'plan',
          owner: 'planner',
          source: 'plan',
          detail: 'Waiting for user approval before build.',
          createdAt: '2026-05-01T10:01:00.000Z',
          updatedAt: '2026-05-01T10:01:00.000Z',
        },
      ],
    },
    fileTree: {
      rootPath: 'data/app-builder/projects/support-dashboard/current',
      projectPath: 'data/app-builder/projects/support-dashboard/current',
      tree: [
        {
          name: 'docs',
          path: 'docs',
          type: 'directory',
          children: [
            { name: 'PLAN.md', path: 'docs/PLAN.md', type: 'file' },
          ],
        },
        {
          name: 'src',
          path: 'src',
          type: 'directory',
          children: [
            { name: 'App.tsx', path: 'src/App.tsx', type: 'file' },
          ],
        },
      ],
    },
    terminal: {
      id: 'terminal-1',
      projectId: 'project-1',
      cwd: 'data/app-builder/projects/support-dashboard/current',
      status: 'idle',
      shared: true,
      activeCommandId: null,
      previewUrl: null,
      previewPort: null,
      lastCommandAt: '2026-05-01T10:05:00.000Z',
      commands: [],
      createdAt: '2026-05-01T10:05:00.000Z',
      updatedAt: '2026-05-01T10:05:00.000Z',
    },
    previewConnection: {
      mode: 'activity',
      status: 'starting',
      title: 'Planner activity in progress',
      summary: 'Open Activity, Files, or Docs to watch the agent prepare the project before preview exists.',
      url: null,
      projectPath: 'data/app-builder/projects/support-dashboard/current',
      source: 'none',
      updatedAt: '2026-05-01T10:05:00.000Z',
    },
    memory: {
      projectId: 'project-1',
      collection: 'app-builder:project-1',
      latestSummary: 'Support dashboard scope approved with queue and analytics focus.',
      entries: [],
      agentMemoryPath: 'docs/AGENT_MEMORY.md',
      updatedAt: '2026-05-01T10:05:00.000Z',
    },
    activity: [
      {
        id: 'activity-1',
        projectId: 'project-1',
        runId: 'run-1',
        phase: 'plan',
        lane: 'plan',
        kind: 'planner',
        status: 'working',
        title: 'Planner is writing project docs',
        summary: 'PLAN.md and TASKS.md are being updated.',
        modelId: 'gpt-5.4',
        filePath: 'docs/PLAN.md',
        metadata: null,
        createdAt: '2026-05-01T10:01:05.000Z',
      },
    ],
  };
}

function makeDraftConversation(): AppBuilderConversation {
  return {
    id: 'draft:draft-1',
    scopeType: 'draft',
    scopeId: 'draft-1',
    projectId: null,
    draftId: 'draft-1',
    title: 'New Builder',
    mode: 'chat',
    messages: [],
    updatedAt: '2026-05-01T10:00:00.000Z',
  };
}

function makeProjectConversation(): AppBuilderConversation {
  return {
    id: 'project:project-1',
    scopeType: 'project',
    scopeId: 'project-1',
    projectId: 'project-1',
    draftId: null,
    title: 'Support Dashboard',
    mode: 'chat',
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Created the builder project and queued planning.',
        createdAt: '2026-05-01T10:00:30.000Z',
        tone: 'success',
        meta: 'queued plan',
      },
    ],
    updatedAt: '2026-05-01T10:00:30.000Z',
  };
}

function makeDraftBrief(): AppBuilderBriefDraft {
  return {
    id: 'draft:draft-1',
    draftId: 'draft-1',
    projectId: null,
    workspaceId: 'default',
    sourceType: 'generated',
    appType: 'web_app',
    controlMode: 'assist_only',
    templateId: 'web-dashboard',
    titleOverride: null,
    sourcePath: null,
    prompt: null,
    updatedAt: '2026-05-01T10:00:00.000Z',
  };
}

function makeProjectBrief(): AppBuilderBriefDraft {
  return {
    ...makeDraftBrief(),
    id: 'project:project-1',
    draftId: null,
    projectId: 'project-1',
    titleOverride: 'Support Dashboard',
    prompt: 'Build a customer support dashboard.',
  };
}

function makePreview(overrides: Partial<AppBuilderPreviewState> = {}): AppBuilderPreviewState {
  return {
    status: 'empty',
    title: 'Preview will appear after generate/integrate',
    summary: 'Generate or deploy to unlock a live preview.',
    url: null,
    projectPath: 'data/app-builder/projects/support-dashboard/current',
    currentTab: 'activity',
    availableTabs: ['activity', 'preview', 'files', 'docs', 'terminal', 'logs'],
    logs: ['plan: queued', 'generate: completed'],
    ...overrides,
  };
}

function makeAssistantResponse(): AppBuilderAssistantResponse {
  const detail = makeDetail();
  return {
    draftId: 'draft-1',
    projectId: 'project-1',
    lane: 'discuss',
    assistantReply: {
      id: 'assistant-2',
      role: 'assistant',
      content: 'Created Support Dashboard and queued planning.',
      createdAt: '2026-05-01T10:01:00.000Z',
      tone: 'success',
      meta: 'queued plan',
    },
    conversation: {
      ...makeProjectConversation(),
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Build a customer support dashboard.',
          createdAt: '2026-05-01T10:00:45.000Z',
          meta: 'prompt',
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: 'Created Support Dashboard and queued planning.',
          createdAt: '2026-05-01T10:01:00.000Z',
          tone: 'success',
          meta: 'queued plan',
        },
      ],
    },
    brief: makeProjectBrief(),
    detail,
    preview: makePreview(),
    suggestedActions: [
      { id: 'generate', label: 'Generate', kind: 'phase', phase: 'generate', emphasis: 'primary' },
      { id: 'workspace', label: 'Workspace', kind: 'open_mode', mode: 'workspace', emphasis: 'ghost' },
    ],
    queuedRuns: [makeRun({ id: 'run-plan', phase: 'plan', title: 'Plan Support Dashboard' })],
    preferredMode: 'workspace',
    createdProject: true,
    importedProject: false,
  };
}

function makeDraftAssistantResponse(): AppBuilderAssistantResponse {
  return {
    draftId: 'draft-1',
    projectId: null,
    lane: 'discuss',
    assistantReply: {
      id: 'assistant-draft-1',
      role: 'assistant',
      content: 'I captured the brief and can keep refining it with you before we start planning.',
      createdAt: '2026-05-01T10:01:00.000Z',
      tone: 'default',
      meta: 'brief refinement',
    },
    conversation: {
      ...makeDraftConversation(),
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Build a customer support dashboard.',
          createdAt: '2026-05-01T10:00:45.000Z',
          meta: 'prompt',
        },
        {
          id: 'assistant-draft-1',
          role: 'assistant',
          content: 'I captured the brief and can keep refining it with you before we start planning.',
          createdAt: '2026-05-01T10:01:00.000Z',
          tone: 'default',
          meta: 'brief refinement',
        },
      ],
    },
    brief: {
      ...makeDraftBrief(),
      prompt: 'Build a customer support dashboard.',
    },
    detail: null,
    preview: makePreview({ projectPath: null, logs: [] }),
    suggestedActions: [
      { id: 'plan', label: 'Create plan', kind: 'phase', phase: 'plan', emphasis: 'primary' },
      { id: 'build', label: 'Build first version', kind: 'phase', phase: 'generate', emphasis: 'ghost' },
    ],
    queuedRuns: [],
    preferredMode: 'chat',
    createdProject: false,
    importedProject: false,
  };
}

describe('AppBuilder page', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockApiGet.mockResolvedValue({
      data: {
        routing: {
          appBuilder: 'gpt-5.5',
          appBuilderPlanner: 'gpt-5.4',
          appBuilderBuilder: 'gpt-5.3-codex',
          outputReviewer: '',
          low: 'gpt-5.4-mini',
          medium: 'gpt-5.4',
          high: 'gpt-5.5',
        },
      },
    });
    mockFetchAppBuilderTemplates.mockResolvedValue([makeTemplate(), makeAiTemplate()]);
    mockFetchAppBuilderProjects.mockResolvedValue([makeProject()]);
    mockFetchAppBuilderRuns.mockResolvedValue([makeRun()]);
    mockFetchAppRegistryRecords.mockResolvedValue([makeRegistryRecord()]);
    mockFetchAppBuilderConversation.mockImplementation((params?: { projectId?: string | null }) => {
      if (params?.projectId) {
        return Promise.resolve(makeProjectConversation());
      }
      return Promise.resolve(makeDraftConversation());
    });
    mockFetchAppBuilderBrief.mockImplementation((params?: { projectId?: string | null }) => {
      if (params?.projectId) {
        return Promise.resolve(makeProjectBrief());
      }
      return Promise.resolve(makeDraftBrief());
    });
    mockFetchAppBuilderProjectDetail.mockResolvedValue(makeDetail());
    mockFetchAppBuilderPreview.mockResolvedValue(makePreview());
    mockFetchAppBuilderWorkspaceFile.mockImplementation((_projectId: string, filePath: string) =>
      Promise.resolve({
        path: filePath,
        language: filePath.endsWith('.md') ? 'markdown' : 'typescript',
        content: filePath === 'docs/PLAN.md' ? '# Plan\n\n- Review scope\n- Approve build\n' : 'export default function App() { return <div>Support Dashboard</div>; }',
      }),
    );
    mockFetchAppBuilderWorkspaceDiff.mockResolvedValue({
      path: 'docs/PLAN.md',
      previousContent: null,
      currentContent: '# Plan',
      summary: 'Initial planner document created.',
      hunks: [{ kind: 'add', lineNumberOld: null, lineNumberNew: 1, content: '# Plan' }],
      generatedAt: '2026-05-01T10:01:05.000Z',
    });
    mockSaveAppBuilderWorkspaceFile.mockResolvedValue({
      path: 'docs/PLAN.md',
      language: 'markdown',
      content: '# Plan\n\nSaved',
    });
    mockDeleteAppBuilderProject.mockResolvedValue(undefined);
    mockStartAppBuilderTerminalSession.mockResolvedValue(makeDetail().terminal);
    mockStopAppBuilderTerminalSession.mockResolvedValue(makeDetail().terminal);
    mockSubmitAppBuilderTerminalCommand.mockResolvedValue(makeDetail().terminal);
    mockCreateAppBuilderWorkspaceFolder.mockResolvedValue(undefined);
    mockRenameAppBuilderWorkspacePath.mockResolvedValue(undefined);
    mockDeleteAppBuilderWorkspacePath.mockResolvedValue(undefined);
    mockFormatAppBuilderWorkspaceFile.mockResolvedValue({
      path: 'docs/PLAN.md',
      language: 'markdown',
      content: '# Plan\n\nFormatted',
    });
    mockSendAppBuilderAssistantMessage.mockResolvedValue(makeAssistantResponse());
    mockQueueAppBuilderPhase.mockResolvedValue(makeRun({ id: 'run-2', phase: 'deploy', title: 'Deploy Support Dashboard' }));
    mockApproveAppBuilderProject.mockResolvedValue(makeDetail());
    mockUpdateAppBuilderBrief.mockResolvedValue(makeProjectBrief());
    mockUpdateAppBuilderProject.mockResolvedValue(makeDetail());
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  const renderPage = (initialEntry = '/app-builder') =>
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app-builder/*" element={<AppBuilder />} />
        </Routes>
      </MemoryRouter>,
    );

  it('renders the builder dashboard first with chat, starter prompts, and recent projects', async () => {
    renderPage();

    expect(await screen.findByText(/Describe the app you want/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Refine the brief, ask for research/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Emoji/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send/i })).toBeInTheDocument();
    expect(screen.getByText(/Build a customer support dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Continue a project/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Support Dashboard/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Activity/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/APP BUILDER \/ BUILDER/i)).not.toBeInTheDocument();
  });

  it('uses the backend assistant endpoint for a discuss prompt and keeps the dashboard open while briefing continues', async () => {
    const user = userEvent.setup();
    mockSendAppBuilderAssistantMessage.mockResolvedValueOnce(makeDraftAssistantResponse());
    renderPage();

    const input = await screen.findByPlaceholderText(/Refine the brief, ask for research/i);
    await user.type(input, 'Build a customer support dashboard.');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(mockSendAppBuilderAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Build a customer support dashboard.',
          projectId: null,
          mode: 'chat',
          brief: expect.objectContaining({
            sourceType: 'generated',
            appType: 'web_app',
            controlMode: 'assist_only',
          }),
        }),
      );
    });

    expect(await screen.findByText(/I captured the brief and can keep refining it with you/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Activity/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create plan/i })).toBeInTheDocument();
  });

  it('routes the builder composer through the planner lane and reveals the workspace when planning starts', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByPlaceholderText(/Refine the brief, ask for research/i);
    await user.type(input, 'Build a controllable calculator app.');
    await user.click(screen.getByRole('button', { name: /^Plan$/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Plan$/i }).length).toBeGreaterThan(1);
    });
    const submitPlanButtons = screen.getAllByRole('button', { name: /^Plan$/i });
    await user.click(submitPlanButtons[submitPlanButtons.length - 1]);

    await waitFor(() => {
      expect(mockSendAppBuilderAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Build a controllable calculator app.',
          projectId: null,
          lane: 'plan',
        }),
      );
    });

    expect(await screen.findByRole('button', { name: /Activity/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Files/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Terminal/i })).toBeInTheDocument();
    expect(screen.getByText(/Planner is writing project docs/i)).toBeInTheDocument();
  });

  it('routes the builder composer through the build lane when Build is selected', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByPlaceholderText(/Refine the brief, ask for research/i);
    await user.type(input, 'Build an image viewing tool with gallery and zoom controls.');
    await user.click(screen.getByRole('button', { name: /^Build$/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Build$/i }).length).toBeGreaterThan(1);
    });
    const submitBuildButtons = screen.getAllByRole('button', { name: /^Build$/i });
    await user.click(submitBuildButtons[submitBuildButtons.length - 1]);

    await waitFor(() => {
      expect(mockSendAppBuilderAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Build an image viewing tool with gallery and zoom controls.',
          projectId: null,
          lane: 'build',
        }),
      );
    });
  });

  it('supports emoji insertion in the composer', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByPlaceholderText(/Refine the brief, ask for research/i);
    await user.click(screen.getByRole('button', { name: /Emoji/i }));
    const emojiButton = screen.getAllByRole('button').find((button) => button.textContent === '🚀');
    expect(emojiButton).toBeTruthy();
    await user.click(emojiButton!);

    expect(input).toHaveValue('🚀');
  });

  it('passes attachments through the builder assistant request', async () => {
    const user = userEvent.setup();
    renderPage();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const pdf = new File(['%PDF-1.4 fake'], 'wireframe.pdf', { type: 'application/pdf' });
    await user.upload(fileInput!, pdf);

    const input = await screen.findByPlaceholderText(/Refine the brief, ask for research/i);
    await user.type(input, 'Plan this app from the attached PDF.');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(mockSendAppBuilderAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.arrayContaining([
            expect.objectContaining({
              filename: 'wireframe.pdf',
              type: 'application/pdf',
            }),
          ]),
        }),
      );
    });
  });

  it('renders assistant markdown content inside the builder chat', async () => {
    const user = userEvent.setup();
    mockSendAppBuilderAssistantMessage.mockResolvedValueOnce({
      ...makeDraftAssistantResponse(),
      assistantReply: {
        id: 'assistant-progress-1',
        role: 'assistant',
        content: 'Progress for **Support Dashboard**:\n- Project status: planned.\n- Docs: ready.',
        createdAt: '2026-05-01T10:02:00.000Z',
        tone: 'default',
        meta: 'state query: progress',
      },
      conversation: {
        ...makeDraftConversation(),
        messages: [
          {
            id: 'user-progress-1',
            role: 'user',
            content: "what's the progress of the work in this project",
            createdAt: '2026-05-01T10:01:45.000Z',
            meta: 'prompt',
          },
          {
            id: 'assistant-progress-1',
            role: 'assistant',
            content: 'Progress for **Support Dashboard**:\n- Project status: planned.\n- Docs: ready.',
            createdAt: '2026-05-01T10:02:00.000Z',
            tone: 'default',
            meta: 'state query: progress',
          },
        ],
      },
    });

    const { container } = renderPage();
    const input = await screen.findByPlaceholderText(/Refine the brief, ask for research/i);
    await user.type(input, "what's the progress of the work in this project");
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    expect(await screen.findByText(/Progress for/i)).toBeInTheDocument();
    expect(container.querySelectorAll('li').length).toBeGreaterThan(0);
  });

  it('shows a friendly builder error card instead of a raw 500 message', async () => {
    const user = userEvent.setup();
    mockSendAppBuilderAssistantMessage.mockRejectedValueOnce({
      response: {
        status: 500,
        data: { message: 'Builder service failed.' },
      },
      message: 'Request failed with status code 500',
    });

    renderPage();

    const input = await screen.findByPlaceholderText(/Refine the brief, ask for research/i);
    await user.type(input, 'Build a customer support dashboard.');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    expect(await screen.findByText(/I couldn.t complete that builder step/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was deployed or registered/i)).toBeInTheDocument();
    expect(screen.getByText(/Debug details/i)).toBeInTheDocument();
    expect(screen.getByText(/Builder service failed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create an AI tool console/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry last request/i })).toBeInTheDocument();
  });

  it('lets the user delete an unwanted builder project from the projects page', async () => {
    const user = userEvent.setup();
    mockFetchAppBuilderProjects
      .mockResolvedValueOnce([makeProject()])
      .mockResolvedValueOnce([]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage('/app-builder/projects');

    expect((await screen.findAllByRole('heading', { name: 'Projects' })).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteAppBuilderProject).toHaveBeenCalledWith('project-1');
    });
    await waitFor(() => {
      expect(screen.queryByText(/Support Dashboard/i)).not.toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  });

  it('preserves the selected project while moving between projects and live preview routes', async () => {
    const user = userEvent.setup();
    renderPage('/app-builder/projects');

    expect((await screen.findAllByRole('heading', { name: 'Projects' })).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect((await screen.findAllByRole('heading', { name: 'Live Preview' })).length).toBeGreaterThan(0);
    expect(screen.getByText(/Support Dashboard \/ deployment ready/i)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Open Builder' })[0]);
    await user.click(await screen.findByRole('button', { name: /Activity/i }));
    expect(await screen.findByText(/LIVE AGENT ACTIVITY/i)).toBeInTheDocument();
  });
});

