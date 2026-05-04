import { type ChangeEvent, type CSSProperties, type MutableRefObject, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AppBuilderAppType,
  AppBuilderArtifactKind,
  AppBuilderComposerLane,
  AppBuilderAssistantResponse,
  AppBuilderApprovalStage,
  AppBuilderBriefDraft,
  ChatAttachment,
  ChatControlState,
  AppBuilderControlMode,
  AppBuilderConversation,
  AppBuilderMessage,
  AppBuilderMode,
  AppBuilderPhase,
  AppBuilderPreviewState,
  AppBuilderProject,
  AppBuilderProjectDetail,
  AppBuilderRun,
  AppBuilderSecurityScan,
  AppBuilderSuggestedAction,
  AppBuilderTemplate,
  AppBuilderValidationResult,
  AppSpecJson,
  AppRegistryRecord,
  ArchitecturePlan,
  FileGraph,
  HealingAttempt,
  ModelsHealthResponse,
  PreviewSession,
  TerminalCommandRecord,
  ValidationSession,
  WorkspaceFileDiff,
  WorkspaceFileNode,
  WorkspaceFileRecord,
} from '@rawclaw/shared';
import {
  FiAlertTriangle,
  FiArrowUpRight,
  FiCheckCircle,
  FiChevronRight,
  FiChevronDown,
  FiCode,
  FiEdit3,
  FiFileText,
  FiFolder,
  FiFolderPlus,
  FiPlay,
  FiPlus,
  FiRefreshCw,
  FiSend,
  FiTerminal,
  FiSmile,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import {
  acknowledgeAppBuilderInterruption,
  approveAppBuilderProject,
  fetchAppBuilderBrief,
  fetchAppBuilderConversation,
  fetchAppBuilderPreview,
  fetchAppBuilderProjectDetail,
  fetchAppBuilderProjects,
  fetchAppBuilderRuns,
  fetchAppBuilderTemplates,
  fetchAppRegistryRecords,
  fetchAppBuilderWorkspaceDiff,
  fetchAppBuilderWorkspaceFile,
  queueAppBuilderPhase,
  saveAppBuilderWorkspaceFile,
  sendAppBuilderAssistantMessage,
  deleteAppBuilderProject,
  startAppBuilderTerminalSession,
  stopAppBuilderTerminalSession,
  submitAppBuilderTerminalCommand,
  updateAppBuilderBrief,
  updateAppBuilderProject,
  createAppBuilderWorkspaceFolder,
  renameAppBuilderWorkspacePath,
  deleteAppBuilderWorkspacePath,
  formatAppBuilderWorkspaceFile,
  applyAppBuilderStagedGeneration,
  discardAppBuilderStagedGeneration,
  resolveAppBuilderStagedConflict,
  rollbackAppBuilderStagedGeneration,
  approveAppBuilderSecurityFinding,
  createAppBuilderMultipartUpload,
  reanalyzeAppBuilderUpload,
  resetAppBuilderControlState,
  retryAppBuilderSmokeRestore,
  retryAppBuilderSuggestionVectorClear,
  type AppBuilderStagedGenerationRecord,
} from '../lib/app-builder';
import { api } from '../lib/api';
import { processFileForAttachment } from '../lib/chat-attachments';

type AppBuilderPage = 'builder' | 'live-preview' | 'projects' | 'console';
type WorkspaceTab = 'activity' | 'preview' | 'files' | 'docs' | 'terminal' | 'logs' | 'project';
type ComposerAction = AppBuilderComposerLane;
type BuilderSurfaceState = 'dashboard' | 'workspace';

const STARTER_PROMPTS = [
  'Build a customer support dashboard with ticket queues, analytics, and an approval inbox.',
  'Create an AI tool console for prompt review, eval runs, and operator approvals.',
  'Import my existing project from E:\\projects\\outside-app and make it controllable by RawClaw.',
];

const EMOJI_OPTIONS = ['🚀', '✨', '🧠', '🛠️', '📦', '✅'];

const EMPTY_PREVIEW: AppBuilderPreviewState = {
  status: 'empty',
  title: 'Preview appears after generate or import',
  summary: 'Start with a prompt and RawClaw will turn it into a controllable app project.',
  projectPath: null,
  currentTab: 'activity',
  availableTabs: ['activity', 'preview', 'files', 'docs', 'terminal', 'logs'],
  logs: [],
};

const SESSION_KEYS = {
  draftId: 'rawclaw_app_builder_draft_id',
  composer: 'rawclaw_app_builder_composer',
  workspaceTab: 'rawclaw_app_builder_workspace_tab',
  composerAction: 'rawclaw_app_builder_composer_action',
} as const;

const DEFAULT_BUILDER_CHAT_CONTROLS: ChatControlState = {
  planMode: false,
  preferredWebMode: 'auto',
  toolUseMode: 'auto',
  permissionMode: 'workspace_default',
  selectedPlugins: [],
  selectedTools: [],
};

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}`;
}

function readSessionValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(key);
}

function writeSessionValue(key: string, value: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(key, value);
}

function clearSessionValue(key: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(key);
}

interface BuilderContextLoadOptions {
  silent?: boolean;
  preserveWorkspaceTab?: boolean;
}

export default function AppBuilder() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const routePage = useMemo(() => resolveRoutePage(location.pathname), [location.pathname]);
  const selectedProjectId = searchParams.get('project');

  const [draftId, setDraftId] = useState<string>(() => readSessionValue(SESSION_KEYS.draftId) || createDraftId());
  const [templates, setTemplates] = useState<AppBuilderTemplate[]>([]);
  const [projects, setProjects] = useState<AppBuilderProject[]>([]);
  const [runs, setRuns] = useState<AppBuilderRun[]>([]);
  const [registry, setRegistry] = useState<AppRegistryRecord[]>([]);
  const [detail, setDetail] = useState<AppBuilderProjectDetail | null>(null);
  const [conversation, setConversation] = useState<AppBuilderConversation | null>(null);
  const [brief, setBrief] = useState<AppBuilderBriefDraft | null>(null);
  const [preview, setPreview] = useState<AppBuilderPreviewState>(EMPTY_PREVIEW);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(() => {
    const stored = readSessionValue(SESSION_KEYS.workspaceTab);
    return isWorkspaceTab(stored) ? stored : 'activity';
  });
  const [composer, setComposer] = useState<string>(() => readSessionValue(SESSION_KEYS.composer) || '');
  const [composerAction, setComposerAction] = useState<ComposerAction>(() => {
    const stored = readSessionValue(SESSION_KEYS.composerAction);
    return isComposerAction(stored) ? stored : 'discuss';
  });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [builderModelRoutes, setBuilderModelRoutes] = useState<ModelsHealthResponse['routing'] | null>(null);
  const [briefEditorOpen, setBriefEditorOpen] = useState(false);
  const [draftBrief, setDraftBrief] = useState<AppBuilderBriefDraft | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<AppBuilderSuggestedAction[]>([]);

  const hasProject = Boolean(selectedProjectId);
  const hasConversationStarted = Boolean(conversation?.messages.length);
  const showStarterPrompts = !hasProject && !hasConversationStarted;
  const showRetryAction = Boolean(lastFailedPrompt);

  const activeProjectRuns = useMemo(() => {
    if (!selectedProjectId) return [];
    return runs.filter((run) => run.projectId === selectedProjectId).slice(0, 10);
  }, [runs, selectedProjectId]);

  const activeRegistryRecords = useMemo(() => {
    if (!selectedProjectId) return [];
    return registry.filter((record) => record.projectId === selectedProjectId).slice(0, 6);
  }, [registry, selectedProjectId]);

  const activeTemplate = useMemo(() => {
    if (!brief?.templateId) return null;
    return templates.find((template) => template.id === brief.templateId) || null;
  }, [templates, brief?.templateId]);

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((project) => project.id === selectedProjectId) || detail?.project || null;
  }, [projects, detail?.project, selectedProjectId]);

  const workspaceActions = useMemo(() => {
    const localActions = buildLocalSuggestedActions(detail);
    return (suggestedActions.length ? suggestedActions : localActions).filter((action) =>
      action.kind === 'phase'
      || action.kind === 'approve'
      || action.kind === 'open_mode'
      || action.kind === 'refresh'
      || action.kind === 'rollback',
    );
  }, [detail, suggestedActions]);

  const latestSpec = detail ? latestArtifactPayload<AppSpecJson>(detail, 'spec') : null;
  const latestArchitecture = detail ? latestArtifactPayload<ArchitecturePlan>(detail, 'architecture') : null;
  const latestFileGraph = detail ? latestArtifactPayload<FileGraph>(detail, 'file_graph') : null;
  const latestValidationSession = detail ? latestArtifactPayload<ValidationSession>(detail, 'validation') : null;
  const latestPreviewSession = detail ? latestArtifactPayload<PreviewSession>(detail, 'preview_session') : null;
  const workspaceSummary = detail?.project
    ? `${detail.project.name} / ${humanizeControlMode(detail.project.controlMode)}`
    : brief
      ? `${humanizeAppType(brief.appType)} / ${humanizeControlMode(brief.controlMode)}`
      : 'Builder brief and project structure appear here as RawClaw shapes the app.';

  const activeModelRoutes = detail?.modelRoutes || builderModelRoutes || null;
  const builderSurfaceState = useMemo<BuilderSurfaceState>(() => {
    if (routePage !== 'builder') return 'workspace';
    return shouldRevealBuilderWorkspace(detail, preview) ? 'workspace' : 'dashboard';
  }, [detail, preview, routePage]);

  useEffect(() => {
    writeSessionValue(SESSION_KEYS.draftId, draftId);
  }, [draftId]);

  useEffect(() => {
    if (composer.trim()) {
      writeSessionValue(SESSION_KEYS.composer, composer);
      return;
    }
    clearSessionValue(SESSION_KEYS.composer);
  }, [composer]);

  useEffect(() => {
    writeSessionValue(SESSION_KEYS.workspaceTab, workspaceTab);
  }, [workspaceTab]);

  useEffect(() => {
    writeSessionValue(SESSION_KEYS.composerAction, composerAction);
  }, [composerAction]);

  const loadOverview = async () => {
    const [nextTemplates, nextProjects, nextRuns, nextRegistry, modelsHealth] = await Promise.all([
      fetchAppBuilderTemplates(),
      fetchAppBuilderProjects(),
      fetchAppBuilderRuns(),
      fetchAppRegistryRecords(),
      api.get<ModelsHealthResponse>('/models/health').catch(() => null),
    ]);
    setTemplates(nextTemplates);
    setProjects(nextProjects);
    setRuns(nextRuns);
    setRegistry(nextRegistry);
    setBuilderModelRoutes(modelsHealth?.data?.routing || null);
  };

  const loadDraftContext = async (nextDraftId: string, options: BuilderContextLoadOptions = {}) => {
    if (!options.silent) {
      setContextLoading(true);
    }
    try {
      const [nextConversation, nextBrief] = await Promise.all([
        fetchAppBuilderConversation({ draftId: nextDraftId, mode: 'chat' }),
        fetchAppBuilderBrief({ draftId: nextDraftId }),
      ]);
      setConversation(sanitizeConversation(nextConversation));
      setBrief(nextBrief);
      setPreview(EMPTY_PREVIEW);
      setWorkspaceTab('activity');
      setSuggestedActions([]);
      setDetail(null);
    } finally {
      if (!options.silent) {
        setContextLoading(false);
      }
    }
  };

  const loadProjectContext = async (
    projectId: string,
    nextPage: AppBuilderPage = routePage,
    options: BuilderContextLoadOptions = {},
  ) => {
    if (!options.silent) {
      setContextLoading(true);
    }
    try {
      const [nextDetail, nextBrief, nextPreview] = await Promise.all([
        fetchAppBuilderProjectDetail(projectId),
        fetchAppBuilderBrief({ projectId }),
        fetchAppBuilderPreview(projectId),
      ]);
      const nextConversation = await fetchAppBuilderConversation({
        projectId,
        mode: assistantModeForPage(nextPage, shouldRevealBuilderWorkspace(nextDetail, nextPreview)),
      });
      setDetail(nextDetail);
      setConversation(sanitizeConversation(nextConversation));
      setBrief(nextBrief);
      setPreview(nextPreview);
      const nextTab: WorkspaceTab = isWorkspaceTab(nextPreview.currentTab || null) && nextPreview.currentTab ? nextPreview.currentTab : 'activity';
      setWorkspaceTab((current) => (options.preserveWorkspaceTab ? current : nextTab));
      setSuggestedActions(buildLocalSuggestedActions(nextDetail));
    } finally {
      if (!options.silent) {
        setContextLoading(false);
      }
    }
  };

  const refreshAll = async (
    projectId?: string | null,
    nextPage: AppBuilderPage = routePage,
    options: BuilderContextLoadOptions = {},
  ) => {
    await loadOverview();
    if (projectId) {
      await loadProjectContext(projectId, nextPage, options);
      return;
    }
    await loadDraftContext(draftId, options);
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      void loadProjectContext(selectedProjectId, routePage);
      return;
    }
    void loadDraftContext(draftId);
  }, [selectedProjectId, draftId, routePage]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void loadProjectContext(selectedProjectId, routePage, { silent: true, preserveWorkspaceTab: true });
      void loadOverview();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [selectedProjectId, routePage]);

  const buildHref = (page: AppBuilderPage, projectId?: string | null) => {
    const pathname =
      page === 'builder'
        ? '/app-builder'
        : page === 'live-preview'
          ? '/app-builder/live-preview'
          : page === 'projects'
            ? '/app-builder/projects'
            : '/app-builder/console';
    const nextParams = new URLSearchParams();
    if (projectId) {
      nextParams.set('project', projectId);
    }
    const search = nextParams.toString();
    return `${pathname}${search ? `?${search}` : ''}`;
  };

  const navigateToPage = (page: AppBuilderPage, projectId?: string | null) => {
    navigate(buildHref(page, projectId));
  };

  const handleSelectProject = (projectId: string, nextPage: AppBuilderPage = 'builder') => {
    setLastFailedPrompt(null);
    navigateToPage(nextPage, projectId);
  };

  const handleNewBuilder = () => {
    setDetail(null);
    setConversation(null);
    setBrief(null);
    setPreview(EMPTY_PREVIEW);
    setWorkspaceTab('activity');
    setComposer('');
    setComposerAction('discuss');
    setShowEmojiPicker(false);
    setAttachments([]);
    setAttachmentError(null);
    setLastFailedPrompt(null);
    setSuggestedActions([]);
    setDraftId(createDraftId());
    navigateToPage('builder', null);
  };

  const handleRefresh = async () => {
    if (busyAction) return;
    setBusyAction('refresh');
    try {
      await refreshAll(selectedProjectId, routePage);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSoftRefresh = async () => {
    await refreshAll(selectedProjectId, routePage, { silent: true, preserveWorkspaceTab: true });
  };

  const handleDeleteProject = async (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId) || (detail?.project?.id === projectId ? detail.project : null);
    const projectName = project?.name || 'this project';
    if (!window.confirm(`Delete ${projectName}? This removes the Builder project, docs, runs, and managed files from RawClaw.`)) {
      return;
    }
    setDeletingProjectId(projectId);
    try {
      await deleteAppBuilderProject(projectId);
      if (selectedProjectId === projectId) {
        handleNewBuilder();
      }
      await loadOverview();
    } catch (error) {
      console.error('Failed to delete App Builder project:', error);
      window.alert('Failed to delete the App Builder project. Please try again.');
    } finally {
      setDeletingProjectId(null);
    }
  };

  const openBriefEditor = () => {
    if (!brief) return;
    setDraftBrief({ ...brief });
    setBriefEditorOpen(true);
  };

  const closeBriefEditor = () => {
    setBriefEditorOpen(false);
    setDraftBrief(null);
  };

  const appendEmoji = (emoji: string) => {
    setComposer((current) => `${current}${emoji}`);
    setShowEmojiPicker(false);
  };

  const handleAttachmentSelection = async (fileList: FileList | null) => {
    setAttachmentError(null);
    if (!fileList) return;
    const files = Array.from(fileList);
    for (const file of files) {
      const result = await processFileForAttachment(file);
      if (result.error) {
        setAttachmentError(result.error);
      } else if (result.attachment) {
        setAttachments((current) => [...current, result.attachment!]);
      }
    }
  };

  const builderChatControls = useMemo<ChatControlState>(() => ({
    ...DEFAULT_BUILDER_CHAT_CONTROLS,
    planMode: composerAction === 'plan',
  }), [composerAction]);

  const handleAssistantResponse = async (response: AppBuilderAssistantResponse) => {
    setConversation(sanitizeConversation(response.conversation));
    setBrief(response.brief);
    setPreview(response.preview);
    const responseTab: WorkspaceTab = isWorkspaceTab(response.preview.currentTab || null) && response.preview.currentTab ? response.preview.currentTab : 'activity';
    setWorkspaceTab(responseTab);
    setSuggestedActions(response.suggestedActions);
    setLastFailedPrompt(null);
    setAttachments([]);
    setAttachmentError(null);
    if (response.projectId) {
      setDetail(response.detail || null);
      navigateToPage('builder', response.projectId);
      await loadOverview();
    }
  };

  const handleSendPrompt = async (promptOverride?: string) => {
    const prompt = (promptOverride || composer).trim();
    if (!prompt || busyAction || !brief) return;
    const currentAttachments = [...attachments];
    setBusyAction('chat');
    setShowEmojiPicker(false);
    if (!promptOverride) {
      setComposer('');
    }
    try {
      const response = await sendAppBuilderAssistantMessage({
        message: prompt,
        draftId,
        projectId: selectedProjectId,
        mode: assistantModeForPage(routePage, builderSurfaceState === 'workspace'),
        lane: composerAction,
        attachments: currentAttachments.length ? currentAttachments : undefined,
        chatControls: builderChatControls,
        brief: {
          workspaceId: brief.workspaceId,
          sourceType: brief.sourceType,
          appType: brief.appType,
          controlMode: brief.controlMode,
          templateId: brief.templateId,
          titleOverride: brief.titleOverride,
          sourcePath: brief.sourcePath,
          prompt: brief.prompt,
        },
      });
      await handleAssistantResponse(response);
    } catch (error: any) {
      const assistantError = makeErrorMessage(error);
      setConversation((current) => {
        const nextMessages = [
          ...(current?.messages || []),
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content: prompt,
            createdAt: new Date().toISOString(),
            meta: 'prompt',
            attachments: currentAttachments.length ? currentAttachments : undefined,
          } satisfies AppBuilderMessage,
          assistantError,
        ];
        return sanitizeConversation({
          id: current?.id || `draft:${draftId}`,
          scopeType: current?.scopeType || 'draft',
          scopeId: current?.scopeId || draftId,
          projectId: current?.projectId || null,
          draftId: current?.draftId || draftId,
          title: current?.title || 'New Builder',
          mode: current?.mode || 'chat',
          messages: nextMessages,
          updatedAt: new Date().toISOString(),
        });
      });
      setLastFailedPrompt(prompt);
    } finally {
      setBusyAction(null);
    }
  };

  const handleComposerSubmit = async () => {
    await handleSendPrompt();
  };

  const composerActionDisabled = useMemo(() => {
    return Boolean(busyAction || !brief || !composer.trim());
  }, [brief, busyAction, composer]);

  const composerPrimaryLabel = composerActionLabel(composerAction);

  const handleSuggestedAction = async (action: AppBuilderSuggestedAction) => {
    if (busyAction) return;
    if (action.id === 'acknowledge_interruption' && selectedProjectId) {
      setBusyAction('acknowledge_interruption');
      try {
        const nextDetail = await acknowledgeAppBuilderInterruption(selectedProjectId, {
          reviewer: 'builder-workspace',
          notes: 'Acknowledged from the Builder surface.',
        });
        setDetail(nextDetail);
        await refreshAll(selectedProjectId, routePage);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action.id === 'retry_smoke_restore' && selectedProjectId) {
      setBusyAction('retry_smoke_restore');
      try {
        const nextDetail = await retryAppBuilderSmokeRestore(selectedProjectId);
        setDetail(nextDetail);
        await refreshAll(selectedProjectId, routePage);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action.id === 'reset_control_state' && selectedProjectId) {
      const confirmed = window.confirm('Reset control state to an empty default state? This clears the app control event backlog.');
      if (!confirmed) return;
      setBusyAction('reset_control_state');
      try {
        const nextDetail = await resetAppBuilderControlState(selectedProjectId, {
          confirm: true,
          reason: 'Reset confirmed from the Builder workspace after smoke restore failed.',
        });
        setDetail(nextDetail);
        await refreshAll(selectedProjectId, routePage);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action.id === 'retry_suggestion_vector_clear' && selectedProjectId) {
      setBusyAction('retry_suggestion_vector_clear');
      try {
        const nextDetail = await retryAppBuilderSuggestionVectorClear(selectedProjectId);
        setDetail(nextDetail);
        await refreshAll(selectedProjectId, routePage);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action.kind === 'refresh') {
      await handleRefresh();
      return;
    }
    if (action.kind === 'open_mode') {
      navigateToPage(action.mode === 'console' ? 'console' : 'builder', selectedProjectId);
      return;
    }
    if (!selectedProjectId) {
      if (action.kind === 'phase') {
        await handleSendPrompt(promptForPhase(action.phase));
      }
      return;
    }
    if (!detail) return;
    if (action.kind === 'approve') {
      setBusyAction('approve');
      try {
        const nextDetail = await approveAppBuilderProject(selectedProjectId, {
          reviewer: 'builder-workspace',
          notes: 'Approved from the Lovable-style Builder surface.',
          controlMode: detail.project.controlMode,
        });
        setDetail(nextDetail);
        await refreshAll(selectedProjectId, routePage);
      } finally {
        setBusyAction(null);
      }
      return;
    }

    if ((action.kind === 'phase' || action.kind === 'rollback') && action.phase) {
      setBusyAction(`phase:${action.phase}`);
      try {
        await queueAppBuilderPhase(selectedProjectId, action.phase);
        await refreshAll(selectedProjectId, routePage);
      } finally {
        setBusyAction(null);
      }
    }
  };

  const handleSaveBrief = async () => {
    if (!draftBrief || !brief) return;
    setBusyAction('brief');
    try {
      const persistedBrief = await updateAppBuilderBrief(
        selectedProjectId ? { projectId: selectedProjectId } : { draftId },
        {
          workspaceId: draftBrief.workspaceId,
          sourceType: draftBrief.sourceType,
          appType: draftBrief.appType,
          controlMode: draftBrief.controlMode,
          templateId: draftBrief.templateId || null,
          titleOverride: draftBrief.titleOverride || null,
          sourcePath: draftBrief.sourcePath || null,
          prompt: draftBrief.prompt || null,
        },
      );
      setBrief(persistedBrief);

      if (selectedProjectId && detail) {
        const updated = await updateAppBuilderProject(selectedProjectId, {
          name: draftBrief.titleOverride?.trim() || detail.project.name,
          appType: draftBrief.appType,
          templateId:
            draftBrief.sourceType === 'generated'
              ? draftBrief.templateId || detail.project.templateId
              : detail.project.templateId,
          controlMode: draftBrief.controlMode,
          sourcePath:
            draftBrief.sourceType === 'imported'
              ? draftBrief.sourcePath || detail.project.sourcePath
              : detail.project.sourcePath,
        });
        setDetail(updated);
        await loadOverview();
      }

      closeBriefEditor();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="app-builder-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        flex: 1,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        overflow: routePage === 'builder' ? 'hidden' : 'auto',
      }}
    >
      {routePage !== 'builder' ? (
        <AppBuilderSectionHeader
          routePage={routePage}
          selectedProject={selectedProject}
          onNewBuilder={handleNewBuilder}
          onOpenBuilder={() => navigateToPage('builder', selectedProjectId)}
        />
      ) : null}

      {routePage === 'builder' ? (
        builderSurfaceState === 'workspace' ? (
          <BuilderWorkspace
            hasProject={hasProject}
            contextLoading={contextLoading}
            detail={detail}
            brief={brief}
            conversation={conversation}
            preview={preview}
            workspaceTab={workspaceTab}
            setWorkspaceTab={setWorkspaceTab}
            workspaceSummary={workspaceSummary}
            activeTemplate={activeTemplate}
            activeModelRoutes={activeModelRoutes}
            composer={composer}
            setComposer={setComposer}
            composerAction={composerAction}
            setComposerAction={setComposerAction}
            primaryLabel={composerPrimaryLabel}
            submitDisabled={composerActionDisabled}
            attachments={attachments}
            attachmentError={attachmentError}
            fileInputRef={fileInputRef}
            onAttachmentSelection={handleAttachmentSelection}
            showEmojiPicker={showEmojiPicker}
            onToggleEmoji={() => setShowEmojiPicker((current) => !current)}
            appendEmoji={appendEmoji}
            onSend={() => void handleComposerSubmit()}
            onRefresh={handleRefresh}
            onSoftRefresh={handleSoftRefresh}
            busyAction={busyAction}
            suggestedActions={workspaceActions}
            onAction={(action) => void handleSuggestedAction(action)}
            showStarterPrompts={showStarterPrompts}
            onStarterPrompt={(prompt) => setComposer(prompt)}
            showRetryAction={showRetryAction}
            onRetry={() => void handleSendPrompt(lastFailedPrompt || undefined)}
            onOpenBriefEditor={openBriefEditor}
            onOpenLivePreview={() => navigateToPage('live-preview', selectedProjectId)}
            latestSpec={latestSpec}
            latestArchitecture={latestArchitecture}
            latestFileGraph={latestFileGraph}
            latestValidationSession={latestValidationSession}
            healingAttempts={detail ? listArtifactPayloads<HealingAttempt>(detail, 'heal_attempt') : []}
            latestPreviewSession={latestPreviewSession}
            activeProjectRuns={activeProjectRuns}
            projectList={projects}
            onResumeProject={(projectId) => handleSelectProject(projectId, 'builder')}
            onDeleteProject={handleDeleteProject}
            deletingProjectId={deletingProjectId}
          />
        ) : (
          <BuilderDashboard
            contextLoading={contextLoading}
            brief={brief}
            conversation={conversation}
            composer={composer}
            setComposer={setComposer}
            composerAction={composerAction}
            setComposerAction={setComposerAction}
            primaryLabel={composerPrimaryLabel}
            submitDisabled={composerActionDisabled}
            attachments={attachments}
            attachmentError={attachmentError}
            fileInputRef={fileInputRef}
            onAttachmentSelection={handleAttachmentSelection}
            showEmojiPicker={showEmojiPicker}
            onToggleEmoji={() => setShowEmojiPicker((current) => !current)}
            appendEmoji={appendEmoji}
            onSend={() => void handleComposerSubmit()}
            onRefresh={handleRefresh}
            busyAction={busyAction}
            suggestedActions={workspaceActions}
            onAction={(action) => void handleSuggestedAction(action)}
            showStarterPrompts={showStarterPrompts}
            onStarterPrompt={(prompt) => setComposer(prompt)}
            showRetryAction={showRetryAction}
            onRetry={() => void handleSendPrompt(lastFailedPrompt || undefined)}
            onOpenBriefEditor={openBriefEditor}
            onNewBuilder={handleNewBuilder}
            projects={projects}
            selectedProject={selectedProject}
            runs={runs}
            onResumeProject={(projectId) => handleSelectProject(projectId, 'builder')}
            onDeleteProject={handleDeleteProject}
            deletingProjectId={deletingProjectId}
            onBrowseProjects={() => navigateToPage('projects', selectedProjectId)}
          />
        )
      ) : routePage === 'live-preview' ? (
        <LivePreviewPage
          selectedProject={selectedProject}
          detail={detail}
          preview={preview}
          busyAction={busyAction}
          contextLoading={contextLoading}
          onRefresh={() => void handleRefresh()}
          onOpenBuilder={() => navigateToPage('builder', selectedProjectId)}
        />
      ) : routePage === 'projects' ? (
        <ProjectsPage
          projects={projects}
          selectedProjectId={selectedProjectId}
          contextLoading={contextLoading}
          onOpenBuilder={(projectId) => handleSelectProject(projectId, 'builder')}
          onOpenPreview={(projectId) => handleSelectProject(projectId, 'live-preview')}
          onOpenConsole={(projectId) => handleSelectProject(projectId, 'console')}
          onDeleteProject={handleDeleteProject}
          deletingProjectId={deletingProjectId}
        />
      ) : (
        <ConsolePage
          selectedProject={selectedProject}
          detail={detail}
          preview={preview}
          registryRecords={activeRegistryRecords}
          runs={activeProjectRuns}
          actions={workspaceActions}
          onAction={(action) => void handleSuggestedAction(action)}
          busyAction={busyAction}
          onOpenBuilder={() => navigateToPage('builder', selectedProjectId)}
        />
      )}

      {briefEditorOpen && draftBrief ? (
        <div style={drawerOverlayStyle}>
          <div style={drawerStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
              <div>
                <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.16em' }}>
                  BUILDER BRIEF
                </div>
                <h2 style={{ fontSize: '1.25rem', margin: '0.3rem 0 0' }}>Edit builder context</h2>
              </div>
              <button className="btn-ghost" onClick={closeBriefEditor} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <FiX />
                Close
              </button>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <Field label="Workspace">
                  <input
                    value={draftBrief.workspaceId}
                    onChange={(event) => setDraftBrief((current) => current ? { ...current, workspaceId: event.target.value } : current)}
                    style={fieldStyle}
                  />
                </Field>

                <Field label="Title override">
                  <input
                    value={draftBrief.titleOverride || ''}
                    onChange={(event) => setDraftBrief((current) => current ? { ...current, titleOverride: event.target.value } : current)}
                    style={fieldStyle}
                    placeholder="Infer from conversation"
                  />
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <Field label="Source">
                  <select
                    value={draftBrief.sourceType}
                    onChange={(event) => setDraftBrief((current) => current ? { ...current, sourceType: event.target.value as AppBuilderBriefDraft['sourceType'] } : current)}
                    style={fieldStyle}
                  >
                    <option value="generated">Generated App</option>
                    <option value="imported">Imported Project</option>
                  </select>
                </Field>

                <Field label="App type">
                  <select
                    value={draftBrief.appType}
                    onChange={(event) => setDraftBrief((current) => current ? { ...current, appType: event.target.value as AppBuilderAppType } : current)}
                    style={fieldStyle}
                  >
                    <option value="web_app">Web App</option>
                    <option value="ai_tool">AI Tool</option>
                  </select>
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <Field label="Control mode">
                  <select
                    value={draftBrief.controlMode}
                    onChange={(event) => setDraftBrief((current) => current ? { ...current, controlMode: event.target.value as AppBuilderControlMode } : current)}
                    style={fieldStyle}
                  >
                    <option value="observe_only">Observe Only</option>
                    <option value="assist_only">Assist Only</option>
                    <option value="action_limited">Action Limited</option>
                    <option value="full_control">Full Control</option>
                  </select>
                </Field>

                <Field label="Template">
                  <select
                    value={draftBrief.templateId || ''}
                    onChange={(event) => setDraftBrief((current) => current ? { ...current, templateId: event.target.value || null } : current)}
                    style={fieldStyle}
                    disabled={draftBrief.sourceType === 'imported'}
                  >
                    {templates
                      .filter((template) => draftBrief.sourceType === 'imported' || template.appType === draftBrief.appType)
                      .map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>

              {draftBrief.sourceType === 'imported' ? (
                <Field label="Imported source path">
                  <input
                    value={draftBrief.sourcePath || ''}
                    onChange={(event) => setDraftBrief((current) => current ? { ...current, sourcePath: event.target.value } : current)}
                    style={fieldStyle}
                    placeholder="E:\\projects\\outside-app"
                  />
                </Field>
              ) : null}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.55rem', marginTop: '1rem' }}>
              <button className="btn-ghost" onClick={closeBriefEditor}>Cancel</button>
              <button className="btn-primary" onClick={() => void handleSaveBrief()} disabled={busyAction === 'brief'}>
                {busyAction === 'brief' ? 'Saving...' : 'Save brief'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AppBuilderSectionHeader({
  routePage,
  selectedProject,
  onNewBuilder,
  onOpenBuilder,
}: {
  routePage: AppBuilderPage;
  selectedProject: AppBuilderProject | null;
  onNewBuilder: () => void;
  onOpenBuilder: () => void;
}) {
  const meta = routePageMeta(routePage);
  return (
    <section
      className="glass-card"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '1rem',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        padding: '0.8rem 1rem',
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
      }}
    >
      <div style={{ display: 'grid', gap: '0.25rem', maxWidth: '760px' }}>
        <div className="mono" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          APP BUILDER / {meta.eyebrow}
        </div>
        <h1 style={{ fontSize: '0.95rem', fontWeight: 500, margin: 0 }}>{meta.title}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, fontSize: '0.78rem' }}>
          {selectedProject ? `Current project: ${selectedProject.name}. ${meta.description}` : meta.description}
        </p>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        {routePage !== 'builder' ? (
          <button className="btn-ghost" onClick={onOpenBuilder}>
            Open Builder
          </button>
        ) : null}
        <button className="btn-primary" onClick={onNewBuilder}>
          New Builder
        </button>
      </div>
    </section>
  );
}

function BuilderDashboard({
  contextLoading,
  brief,
  conversation,
  composer,
  setComposer,
  composerAction,
  setComposerAction,
  primaryLabel,
  submitDisabled,
  attachments,
  attachmentError,
  fileInputRef,
  onAttachmentSelection,
  showEmojiPicker,
  onToggleEmoji,
  appendEmoji,
  onSend,
  onRefresh,
  busyAction,
  suggestedActions,
  onAction,
  showStarterPrompts,
  onStarterPrompt,
  showRetryAction,
  onRetry,
  onOpenBriefEditor,
  onNewBuilder,
  projects,
  selectedProject,
  runs,
  onResumeProject,
  onDeleteProject,
  deletingProjectId,
  onBrowseProjects,
}: {
  contextLoading: boolean;
  brief: AppBuilderBriefDraft | null;
  conversation: AppBuilderConversation | null;
  composer: string;
  setComposer: (value: string) => void;
  composerAction: ComposerAction;
  setComposerAction: (value: ComposerAction) => void;
  primaryLabel: string;
  submitDisabled: boolean;
  attachments: ChatAttachment[];
  attachmentError: string | null;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onAttachmentSelection: (fileList: FileList | null) => Promise<void>;
  showEmojiPicker: boolean;
  onToggleEmoji: () => void;
  appendEmoji: (emoji: string) => void;
  onSend: () => void;
  onRefresh: () => Promise<void>;
  busyAction: string | null;
  suggestedActions: AppBuilderSuggestedAction[];
  onAction: (action: AppBuilderSuggestedAction) => void;
  showStarterPrompts: boolean;
  onStarterPrompt: (prompt: string) => void;
  showRetryAction: boolean;
  onRetry: () => void;
  onOpenBriefEditor: () => void;
  onNewBuilder: () => void;
  projects: AppBuilderProject[];
  selectedProject: AppBuilderProject | null;
  runs: AppBuilderRun[];
  onResumeProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  deletingProjectId: string | null;
  onBrowseProjects: () => void;
}) {
  const dashboardChatRef = useRef<HTMLDivElement | null>(null);
  const quickActions = suggestedActions.filter((action) => action.kind === 'phase' || action.kind === 'refresh').slice(0, 3);
  const activeRunsCount = runs.filter((run) => !['completed', 'failed', 'failed_fixable', 'cancelled'].includes(run.status)).length;
  const attentionProjects = projects.filter((project) => project.status.includes('failed')).length;
  const readyProjects = projects.filter((project) => ['deployment_ready', 'registered'].includes(project.status)).length;

  useEffect(() => {
    if (!dashboardChatRef.current) return;
    dashboardChatRef.current.scrollTop = dashboardChatRef.current.scrollHeight;
  }, [conversation?.messages.length]);

  return (
    <section style={dashboardShellStyle}>
      <div style={dashboardSummaryGridStyle}>
        <DashboardStatCard label="Projects" value={String(projects.length)} meta="saved builders" />
        <DashboardStatCard label="Active runs" value={String(activeRunsCount)} meta="currently moving" />
        <DashboardStatCard label="Attention" value={String(attentionProjects)} meta="needs review" />
        <DashboardStatCard label="Ready" value={String(readyProjects)} meta="deployment ready" />
      </div>

      <div style={dashboardBodyStyle}>
        <section className="glass-card" style={dashboardChatCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gap: '0.18rem' }}>
              <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {selectedProject ? 'PROJECT CHAT' : 'BRIEFING'}
              </div>
              <strong style={{ fontSize: '1rem', lineHeight: 1.2, fontWeight: 600 }}>
                {selectedProject?.name || brief?.titleOverride || 'Describe the app you want'}
              </strong>
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {selectedProject ? <StatusPill label={humanizeStatus(selectedProject.status)} tone="info" /> : null}
              <button className="btn-ghost" onClick={onOpenBriefEditor} style={topBarActionStyle}>
                <FiEdit3 />
                Brief
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
            {quickActions.map((action) => (
              <button
                key={action.id}
                className={action.emphasis === 'primary' ? 'btn-primary' : 'btn-ghost'}
                onClick={() => onAction(action)}
                disabled={Boolean(action.disabled) || Boolean(busyAction)}
                style={compactActionButtonStyle}
              >
                {action.label}
              </button>
            ))}
            <button className="btn-ghost" onClick={onRefresh} disabled={Boolean(busyAction)} style={compactActionButtonStyle}>
              Refresh
            </button>
            <button className="btn-ghost" onClick={onNewBuilder} disabled={Boolean(busyAction)} style={compactActionButtonStyle}>
              New project
            </button>
          </div>

          <div ref={dashboardChatRef} style={dashboardConversationStyle}>
            {contextLoading ? (
              <EmptyState message="Loading builder chat..." />
            ) : conversation?.messages.length ? (
              conversation.messages.map((message) => <MessageBubble key={message.id} message={message} />)
            ) : (
              <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
                <EmptyState message="Start with a natural app brief. RawClaw stays in chat until you explicitly start plan or build work." />
                {showStarterPrompts ? (
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    {STARTER_PROMPTS.map((prompt) => (
                      <button key={prompt} className="btn-ghost" onClick={() => onStarterPrompt(prompt)} style={{ textAlign: 'left', justifyContent: 'flex-start', lineHeight: 1.5 }}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {showRetryAction ? (
            <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
              <button className="btn-ghost" onClick={onRetry} disabled={Boolean(busyAction)} style={compactActionButtonStyle}>
                Retry last request
              </button>
            </div>
          ) : null}

          <div style={activeComposerShellStyle}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={async (event) => {
                await onAttachmentSelection(event.target.files);
                event.target.value = '';
              }}
            />
            {attachments.length ? (
              <div style={attachmentTrayStyle}>
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.filename}-${index}`} style={attachmentChipStyle}>
                    <FiFileText size={13} />
                    <span>{attachment.filename}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder="Refine the brief, ask for research, or tell RawClaw to create a plan or start building."
              style={activeComposerInputStyle}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Chat stays primary until actual work starts. Planning or building will open the workspace automatically.
                </div>
                {attachmentError ? <div style={{ color: 'var(--error)', fontSize: '0.82rem' }}>{attachmentError}</div> : null}
                {showEmojiPicker ? (
                  <div style={emojiPickerStyle}>
                    {EMOJI_OPTIONS.map((emoji) => (
                      <button key={emoji} onClick={() => appendEmoji(emoji)} style={emojiButtonStyle}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn-ghost" onClick={() => fileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FiPlus />
                </button>
                <ComposerModeButtons value={composerAction} onChange={setComposerAction} />
                <button className="btn-ghost" onClick={onToggleEmoji} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FiSmile />
                  Emoji
                </button>
                <button
                  className="btn-primary"
                  onClick={onSend}
                  disabled={submitDisabled}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
                >
                  <FiSend />
                  {busyAction ? 'Working...' : primaryLabel}
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside style={dashboardSideRailStyle}>
          <section className="glass-card" style={dashboardRailCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.7rem' }}>
              <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Continue a project
              </div>
              <button className="btn-ghost" onClick={onBrowseProjects} style={compactActionButtonStyle}>
                Browse all
              </button>
            </div>
            {projects.length ? (
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {projects.slice(0, 6).map((project) => (
                  <section key={project.id} style={projectCardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 700 }}>{project.name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          {humanizeAppType(project.appType)} / {humanizeControlMode(project.controlMode)}
                        </div>
                      </div>
                      <StatusPill label={humanizeStatus(project.status)} tone={project.status.includes('failed') ? 'warning' : project.status === 'deployment_ready' || project.status === 'registered' ? 'good' : 'default'} />
                    </div>
                    <div style={{ display: 'flex', gap: '0.55rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                      <button className="btn-ghost" onClick={() => onResumeProject(project.id)} style={compactActionButtonStyle}>
                        Open
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => onDeleteProject(project.id)}
                        disabled={deletingProjectId === project.id}
                        style={destructiveActionButtonStyle}
                      >
                        {deletingProjectId === project.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <EmptyState message="Saved builder projects will appear here once you create them." />
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

export function BuilderHero({
  composer,
  setComposer,
  composerAction,
  setComposerAction,
  primaryLabel,
  submitDisabled,
  onSend,
  onStarterPrompt,
  onNewBuilder,
  projects,
  templates,
  brief,
  activeTemplate,
  activeModelRoutes,
  busyAction,
  attachments,
  attachmentError,
  fileInputRef,
  onAttachmentSelection,
  showEmojiPicker,
  onToggleEmoji,
  appendEmoji,
  onOpenBriefEditor,
  onResumeProject,
  onDeleteProject,
  deletingProjectId,
}: {
  composer: string;
  setComposer: (value: string) => void;
  composerAction: ComposerAction;
  setComposerAction: (value: ComposerAction) => void;
  primaryLabel: string;
  submitDisabled: boolean;
  onSend: () => void;
  onStarterPrompt: (prompt: string) => void;
  onNewBuilder: () => void;
  projects: AppBuilderProject[];
  templates: AppBuilderTemplate[];
  brief: AppBuilderBriefDraft | null;
  activeTemplate: AppBuilderTemplate | null;
  activeModelRoutes: ModelsHealthResponse['routing'] | AppBuilderProjectDetail['modelRoutes'] | null;
  busyAction: string | null;
  attachments: ChatAttachment[];
  attachmentError: string | null;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onAttachmentSelection: (fileList: FileList | null) => Promise<void>;
  showEmojiPicker: boolean;
  onToggleEmoji: () => void;
  appendEmoji: (emoji: string) => void;
  onOpenBriefEditor: () => void;
  onResumeProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  deletingProjectId: string | null;
}) {
  return (
    <section style={heroShellStyle}>
      <div style={heroGlowTopStyle} />
      <div style={heroGlowBottomStyle} />
      <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={heroBadgeStyle}>RAWCLAW APP BUILDER</div>
          <button className="btn-ghost" onClick={onNewBuilder}>
            New Builder
          </button>
        </div>

        <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: '1rem', paddingTop: '3rem', paddingBottom: projects.length ? '2.25rem' : '4.5rem' }}>
          <div style={{ display: 'grid', gap: '0.55rem', maxWidth: '860px' }}>
            <h1 style={{ fontSize: '3.1rem', margin: 0, lineHeight: 1.02 }}>What will RawClaw build with you?</h1>
            <p style={{ color: 'rgba(232,241,250,0.78)', margin: 0, fontSize: '1.03rem', lineHeight: 1.7 }}>
              Start in chat, shape the brief together, and let the workspace come alive once RawClaw begins planning and building.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <BriefChip label="Source" value={humanizeSourceType(brief?.sourceType)} onClick={onOpenBriefEditor} />
            <BriefChip label="App Type" value={humanizeAppType(brief?.appType)} onClick={onOpenBriefEditor} />
            <BriefChip label="Control" value={humanizeControlMode(brief?.controlMode)} onClick={onOpenBriefEditor} />
            <BriefChip label="Template" value={activeTemplate?.name || inferTemplateName(templates, brief?.templateId)} onClick={onOpenBriefEditor} />
            <RouteChip label="Chat" value={resolveBuilderRouteValue(activeModelRoutes, 'chat')} />
            <RouteChip label="Planner" value={resolveBuilderRouteValue(activeModelRoutes, 'planner')} />
            <RouteChip label="Build" value={resolveBuilderRouteValue(activeModelRoutes, 'build')} />
          </div>

          <div style={heroComposerShellStyle}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={async (event) => {
                await onAttachmentSelection(event.target.files);
                event.target.value = '';
              }}
            />
            {attachments.length ? (
              <div style={attachmentTrayStyle}>
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.filename}-${index}`} style={attachmentChipStyle}>
                    <FiFileText size={13} />
                    <span>{attachment.filename}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder="Ask RawClaw to build an internal tool, AI console, dashboard, or controllable app..."
              style={heroComposerInputStyle}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{ color: 'rgba(226,236,246,0.64)', lineHeight: 1.5 }}>
                  Describe the app naturally. RawClaw will stay in briefing chat until you explicitly start planning or generation.
                </div>
                {attachmentError ? <div style={{ color: '#fca5a5', fontSize: '0.84rem' }}>{attachmentError}</div> : null}
                {showEmojiPicker ? (
                  <div style={emojiPickerStyle}>
                    {EMOJI_OPTIONS.map((emoji) => (
                      <button key={emoji} onClick={() => appendEmoji(emoji)} style={emojiButtonStyle}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn-ghost" onClick={() => fileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FiPlus />
                </button>
                <ComposerModeButtons value={composerAction} onChange={setComposerAction} />
                <button className="btn-ghost" onClick={onToggleEmoji} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FiSmile />
                  Emoji
                </button>
                <button
                  className="btn-primary"
                  onClick={onSend}
                  disabled={submitDisabled}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
                >
                  <FiSend />
                  {busyAction ? 'Working...' : primaryLabel}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '1080px' }}>
            {STARTER_PROMPTS.map((prompt) => (
              <button key={prompt} className="btn-ghost" onClick={() => onStarterPrompt(prompt)} style={heroPromptChipStyle}>
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {projects.length ? (
          <div style={recentRailStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.9rem' }}>
              <strong style={{ fontSize: '1rem' }}>Recent builder projects</strong>
              <Link to="/app-builder/projects" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                Browse all →
              </Link>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
              {projects.slice(0, 4).map((project) => (
                <section key={project.id} style={recentProjectCardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 700 }}>{project.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {humanizeAppType(project.appType)} / {humanizeControlMode(project.controlMode)}
                      </div>
                    </div>
                    <StatusPill label={humanizeStatus(project.status)} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.55rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                    <button className="btn-ghost" onClick={() => onResumeProject(project.id)} style={compactActionButtonStyle}>
                      Open
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => onDeleteProject(project.id)}
                      disabled={deletingProjectId === project.id}
                      style={destructiveActionButtonStyle}
                    >
                      {deletingProjectId === project.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BuilderWorkspace(props: {
  hasProject: boolean;
  contextLoading: boolean;
  detail: AppBuilderProjectDetail | null;
  brief: AppBuilderBriefDraft | null;
  conversation: AppBuilderConversation | null;
  preview: AppBuilderPreviewState;
  workspaceTab: WorkspaceTab;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  workspaceSummary: string;
  activeTemplate: AppBuilderTemplate | null;
  activeModelRoutes: ModelsHealthResponse['routing'] | AppBuilderProjectDetail['modelRoutes'] | null;
  composer: string;
  setComposer: (value: string) => void;
  composerAction: ComposerAction;
  setComposerAction: (value: ComposerAction) => void;
  primaryLabel: string;
  submitDisabled: boolean;
  attachments: ChatAttachment[];
  attachmentError: string | null;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onAttachmentSelection: (fileList: FileList | null) => Promise<void>;
  showEmojiPicker: boolean;
  onToggleEmoji: () => void;
  appendEmoji: (emoji: string) => void;
  onSend: () => void;
  onRefresh: () => Promise<void>;
  onSoftRefresh: () => Promise<void>;
  busyAction: string | null;
  suggestedActions: AppBuilderSuggestedAction[];
  onAction: (action: AppBuilderSuggestedAction) => void;
  showStarterPrompts: boolean;
  onStarterPrompt: (prompt: string) => void;
  showRetryAction: boolean;
  onRetry: () => void;
  onOpenBriefEditor: () => void;
  onOpenLivePreview: () => void;
  latestSpec: AppSpecJson | null;
  latestArchitecture: ArchitecturePlan | null;
  latestFileGraph: FileGraph | null;
  latestValidationSession: ValidationSession | null;
  healingAttempts: HealingAttempt[];
  latestPreviewSession: PreviewSession | null;
  activeProjectRuns: AppBuilderRun[];
  projectList: AppBuilderProject[];
  onResumeProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  deletingProjectId: string | null;
}) {
  const {
    hasProject,
    contextLoading,
    detail,
    brief,
    conversation,
    preview,
    workspaceTab,
    setWorkspaceTab,
    workspaceSummary,
    activeTemplate,
    activeModelRoutes,
    composer,
    setComposer,
    composerAction,
    setComposerAction,
    primaryLabel,
    submitDisabled,
    attachments,
    attachmentError,
    fileInputRef,
    onAttachmentSelection,
    showEmojiPicker,
    onToggleEmoji,
    appendEmoji,
    onSend,
    onRefresh,
    onSoftRefresh,
    busyAction,
    suggestedActions,
    onAction,
    showStarterPrompts,
    onStarterPrompt,
    showRetryAction,
    onRetry,
    onOpenBriefEditor,
    onOpenLivePreview,
    latestSpec,
    latestArchitecture,
    latestFileGraph,
    latestValidationSession,
    healingAttempts,
    latestPreviewSession,
    activeProjectRuns,
    projectList,
    onResumeProject,
    onDeleteProject,
    deletingProjectId,
  } = props;

  const selectedProject = detail?.project || null;
  const workspaceStage = selectedProject ? humanizeStatus(selectedProject.status) : 'briefing';
  const workspaceActions = suggestedActions.length ? suggestedActions : buildLocalSuggestedActions(detail);
  const logEntries = buildWorkspaceLogEntries(preview, activeProjectRuns, latestValidationSession);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [workspaceFile, setWorkspaceFile] = useState<WorkspaceFileRecord | null>(null);
  const [workspaceDiff, setWorkspaceDiff] = useState<WorkspaceFileDiff | null>(null);
  const [fileDraft, setFileDraft] = useState('');
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [stagingBusy, setStagingBusy] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState('npm run dev');
  const [runInBackground, setRunInBackground] = useState(true);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [selectedTerminalCommandId, setSelectedTerminalCommandId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1600));

  const fileTree = detail?.fileTree || null;
  const docs = detail?.docs || [];
  const taskList = detail?.taskList || null;
  const terminalSession = detail?.terminal || null;
  const previewConnection = detail?.previewConnection || preview.connection || null;
  const memorySnapshot = detail?.memory || null;
  const activity = detail?.activity || [];
  const stagedGenerations = useMemo(
    () => (detail?.artifacts || [])
      .filter((artifact) => artifact.kind === 'staged_generation')
      .map((artifact) => artifact.payload as unknown as AppBuilderStagedGenerationRecord)
      .filter((staged) => staged?.id)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [detail?.artifacts],
  );
  const activeStagedGenerations = stagedGenerations.filter((staged) => ['open', 'partially_applied', 'conflict'].includes(staged.status));
  const securityScans = useMemo(
    () => (detail?.artifacts || [])
      .filter((artifact) => artifact.kind === 'security_scan')
      .map((artifact) => artifact.payload as unknown as AppBuilderSecurityScan),
    [detail?.artifacts],
  );
  const securityApprovals = useMemo(
    () => (detail?.artifacts || [])
      .filter((artifact) => artifact.kind === 'security_approval')
      .map((artifact) => artifact.payload as Record<string, unknown>),
    [detail?.artifacts],
  );
  const approvedSecurityKeys = useMemo(
    () => new Set(
      securityApprovals
        .filter((approval) => approval.decision === 'approved')
        .map((approval) => `${String(approval.stagingId)}:${String(approval.filePath)}:${String(approval.fileHash)}:${String(approval.patternId)}`),
    ),
    [securityApprovals],
  );
  const uploadRecords = useMemo(
    () => (detail?.artifacts || [])
      .filter((artifact) => artifact.kind === 'upload_record')
      .map((artifact) => artifact.payload as Record<string, unknown>)
      .filter((upload) => upload.id && upload.status !== 'deleted')
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))),
    [detail?.artifacts],
  );
  const referenceArtifacts = useMemo(
    () => (detail?.artifacts || [])
      .filter((artifact) => ['reference_image', 'reference_document', 'reference_code'].includes(artifact.kind))
      .map((artifact) => artifact.payload as Record<string, unknown>)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [detail?.artifacts],
  );
  const projectSuggestions = useMemo(
    () => (detail?.artifacts || [])
      .filter((artifact) => artifact.kind === 'project_suggestion')
      .map((artifact) => artifact.payload as Record<string, unknown>)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [detail?.artifacts],
  );
  const effectiveWorkspaceTab: WorkspaceTab = workspaceTab === 'project' ? 'activity' : workspaceTab;
  const workspaceTabs: Array<{ id: Exclude<WorkspaceTab, 'project'>; label: string; icon?: ReactNode }> = [
    { id: 'activity', label: 'Activity' },
    { id: 'preview', label: 'Preview' },
    { id: 'files', label: 'Files', icon: <FiCode size={14} /> },
    { id: 'docs', label: 'Docs', icon: <FiFileText size={14} /> },
    { id: 'terminal', label: 'Terminal', icon: <FiTerminal size={14} /> },
    { id: 'logs', label: 'Logs' },
  ];
  const terminalCommands = terminalSession?.commands || [];
  const selectedTerminalCommand =
    terminalCommands.find((command) => command.id === selectedTerminalCommandId)
    || terminalCommands.find((command) => command.id === terminalSession?.activeCommandId)
    || terminalCommands[0]
    || null;
  const activeTerminalCommand =
    terminalCommands.find((command) => command.id === terminalSession?.activeCommandId)
    || selectedTerminalCommand
    || null;
  const detectedTerminalPreviewUrl =
    detectPreviewUrlFromTerminalOutput(activeTerminalCommand?.output)
    || activeTerminalCommand?.previewUrl
    || terminalSession?.previewUrl
    || previewConnection?.url
    || null;
  const detectedTerminalPreviewPort =
    extractPortFromUrl(detectedTerminalPreviewUrl)
    || (terminalSession?.previewPort ? String(terminalSession.previewPort) : null);
  const effectivePreviewUrl = preview.url || detectedTerminalPreviewUrl || null;
  const terminalHistory = selectedTerminalCommand
    ? terminalCommands.filter((command) => command.id !== selectedTerminalCommand.id)
    : terminalCommands;
  const stoppableTerminalCommand =
    (selectedTerminalCommand?.status === 'running' ? selectedTerminalCommand : null)
    || (activeTerminalCommand?.status === 'running' ? activeTerminalCommand : null)
    || terminalCommands.find((command) => command.status === 'running')
    || null;
  const stackTerminalPanels = viewportWidth < 1500;

  useEffect(() => {
    if (!chatViewportRef.current) return;
    chatViewportRef.current.scrollTop = chatViewportRef.current.scrollHeight;
  }, [conversation?.messages.length]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!terminalCommands.length) {
      setSelectedTerminalCommandId(null);
      return;
    }
    if (selectedTerminalCommandId && terminalCommands.some((command) => command.id === selectedTerminalCommandId)) {
      return;
    }
    setSelectedTerminalCommandId(terminalSession?.activeCommandId || terminalCommands[0]?.id || null);
  }, [terminalCommands, terminalSession?.activeCommandId, selectedTerminalCommandId]);

  useEffect(() => {
    if (selectedFilePath || !fileTree) return;
    const preferredDoc = docs[0]?.path || null;
    setSelectedFilePath(preferredDoc || firstFilePath(fileTree.tree));
  }, [selectedFilePath, fileTree, docs]);

  useEffect(() => {
    if (!selectedProject?.id || !selectedFilePath) {
      setWorkspaceFile(null);
      setWorkspaceDiff(null);
      setFileDraft('');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [file, diff] = await Promise.all([
          fetchAppBuilderWorkspaceFile(selectedProject.id, selectedFilePath),
          fetchAppBuilderWorkspaceDiff(selectedProject.id, selectedFilePath).catch(() => null),
        ]);
        if (cancelled) return;
        setWorkspaceFile(file);
        setFileDraft(file.content);
        setWorkspaceDiff(diff);
      } catch {
        if (cancelled) return;
        setWorkspaceFile(null);
        setWorkspaceDiff(null);
        setFileDraft('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id, selectedFilePath]);

  const refreshFileWorkspace = async (nextPath?: string | null) => {
    if (!selectedProject?.id) return;
    const effectivePath = nextPath === undefined ? selectedFilePath : nextPath;
    await onSoftRefresh();
    if (nextPath !== undefined) {
      setSelectedFilePath(nextPath);
    }
    if (!effectivePath) {
      setWorkspaceFile(null);
      setWorkspaceDiff(null);
      setFileDraft('');
      return;
    }
    const [file, diff] = await Promise.all([
      fetchAppBuilderWorkspaceFile(selectedProject.id, effectivePath),
      fetchAppBuilderWorkspaceDiff(selectedProject.id, effectivePath).catch(() => null),
    ]);
    setWorkspaceFile(file);
    setFileDraft(file.content);
    setWorkspaceDiff(diff);
  };

  const handleSaveFile = async () => {
    if (!selectedProject?.id || !selectedFilePath) return;
    setFileBusy('save');
    try {
      const file = await saveAppBuilderWorkspaceFile(selectedProject.id, {
        path: selectedFilePath,
        content: fileDraft,
      });
      setWorkspaceFile(file);
      setFileDraft(file.content);
      setWorkspaceDiff(await fetchAppBuilderWorkspaceDiff(selectedProject.id, selectedFilePath));
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setFileBusy(null);
    }
  };

  const handleFormatFile = async () => {
    if (!selectedProject?.id || !selectedFilePath) return;
    setFileBusy('format');
    try {
      const file = await formatAppBuilderWorkspaceFile(selectedProject.id, selectedFilePath);
      setWorkspaceFile(file);
      setFileDraft(file.content);
      setWorkspaceDiff(await fetchAppBuilderWorkspaceDiff(selectedProject.id, selectedFilePath));
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setFileBusy(null);
    }
  };

  const handleCreateFile = async () => {
    if (!selectedProject?.id) return;
    const nextPath = window.prompt('Create file at path', selectedFilePath ? selectedFilePath.replace(/[^/]+$/, 'new-file.tsx') : 'docs/NOTES.md');
    if (!nextPath) return;
    setFileBusy('create-file');
    try {
      await saveAppBuilderWorkspaceFile(selectedProject.id, { path: nextPath, content: '' });
      await refreshFileWorkspace(nextPath);
    } finally {
      setFileBusy(null);
    }
  };

  const handleCreateFolder = async () => {
    if (!selectedProject?.id) return;
    const nextPath = window.prompt('Create folder at path', 'docs');
    if (!nextPath) return;
    setFileBusy('create-folder');
    try {
      await createAppBuilderWorkspaceFolder(selectedProject.id, nextPath);
      await refreshFileWorkspace();
    } finally {
      setFileBusy(null);
    }
  };

  const handleRenamePath = async () => {
    if (!selectedProject?.id || !selectedFilePath) return;
    const nextPath = window.prompt('Rename to', selectedFilePath);
    if (!nextPath || nextPath === selectedFilePath) return;
    setFileBusy('rename');
    try {
      await renameAppBuilderWorkspacePath(selectedProject.id, selectedFilePath, nextPath);
      await refreshFileWorkspace(nextPath);
    } finally {
      setFileBusy(null);
    }
  };

  const handleDeletePath = async () => {
    if (!selectedProject?.id || !selectedFilePath) return;
    if (!window.confirm(`Delete ${selectedFilePath}?`)) return;
    setFileBusy('delete');
    try {
      await deleteAppBuilderWorkspacePath(selectedProject.id, selectedFilePath);
      await refreshFileWorkspace(null);
      setSelectedFilePath(null);
    } finally {
      setFileBusy(null);
    }
  };

  const handleApplyStaging = async (stagingId: string) => {
    if (!selectedProject?.id) return;
    setStagingBusy(`apply:${stagingId}`);
    try {
      await applyAppBuilderStagedGeneration(selectedProject.id, stagingId);
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setStagingBusy(null);
    }
  };

  const handleDiscardStaging = async (stagingId: string) => {
    if (!selectedProject?.id) return;
    if (!window.confirm(`Discard staged generation ${stagingId}?`)) return;
    setStagingBusy(`discard:${stagingId}`);
    try {
      await discardAppBuilderStagedGeneration(selectedProject.id, stagingId);
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setStagingBusy(null);
    }
  };

  const handleRollbackStaging = async (stagingId: string) => {
    if (!selectedProject?.id) return;
    if (!window.confirm(`Rollback to the base snapshot for ${stagingId}?`)) return;
    setStagingBusy(`rollback:${stagingId}`);
    try {
      await rollbackAppBuilderStagedGeneration(selectedProject.id, stagingId);
      await refreshFileWorkspace(null);
      setSelectedFilePath(null);
    } finally {
      setStagingBusy(null);
    }
  };

  const handleApproveSecurityFinding = async (stagingId: string, finding: AppBuilderSecurityScan['findings'][number]) => {
    if (!selectedProject?.id || !finding.fileHash) return;
    setStagingBusy(`security:${finding.id}`);
    try {
      await approveAppBuilderSecurityFinding(selectedProject.id, {
        stagingId,
        filePath: finding.filePath,
        fileHash: finding.fileHash,
        patternId: finding.patternId,
        decision: 'approved',
      });
      await onSoftRefresh();
    } finally {
      setStagingBusy(null);
    }
  };

  const handleResolveConflict = async (
    stagingId: string,
    filePath: string,
    decision: 'keep_current' | 'overwrite_staged' | 'regenerate_patch',
  ) => {
    if (!selectedProject?.id) return;
    setStagingBusy(`conflict:${stagingId}:${filePath}:${decision}`);
    try {
      await resolveAppBuilderStagedConflict(selectedProject.id, stagingId, { filePath, decision });
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setStagingBusy(null);
    }
  };

  const handleUploadReferences = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedProject?.id) return;
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadBusy('upload');
    setUploadError(null);
    try {
      for (const file of files) {
        await createAppBuilderMultipartUpload(selectedProject.id, file, inferReferenceUploadKind(file));
      }
      await onSoftRefresh();
    } catch (error) {
      setUploadError(uploadErrorMessage(error));
    } finally {
      event.target.value = '';
      setUploadBusy(null);
    }
  };

  const handleReanalyzeUpload = async (uploadId: string) => {
    if (!selectedProject?.id) return;
    setUploadBusy(uploadId);
    setUploadError(null);
    try {
      await reanalyzeAppBuilderUpload(selectedProject.id, uploadId);
      await onSoftRefresh();
    } catch (error) {
      setUploadError(uploadErrorMessage(error));
    } finally {
      setUploadBusy(null);
    }
  };

  const handleStartTerminal = async () => {
    if (!selectedProject?.id) return;
    setFileBusy('terminal-start');
    try {
      const session = await startAppBuilderTerminalSession(selectedProject.id);
      if (session?.activeCommandId || session?.commands?.[0]?.id) {
        setSelectedTerminalCommandId(session.activeCommandId || session.commands[0]?.id || null);
      }
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setFileBusy(null);
    }
  };

  const handleRunTerminal = async (registerPreview = false) => {
    if (!selectedProject?.id || !terminalCommand.trim()) return;
    setFileBusy('terminal-run');
    try {
      const session = await submitAppBuilderTerminalCommand(selectedProject.id, {
        command: terminalCommand,
        requestedBy: 'builder-workspace',
        background: runInBackground,
        registerPreview,
      });
      if (session?.activeCommandId || session?.commands?.[0]?.id) {
        setSelectedTerminalCommandId(session.activeCommandId || session.commands[0]?.id || null);
      }
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setFileBusy(null);
    }
  };

  const handleStopTerminal = async () => {
    if (!selectedProject?.id) return;
    setFileBusy('terminal-stop');
    try {
      const session = await stopAppBuilderTerminalSession(selectedProject.id);
      setSelectedTerminalCommandId(session?.commands?.[0]?.id || null);
      await refreshFileWorkspace(selectedFilePath);
    } finally {
      setFileBusy(null);
    }
  };

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((current) => ({
      ...current,
      [dirPath]: !current[dirPath],
    }));
  };

  const renderTreeNodes = (nodes: WorkspaceFileNode[], depth = 0): ReactNode =>
    nodes.map((node) => {
      const isSelected = selectedFilePath === node.path;
      if (node.type === 'directory') {
        const collapsed = Boolean(collapsedDirs[node.path]);
        return (
          <div key={node.path} style={{ display: 'grid', gap: '0.18rem' }}>
            <button
              onClick={() => toggleDir(node.path)}
              style={{
                ...fileTreeButtonStyle,
                paddingLeft: `${0.65 + depth * 0.8}rem`,
                fontWeight: 600,
              }}
            >
              {collapsed ? <FiChevronRight size={14} /> : <FiChevronDown size={14} />}
              <FiFolder size={14} />
              <span>{node.name}</span>
            </button>
            {!collapsed && node.children?.length ? <div>{renderTreeNodes(node.children, depth + 1)}</div> : null}
          </div>
        );
      }
      return (
        <button
          key={node.path}
          onClick={() => {
            setSelectedFilePath(node.path);
            setWorkspaceTab('files');
          }}
          style={{
            ...fileTreeButtonStyle,
            paddingLeft: `${1.55 + depth * 0.8}rem`,
            background: isSelected ? 'var(--accent-light)' : 'transparent',
            borderColor: isSelected ? 'var(--border-accent)' : 'transparent',
          }}
        >
          <FiCode size={13} />
          <span>{node.name}</span>
        </button>
      );
    });

  const workspaceContent =
    effectiveWorkspaceTab === 'activity' ? (
      <div style={workspaceCanvasStyle}>
        <div style={workspaceGridStyle}>
          <section style={subtleCardStyle}>
            <div className="mono" style={sectionLabelStyle}>CURRENT PHASE</div>
            <div style={{ display: 'grid', gap: '0.65rem' }}>
              <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <StatusPill label={workspaceStage} tone={hasProject ? 'info' : 'default'} />
                {detail?.approvalGate?.stage ? <StatusPill label={`awaiting ${detail.approvalGate.stage} approval`} tone="warning" /> : null}
                {previewConnection ? <StatusPill label={previewConnection.status} tone={previewConnection.status === 'ready' ? 'good' : previewConnection.status === 'failed' ? 'warning' : 'info'} /> : null}
              </div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                {previewConnection?.summary || workspaceSummary}
              </div>
              <DetailRow label="Template" value={activeTemplate?.name || selectedProject?.templateId || 'Auto'} />
              <DetailRow label="Managed path" value={selectedProject?.managedPath || 'Pending'} mono />
              <DetailRow label="Latest validation" value={formatValidationState(detail?.latestValidation)} />
              <DetailRow label="Tracked files" value={String(latestFileGraph?.files.length || activeTemplate?.generatedFiles.length || 0)} />
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <RouteChip label="Chat" value={resolveBuilderRouteValue(activeModelRoutes, 'chat')} />
                <RouteChip label="Planner" value={resolveBuilderRouteValue(activeModelRoutes, 'planner')} />
                <RouteChip label="Build" value={resolveBuilderRouteValue(activeModelRoutes, 'build')} />
              </div>
              {latestSpec ? <DetailRow label="Spec" value={latestSpec.summary} /> : null}
              {latestArchitecture ? <DetailRow label="Architecture" value={`${latestArchitecture.framework} / ${latestArchitecture.buildTool}`} /> : null}
              {latestPreviewSession?.url ? <DetailRow label="Preview session" value={latestPreviewSession.url} mono /> : null}
            </div>
          </section>

          {activeStagedGenerations.length ? (
            <section style={subtleCardStyle}>
              <div className="mono" style={sectionLabelStyle}>STAGED CHANGES</div>
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {activeStagedGenerations.slice(0, 4).map((staged) => {
                  const applied = staged.appliedFilePaths?.length || 0;
                  const remaining = Math.max(0, staged.changedFiles.length - applied - (staged.discardedFilePaths?.length || 0));
                  const scan = securityScans.find((entry) => entry.stagingId === staged.id);
                  const pendingFindings = (scan?.findings || []).filter((finding) => (
                    finding.status === 'needs_approval'
                    && finding.fileHash
                    && !approvedSecurityKeys.has(`${staged.id}:${finding.filePath}:${finding.fileHash}:${finding.patternId}`)
                  ));
                  const blockedFindings = (scan?.findings || []).filter((finding) => finding.status === 'blocked');
                  return (
                    <div key={staged.id} style={{ ...compactRowStyle, alignItems: 'start' }}>
                      <div style={{ display: 'grid', gap: '0.35rem' }}>
                        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '0.92rem' }}>{staged.diffSummary || `${staged.changedFiles.length} files staged`}</strong>
                          <StatusPill label={staged.status.replace(/_/g, ' ')} tone={staged.status === 'conflict' ? 'warning' : 'info'} />
                          {staged.securityStatus && staged.securityStatus !== 'pass' ? (
                            <StatusPill label={`security ${staged.securityStatus.replace(/_/g, ' ')}`} tone="warning" />
                          ) : null}
                        </div>
                        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.74rem', overflowWrap: 'anywhere' }}>
                          {staged.changedFiles.slice(0, 5).join(', ')}{staged.changedFiles.length > 5 ? ` +${staged.changedFiles.length - 5} more` : ''}
                        </div>
                        {staged.conflicts?.length ? (
                          <div style={{ display: 'grid', gap: '0.4rem' }}>
                            <div style={{ color: 'var(--warning, #d97706)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                              {staged.conflicts.length} conflict{staged.conflicts.length === 1 ? '' : 's'} need review before apply.
                            </div>
                            {staged.conflicts.slice(0, 3).map((conflict) => (
                              <div key={`${staged.id}:${conflict.path}`} style={{ display: 'grid', gap: '0.3rem' }}>
                                <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.74rem', overflowWrap: 'anywhere' }}>
                                  {conflict.path}
                                </div>
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                  <button className="btn-ghost" onClick={() => void handleResolveConflict(staged.id, conflict.path, 'keep_current')} disabled={Boolean(stagingBusy)}>
                                    Keep current
                                  </button>
                                  <button className="btn-ghost" onClick={() => void handleResolveConflict(staged.id, conflict.path, 'overwrite_staged')} disabled={Boolean(stagingBusy)}>
                                    Use staged
                                  </button>
                                  <button className="btn-ghost" onClick={() => void handleResolveConflict(staged.id, conflict.path, 'regenerate_patch')} disabled={Boolean(stagingBusy)}>
                                    Regenerate
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            {remaining} file{remaining === 1 ? '' : 's'} waiting to apply.
                          </div>
                        )}
                        {blockedFindings.length ? (
                          <div style={{ color: 'var(--error, #dc2626)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                            {blockedFindings.length} blocked security finding{blockedFindings.length === 1 ? '' : 's'} must be regenerated.
                          </div>
                        ) : null}
                        {staged.referenceInfluence ? (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.45 }}>
                            Reference influence: {summarizeReferenceInfluence(staged.referenceInfluence)}
                          </div>
                        ) : null}
                        {pendingFindings.length ? (
                          <div style={{ display: 'grid', gap: '0.35rem' }}>
                            {pendingFindings.slice(0, 3).map((finding) => (
                              <div key={finding.id} style={{ display: 'flex', gap: '0.45rem', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                  {finding.summary}
                                </span>
                                <button
                                  className="btn-ghost"
                                  onClick={() => void handleApproveSecurityFinding(staged.id, finding)}
                                  disabled={Boolean(stagingBusy)}
                                >
                                  {stagingBusy === `security:${finding.id}` ? 'Approving...' : 'Approve'}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          className="btn-primary"
                          onClick={() => void handleApplyStaging(staged.id)}
                          disabled={Boolean(stagingBusy) || staged.status === 'conflict'}
                        >
                          {stagingBusy === `apply:${staged.id}` ? 'Applying...' : 'Apply'}
                        </button>
                        <button className="btn-ghost" onClick={() => void handleRollbackStaging(staged.id)} disabled={Boolean(stagingBusy)}>
                          Rollback
                        </button>
                        <button className="btn-ghost" onClick={() => void handleDiscardStaging(staged.id)} disabled={Boolean(stagingBusy)}>
                          Discard
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section style={subtleCardStyle}>
            <div className="mono" style={sectionLabelStyle}>REFERENCE UPLOADS</div>
            <div style={{ display: 'grid', gap: '0.65rem' }}>
              <label className="btn-primary" style={{ justifyContent: 'center', cursor: selectedProject ? 'pointer' : 'not-allowed', opacity: selectedProject ? 1 : 0.55 }}>
                {uploadBusy === 'upload' ? 'Uploading...' : 'Upload reference files'}
                <input
                  type="file"
                  multiple
                  onChange={(event) => void handleUploadReferences(event)}
                  disabled={!selectedProject || Boolean(uploadBusy)}
                  style={{ display: 'none' }}
                  accept=".png,.jpg,.jpeg,.webp,.svg,.pdf,.docx,.txt,.md,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.graphql,.gql"
                />
              </label>
              {uploadError ? (
                <div style={{ color: 'var(--warning, #d97706)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                  {uploadError}
                </div>
              ) : null}
              {uploadRecords.length ? (
                <div style={{ display: 'grid', gap: '0.45rem' }}>
                  {uploadRecords.slice(0, 6).map((upload) => {
                    const uploadId = String(upload.id);
                    const related = referenceArtifacts.find((artifact) => String(artifact.uploadId) === uploadId);
                    const status = String(related?.status || upload.status || 'stored');
                    return (
                      <div key={uploadId} style={compactRowStyle}>
                        <div style={{ display: 'grid', gap: '0.2rem' }}>
                          <strong style={{ fontSize: '0.88rem' }}>{String(upload.filename || uploadId)}</strong>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                            {String(upload.kind || 'reference')} / {formatBytes(Number(upload.sizeBytes || 0))} / {status.replace(/_/g, ' ')}
                          </div>
                          {related?.warnings && Array.isArray(related.warnings) && related.warnings.length ? (
                            <div style={{ color: 'var(--warning, #d97706)', fontSize: '0.78rem' }}>{String(related.warnings[0])}</div>
                          ) : null}
                          {related?.recommendedAction ? (
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>
                              {String(related.recommendedAction)}
                            </div>
                          ) : null}
                        </div>
                        <button
                          className="btn-ghost"
                          onClick={() => void handleReanalyzeUpload(uploadId)}
                          disabled={Boolean(uploadBusy)}
                        >
                          {uploadBusy === uploadId ? 'Analyzing...' : 'Reanalyze'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="Upload screenshots, docs, or code contracts to use as generation references." />
              )}
            </div>
          </section>

          {projectSuggestions.length || selectedProject?.metadata?.suggestionVectorClearFailed ? (
            <section style={subtleCardStyle}>
              <div className="mono" style={sectionLabelStyle}>SUGGESTIONS</div>
              <div style={{ display: 'grid', gap: '0.55rem' }}>
                {selectedProject?.metadata?.suggestionVectorClearFailed ? (
                  <div style={{ color: 'var(--warning, #d97706)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                    Suggestion deduplication is degraded.
                  </div>
                ) : null}
                {projectSuggestions.slice(0, 5).map((suggestion) => (
                  <div key={String(suggestion.id)} style={compactRowStyle}>
                    <div style={{ display: 'grid', gap: '0.22rem' }}>
                      <strong style={{ fontSize: '0.9rem' }}>{String(suggestion.title || suggestion.issueCode || 'Suggestion')}</strong>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                        {String(suggestion.summary || '')}
                      </div>
                    </div>
                    <StatusPill label={String(suggestion.severity || 'info')} tone={suggestion.severity === 'high' ? 'warning' : 'info'} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section style={subtleCardStyle}>
            <div className="mono" style={sectionLabelStyle}>OBSERVABILITY</div>
            <div style={{ display: 'grid', gap: '0.55rem' }}>
              <DetailRow label="Active runs" value={String(activeProjectRuns.filter((run) => !['completed', 'cancelled'].includes(run.status)).length)} />
              <DetailRow label="Security findings" value={String(securityScans.reduce((count, scan) => count + (scan.findings?.length || 0), 0))} />
              <DetailRow label="Staged records" value={String(activeStagedGenerations.length)} />
              <DetailRow label="Index freshness" value={String(selectedProject?.metadata?.lastIndexedAt || 'Not indexed yet')} />
              {selectedProject?.metadata?.suggestionVectorClearFailed ? (
                <div style={{ color: 'var(--warning, #d97706)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                  Suggestion vector cleanup failed. Deduplication may be degraded until cleanup is retried.
                </div>
              ) : null}
              {selectedProject?.metadata?.smokeRestoreFailed ? (
                <div style={{ color: 'var(--warning, #d97706)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                  Smoke restore failed. Preview and control commands remain unavailable until recovery.
                </div>
              ) : null}
              {selectedProject?.metadata?.lastIndexError ? (
                <div style={{ color: 'var(--warning, #d97706)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                  Indexing issue: {String(selectedProject.metadata.lastIndexError)}
                </div>
              ) : null}
            </div>
          </section>

          <section style={subtleCardStyle}>
            <div className="mono" style={sectionLabelStyle}>TASK LIST</div>
            {taskList?.tasks.length ? (
              <div style={{ display: 'grid', gap: '0.55rem' }}>
                {taskList.tasks.slice(0, 8).map((task) => (
                  <div key={task.id} style={compactRowStyle}>
                    <div style={{ display: 'grid', gap: '0.22rem' }}>
                      <strong style={{ fontSize: '0.92rem' }}>{task.title}</strong>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                        {task.detail || `${task.owner || 'system'} / ${task.source || 'plan'}`}
                      </div>
                    </div>
                    <StatusPill
                      label={task.status.replace(/_/g, ' ')}
                      tone={task.status === 'completed' ? 'good' : task.status === 'in_progress' ? 'info' : task.status === 'blocked' ? 'warning' : 'default'}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="The planner will create a layered task list here before deeper work begins." />
            )}
          </section>

          <section style={{ ...subtleCardStyle, gridColumn: '1 / -1' }}>
            <div className="mono" style={sectionLabelStyle}>LIVE AGENT ACTIVITY</div>
            {activity.length ? (
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {activity.slice(0, 14).map((entry) => (
                  <div key={entry.id} style={compactRowStyle}>
                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.92rem' }}>{entry.title}</strong>
                        <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {entry.kind}{entry.phase ? ` / ${entry.phase}` : ''}{entry.modelId ? ` / ${entry.modelId}` : ''}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{entry.summary}</div>
                      {entry.filePath ? (
                        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                          {entry.filePath}
                        </div>
                      ) : null}
                    </div>
                    <StatusPill
                      label={entry.status}
                      tone={entry.status === 'success' ? 'good' : entry.status === 'warning' || entry.status === 'error' ? 'warning' : entry.status === 'working' ? 'info' : 'default'}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Planner, builder, validation, file, terminal, and memory activity will stream here as the project advances." />
            )}
          </section>

          <section style={subtleCardStyle}>
            <div className="mono" style={sectionLabelStyle}>PROJECT BIBLE</div>
            {docs.length ? (
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                {docs.slice(0, 6).map((doc) => (
                  <button
                    key={doc.id}
                    className="btn-ghost"
                    onClick={() => {
                      setSelectedFilePath(doc.path);
                      setWorkspaceTab('docs');
                    }}
                    style={{ justifyContent: 'space-between', textAlign: 'left' }}
                  >
                    <span>{doc.title}</span>
                    <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{doc.path}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState message="Docs will appear here as soon as planning scaffolds the project bible." />
            )}
          </section>

          <section style={subtleCardStyle}>
            <div className="mono" style={sectionLabelStyle}>PROJECT MEMORY</div>
            {memorySnapshot ? (
              <div style={{ display: 'grid', gap: '0.55rem' }}>
                <DetailRow label="Collection" value={memorySnapshot.collection} mono />
                <DetailRow label="Agent memory" value={memorySnapshot.agentMemoryPath || 'Pending'} mono />
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {memorySnapshot.latestSummary || 'No compressed project summary has been stored yet.'}
                </div>
              </div>
            ) : (
              <EmptyState message="Project memory will compress durable decisions and important facts here." />
            )}
          </section>
        </div>
      </div>
    ) : effectiveWorkspaceTab === 'preview' ? (
      <div style={previewCanvasStyle}>
        {effectivePreviewUrl && (preview.status === 'ready' || terminalSession?.status === 'running') ? (
          <iframe title="App Builder preview" src={effectivePreviewUrl} style={previewFrameStyle} />
        ) : (
          <div style={previewPlaceholderStyle}>
            <div style={{ display: 'grid', gap: '0.65rem', maxWidth: '580px' }}>
              <StatusPill
                label={previewConnection?.status || workspaceStage}
                tone={previewConnection?.status === 'ready' ? 'good' : previewConnection?.status === 'starting' ? 'info' : 'default'}
              />
              <h2 style={{ fontSize: '1.45rem', margin: 0 }}>{preview.title}</h2>
              <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65 }}>{preview.summary}</p>
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                <DetailRow label="Current stage" value={workspaceStage} />
                <DetailRow label="Preview source" value={previewConnection?.source || 'none'} />
                <DetailRow label="Next action" value={workspaceActions[0]?.label || 'Keep refining the brief'} />
                <DetailRow
                  label="System summary"
                  value={previewConnection?.projectPath || selectedProject?.managedPath || latestPreviewSession?.servedPath || preview.projectPath || 'No managed project yet'}
                  mono
                />
              </div>
            </div>
          </div>
        )}
      </div>
    ) : effectiveWorkspaceTab === 'files' ? (
      <div style={workspaceCanvasStyle}>
        <div style={fileWorkspaceStyle}>
          <section style={{ ...subtleCardStyle, minHeight: 0, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', marginBottom: '0.6rem' }}>
              <div className="mono" style={sectionLabelStyle}>WORKSPACE FOLDER</div>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button className="btn-ghost" onClick={() => void handleCreateFile()} disabled={Boolean(fileBusy)}>New file</button>
                <button className="btn-ghost" onClick={() => void handleCreateFolder()} disabled={Boolean(fileBusy)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FiFolderPlus size={14} />
                  Folder
                </button>
              </div>
            </div>
            {fileTree?.tree?.length ? (
              <div style={{ display: 'grid', gap: '0.18rem' }}>{renderTreeNodes(fileTree.tree)}</div>
            ) : (
              <EmptyState message="The project file tree will appear here once the managed repo exists." />
            )}
          </section>

          <section style={{ ...subtleCardStyle, minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: '0.7rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: '0.2rem' }}>
                <div className="mono" style={sectionLabelStyle}>EDITOR</div>
                <div className="mono" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', overflowWrap: 'anywhere' }} title={selectedFilePath || 'Select a file'}>
                  {selectedFilePath || 'Select a file'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button className="btn-ghost" onClick={() => void handleRenamePath()} disabled={!selectedFilePath || Boolean(fileBusy)}>Rename</button>
                <button className="btn-ghost" onClick={() => void handleFormatFile()} disabled={!selectedFilePath || Boolean(fileBusy)}>Format</button>
                <button className="btn-primary" onClick={() => void handleSaveFile()} disabled={!selectedFilePath || Boolean(fileBusy)}>
                  {fileBusy === 'save' ? 'Saving...' : 'Save'}
                </button>
                <button className="btn-ghost" onClick={() => void handleDeletePath()} disabled={!selectedFilePath || Boolean(fileBusy)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FiTrash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
            {selectedFilePath ? (
              <textarea value={fileDraft} onChange={(event) => setFileDraft(event.target.value)} style={fileEditorStyle} spellCheck={false} />
            ) : (
              <EmptyState message="Select a file from the tree to inspect, edit, diff, or format it." />
            )}
          </section>

          <section style={{ ...subtleCardStyle, minHeight: 0, overflow: 'auto' }}>
            <div className="mono" style={sectionLabelStyle}>DIFF</div>
            {workspaceDiff?.hunks?.length ? (
              <div style={{ display: 'grid', gap: '0.2rem' }}>
                {workspaceDiff.hunks.map((change, index) => (
                  <div
                    key={`${change.kind}-${index}`}
                    className="mono"
                    style={{
                      ...diffLineStyle,
                      background:
                        change.kind === 'add'
                          ? 'rgba(16, 185, 129, 0.12)'
                          : change.kind === 'remove'
                            ? 'rgba(239, 68, 68, 0.08)'
                            : 'transparent',
                    }}
                  >
                    <span style={{ color: change.kind === 'add' ? 'var(--status-ok, var(--success))' : change.kind === 'remove' ? 'var(--status-error, var(--error))' : 'var(--text-muted)' }}>
                      {change.kind === 'add' ? '+' : change.kind === 'remove' ? '-' : ' '}
                    </span>
                    <span>{change.content}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Diffs against the previous saved revision will appear here after a file changes." />
            )}
          </section>
        </div>
      </div>
    ) : effectiveWorkspaceTab === 'docs' ? (
      <div style={workspaceCanvasStyle}>
        <div style={docsWorkspaceStyle}>
          <section style={{ ...subtleCardStyle, minHeight: 0, overflow: 'auto' }}>
            <div className="mono" style={sectionLabelStyle}>PROJECT BIBLE</div>
            {docs.length ? (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {docs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedFilePath(doc.path)}
                    style={{
                      ...fileTreeButtonStyle,
                      justifyContent: 'space-between',
                      background: selectedFilePath === doc.path ? 'var(--accent-light)' : 'transparent',
                      borderColor: selectedFilePath === doc.path ? 'var(--border-accent)' : 'transparent',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                      <FiFileText size={14} />
                      {doc.title}
                    </span>
                    <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{doc.path}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState message="Planner and builder docs will appear here as the docs folder is scaffolded." />
            )}
          </section>

          <section style={{ ...subtleCardStyle, minHeight: 0, overflow: 'auto', display: 'grid', gap: '0.75rem' }}>
            <div className="mono" style={sectionLabelStyle}>DOCUMENT CONTENT</div>
            {workspaceFile ? (
              <pre className="mono" style={docContentStyle}>{workspaceFile.content}</pre>
            ) : (
              <EmptyState message="Select a project bible document to read the current brief, plan, tasks, decisions, memory, or status." />
            )}
          </section>

          <section style={{ ...subtleCardStyle, minHeight: 0, overflow: 'auto', display: 'grid', gap: '0.75rem' }}>
            <div className="mono" style={sectionLabelStyle}>TASKS + MEMORY</div>
            {taskList?.tasks.length ? (
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                {taskList.tasks.map((task) => (
                  <div key={task.id} style={compactRowStyle}>
                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                      <strong style={{ fontSize: '0.88rem' }}>{task.title}</strong>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {task.phase || 'general'} / {task.owner || 'system'}
                      </div>
                    </div>
                    <StatusPill
                      label={task.status.replace(/_/g, ' ')}
                      tone={task.status === 'completed' ? 'good' : task.status === 'in_progress' ? 'info' : task.status === 'blocked' ? 'warning' : 'default'}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {memorySnapshot ? (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <DetailRow label="Summary" value={memorySnapshot.latestSummary || 'No compressed summary yet'} />
                <DetailRow label="Memory file" value={memorySnapshot.agentMemoryPath || 'Pending'} mono />
              </div>
            ) : !taskList?.tasks.length ? (
              <EmptyState message="Tasks and rolling memory snapshots will accumulate here as the project evolves." />
            ) : null}
          </section>
        </div>
      </div>
    ) : effectiveWorkspaceTab === 'terminal' ? (
      <div style={workspaceCanvasStyle}>
        <div style={{ ...subtleCardStyle, display: 'grid', gap: '0.9rem', minHeight: 0, gridTemplateRows: 'auto auto minmax(0, 1fr)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <div className="mono" style={sectionLabelStyle}>SHARED TERMINAL</div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Run local servers, inspect logs, and share the same project shell with RawClaw agents.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <StatusPill label={terminalSession?.status || 'stopped'} tone={terminalSession?.status === 'running' ? 'info' : terminalSession?.status === 'error' ? 'warning' : terminalSession?.status === 'stopped' ? 'warning' : 'default'} />
              <button className="btn-ghost" onClick={() => void handleStartTerminal()} disabled={Boolean(fileBusy)}>Start session</button>
              <button className="btn-primary" onClick={() => void handleStopTerminal()} disabled={Boolean(fileBusy) || !stoppableTerminalCommand} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                Stop session
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.7rem' }}>
              <section style={terminalSummaryCardStyle}>
                <div className="mono" style={sectionLabelStyle}>WORKDIR</div>
                <div className="mono" style={terminalSummaryValueStyle} title={terminalSession?.cwd || selectedProject?.managedPath || 'Project root not ready yet'}>
                  {terminalSession?.cwd || selectedProject?.managedPath || 'Project root not ready yet'}
                </div>
              </section>

              <section style={terminalSummaryCardStyle}>
                <div className="mono" style={sectionLabelStyle}>LIVE PREVIEW</div>
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  <div className="mono" style={terminalSummaryValueStyle} title={detectedTerminalPreviewUrl || 'No preview URL detected yet'}>
                    {detectedTerminalPreviewUrl || 'No preview URL detected yet'}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    Port: {detectedTerminalPreviewPort || 'pending'}
                  </div>
                  {detectedTerminalPreviewUrl ? (
                    <button
                      className="btn-ghost"
                      onClick={() => window.open(detectedTerminalPreviewUrl, '_blank', 'noopener,noreferrer')}
                      style={{ justifySelf: 'start' }}
                    >
                      Open preview
                    </button>
                  ) : null}
                </div>
              </section>

              <section style={terminalSummaryCardStyle}>
                <div className="mono" style={sectionLabelStyle}>ACTIVE COMMAND</div>
                <div className="mono" style={terminalSummaryValueStyle} title={activeTerminalCommand?.command || terminalCommand}>
                  {activeTerminalCommand?.command || terminalCommand}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', overflowWrap: 'anywhere' }}>
                  {activeTerminalCommand?.requestedBy || 'builder-workspace'} / {activeTerminalCommand?.status || terminalSession?.status || 'idle'}
                </div>
              </section>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: '0.55rem', alignItems: 'center' }}>
              <input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} style={fieldStyle} placeholder="npm run dev" />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={runInBackground} onChange={(event) => setRunInBackground(event.target.checked)} />
                background
              </label>
              <button className="btn-ghost" onClick={() => void handleRunTerminal(false)} disabled={Boolean(fileBusy)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <FiPlay size={14} />
                Run
              </button>
              <button className="btn-primary" onClick={() => void handleRunTerminal(true)} disabled={Boolean(fileBusy)}>
                Run + preview
              </button>
            </div>
          </div>

          {terminalCommands.length ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: stackTerminalPanels ? 'minmax(0, 1fr)' : 'minmax(300px, 360px) minmax(0, 1fr)',
                gap: '0.9rem',
                minHeight: 'min(420px, 52vh)',
              }}
            >
              <section style={{ ...terminalCommandCardStyle, minHeight: 0, overflow: 'auto' }}>
                <div className="mono" style={sectionLabelStyle}>COMMAND HISTORY</div>
                <div style={{ display: 'grid', gap: '0.55rem' }}>
                  {[selectedTerminalCommand, ...terminalHistory]
                    .filter((command): command is TerminalCommandRecord => Boolean(command))
                    .slice(0, 8)
                    .map((command) => (
                      <button
                        key={command.id}
                        onClick={() => setSelectedTerminalCommandId(command.id)}
                        style={{
                          ...compactRowStyle,
                          alignItems: 'flex-start',
                          width: '100%',
                          textAlign: 'left',
                          cursor: 'pointer',
                          background: selectedTerminalCommand?.id === command.id ? 'var(--accent-light)' : 'var(--bg-surface)',
                          borderColor: selectedTerminalCommand?.id === command.id ? 'var(--border-accent)' : 'var(--border)',
                          borderRadius: '10px',
                          padding: '0.75rem 0.85rem',
                        }}
                      >
                        <div style={{ display: 'grid', gap: '0.25rem' }}>
                          <div className="mono" style={terminalHistoryCommandStyle} title={command.command}>
                            {command.command}
                          </div>
                          <div style={terminalHistoryMetaStyle} title={`${command.requestedBy} / ${command.cwd}`}>
                            {command.requestedBy} / {command.cwd}
                          </div>
                          {command.previewUrl ? (
                            <div className="mono" style={terminalHistoryUrlStyle} title={command.previewUrl}>
                              {command.previewUrl}
                            </div>
                          ) : null}
                        </div>
                        <StatusPill
                          label={command.status}
                          tone={command.status === 'completed' ? 'good' : command.status === 'failed' ? 'warning' : command.status === 'running' ? 'info' : command.status === 'cancelled' ? 'warning' : 'default'}
                        />
                      </button>
                    ))}
                </div>
              </section>

              <section style={{ ...terminalCommandCardStyle, minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: '0.7rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: '0.2rem' }}>
                    <div className="mono" style={sectionLabelStyle}>LIVE LOG</div>
                    <div style={terminalHistoryMetaStyle} title={selectedTerminalCommand?.command || activeTerminalCommand?.command || 'No command selected'}>
                      {selectedTerminalCommand?.command || activeTerminalCommand?.command || 'No command selected'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {(selectedTerminalCommand || activeTerminalCommand) ? (
                      <StatusPill
                        label={(selectedTerminalCommand || activeTerminalCommand)!.status}
                        tone={(selectedTerminalCommand || activeTerminalCommand)!.status === 'completed' ? 'good' : (selectedTerminalCommand || activeTerminalCommand)!.status === 'failed' ? 'warning' : (selectedTerminalCommand || activeTerminalCommand)!.status === 'running' ? 'info' : (selectedTerminalCommand || activeTerminalCommand)!.status === 'cancelled' ? 'warning' : 'default'}
                      />
                    ) : null}
                    {stoppableTerminalCommand ? (
                      <button
                        className="btn-primary"
                        onClick={() => void handleStopTerminal()}
                        disabled={Boolean(fileBusy)}
                      >
                        Stop active
                      </button>
                    ) : null}
                  </div>
                </div>
                <pre className="mono" style={terminalOutputStyle}>
                  {sanitizeTerminalText(selectedTerminalCommand?.output || activeTerminalCommand?.output) || 'No terminal output yet.'}
                </pre>
              </section>
            </div>
          ) : (
            <EmptyState message="Start a shared terminal session here, then run the local dev server or project commands with full visibility for both you and the agents." />
          )}
        </div>
      </div>
    ) : (
      <div style={{ display: 'grid', gap: '0.85rem' }}>
        <section style={subtleCardStyle}>
          <div className="mono" style={sectionLabelStyle}>LOG STREAM</div>
          {logEntries.length ? (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {logEntries.map((entry) => (
                <div key={entry.id} style={compactRowStyle}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{entry.label}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{entry.summary}</div>
                  </div>
                  <StatusPill label={entry.status} tone={entry.tone} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="Logs will appear here once generation, validation, or preview activity begins." />
          )}
        </section>

        <section style={subtleCardStyle}>
          <div className="mono" style={sectionLabelStyle}>VALIDATION + HEALING</div>
          {latestValidationSession || healingAttempts.length ? (
            <div style={{ display: 'grid', gap: '0.65rem' }}>
              {latestValidationSession ? (
                <>
                  <DetailRow label="Attempts" value={String(latestValidationSession.attempts)} />
                  {latestValidationSession.commands.map((command) => (
                    <div key={command.id} style={compactRowStyle}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{command.label}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{command.tool}</div>
                      </div>
                      <StatusPill
                        label={command.status}
                        tone={command.status === 'passed' ? 'good' : command.status === 'failed' ? 'warning' : 'default'}
                      />
                    </div>
                  ))}
                </>
              ) : null}
              {healingAttempts.length ? (
                healingAttempts.slice(0, 3).map((attempt) => (
                  <div key={`${attempt.attempt}-${attempt.createdAt}`} style={compactRowStyle}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Healing attempt {attempt.attempt}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {attempt.failedFiles.join(', ') || 'No file ownership recorded'}
                      </div>
                    </div>
                    <StatusPill label={attempt.ok ? 'recovered' : 'retry'} tone={attempt.ok ? 'good' : 'warning'} />
                  </div>
                ))
              ) : null}
            </div>
          ) : (
            <EmptyState message="Validation artifacts appear here after build, typecheck, or lint runs." />
          )}
        </section>

        <section style={subtleCardStyle}>
          <div className="mono" style={sectionLabelStyle}>RUN HISTORY</div>
          {activeProjectRuns.length ? (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {activeProjectRuns.map((run) => (
                <div key={run.id} style={compactRowStyle}>
                  <div style={{ display: 'grid', gap: '0.2rem' }}>
                    <strong style={{ fontSize: '0.9rem' }}>{run.title}</strong>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{run.summary || run.error || run.status}</div>
                  </div>
                  <StatusPill label={run.status} tone={run.status === 'completed' ? 'good' : run.status.startsWith('failed') ? 'warning' : 'info'} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="Planner, builder, validation, and deployment runs will appear here." />
          )}
        </section>
      </div>
    );

  return (
    <section
      style={{
        display: 'flex',
        gap: '0.9rem',
        flex: '1 1 0',
        alignItems: 'stretch',
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        overflow: 'hidden',
      }}
    >
      <section className="glass-card" style={chatRailStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', paddingBottom: '0.55rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gap: '0.18rem' }}>
            <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              CHAT
            </div>
            <strong style={{ fontSize: '0.98rem', lineHeight: 1.22, fontWeight: 600 }}>{selectedProject?.name || brief?.titleOverride || 'Describe the app you want'}</strong>
          </div>
          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={onOpenBriefEditor} style={compactActionButtonStyle}>
              Brief
            </button>
            <StatusPill label={workspaceStage} tone={hasProject ? 'info' : 'default'} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', paddingBottom: '0.15rem' }}>
          {workspaceActions.slice(0, 2).map((action) => (
            <button
              key={action.id}
              className={action.emphasis === 'primary' ? 'btn-primary' : 'btn-ghost'}
              onClick={() => onAction(action)}
              disabled={Boolean(action.disabled) || Boolean(busyAction)}
              title={action.reason || undefined}
              style={compactActionButtonStyle}
            >
              {action.label.toUpperCase()}
            </button>
          ))}
          <button className="btn-ghost" onClick={onRefresh} disabled={Boolean(busyAction)} style={compactActionButtonStyle}>REFRESH</button>
          <button className="btn-ghost" onClick={onOpenLivePreview} disabled={!hasProject} style={compactActionButtonStyle}>PREVIEW</button>
        </div>

        <div ref={chatViewportRef} style={chatViewportStyle}>
          {contextLoading ? (
            <EmptyState message="Loading builder conversation..." />
          ) : conversation?.messages.length ? (
            conversation.messages.map((message) => <MessageBubble key={message.id} message={message} />)
          ) : (
            <EmptyState message="Start with a natural prompt. RawClaw stays conversational here until you explicitly plan or build." />
          )}
        </div>

        <div style={{ display: 'grid', gap: '0.8rem' }}>
          {showStarterPrompts ? (
            <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
              {STARTER_PROMPTS.map((prompt) => (
                <button key={prompt} className="btn-ghost" onClick={() => onStarterPrompt(prompt)} style={{ textAlign: 'left' }}>
                  {prompt}
                </button>
              ))}
            </div>
          ) : workspaceActions.length > 2 || showRetryAction ? (
            <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
              {workspaceActions.slice(2).map((action) => (
                <button
                  key={action.id}
                  className={action.emphasis === 'primary' ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => onAction(action)}
                  disabled={Boolean(action.disabled) || Boolean(busyAction)}
                  title={action.reason || undefined}
                  style={compactActionButtonStyle}
                >
                  {action.label}
                </button>
              ))}
              {showRetryAction ? (
                <button className="btn-ghost" onClick={onRetry} disabled={Boolean(busyAction)} style={compactActionButtonStyle}>
                  Retry last request
                </button>
              ) : null}
            </div>
          ) : null}

          <div style={activeComposerShellStyle}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={async (event) => {
                await onAttachmentSelection(event.target.files);
                event.target.value = '';
              }}
            />
            {attachments.length ? (
              <div style={attachmentTrayStyle}>
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.filename}-${index}`} style={attachmentChipStyle}>
                    <FiFileText size={13} />
                    <span>{attachment.filename}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder={
                hasProject
                  ? 'Refine the brief, ask RawClaw to generate, validate, deploy, register, or approve the project...'
                  : 'Keep refining the brief, ask for research, or explicitly tell RawClaw to create a plan or start building.'
              }
              style={activeComposerInputStyle}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                {!hasProject ? (
                  <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    RawClaw is still gathering the brief. Nothing is queued until you explicitly start planning or generation.
                  </div>
                ) : null}
                {attachmentError ? <div style={{ color: 'var(--error)', fontSize: '0.82rem' }}>{attachmentError}</div> : null}
                {showEmojiPicker ? (
                  <div style={emojiPickerStyle}>
                    {EMOJI_OPTIONS.map((emoji) => (
                      <button key={emoji} onClick={() => appendEmoji(emoji)} style={emojiButtonStyle}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn-ghost" onClick={() => fileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FiPlus />
                </button>
                <ComposerModeButtons value={composerAction} onChange={setComposerAction} />
                <button className="btn-ghost" onClick={onToggleEmoji} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FiSmile />
                  Emoji
                </button>
                <button
                  className="btn-primary"
                  onClick={onSend}
                  disabled={submitDisabled}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
                >
                  <FiSend />
                  {busyAction ? 'Working...' : primaryLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-card" style={workspacePanelStyle}>
        <div style={workspaceToolbarStyle}>
        <div style={{ display: 'grid', gap: '0.2rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              WORKSPACE
            </div>
            <strong style={{ fontSize: '1.02rem', fontWeight: 600 }}>{selectedProject?.name || brief?.titleOverride || 'Workspace will wake up here'}</strong>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.45, fontSize: '0.84rem' }}>{workspaceSummary}</span>
          </div>

          <div style={{ display: 'flex', gap: '0.15rem', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
            {workspaceTabs.map((tab) => (
              <button
                key={tab.id}
                className={effectiveWorkspaceTab === tab.id ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setWorkspaceTab(tab.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  borderRadius: 0,
                  borderBottom: effectiveWorkspaceTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  padding: '0.45rem 0.8rem',
                  color: effectiveWorkspaceTab === tab.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                  background: 'transparent',
                }}
              >
                {tab.icon}
                {tab.label.toUpperCase()}
              </button>
            ))}
            <button className="btn-ghost" onClick={onRefresh} disabled={Boolean(busyAction)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.7rem' }}>
              <FiRefreshCw />
              Refresh
            </button>
            <button className="btn-ghost" onClick={onOpenLivePreview} disabled={!hasProject} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.7rem' }}>
              <FiArrowUpRight />
              Open in Live Preview
            </button>
          </div>
        </div>

        <div style={workspaceContentFrameStyle}>
          {workspaceContent}
        </div>
        {/* legacy workspace block hidden
          <div style={previewCanvasStyle}>
            {preview.status === 'ready' && preview.url ? (
              <iframe title="App Builder preview" src={preview.url} style={previewFrameStyle} />
            ) : (
              <div style={previewPlaceholderStyle}>
                <div style={{ display: 'grid', gap: '0.65rem', maxWidth: '580px' }}>
                  <StatusPill label={workspaceStage} tone={hasProject ? 'info' : 'default'} />
                  <h2 style={{ fontSize: '1.45rem', margin: 0 }}>{preview.title}</h2>
                  <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65 }}>{preview.summary}</p>
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    <DetailRow label="Current stage" value={workspaceStage} />
                    <DetailRow label="Next action" value={workspaceActions[0]?.label || 'Keep refining the brief'} />
                    <DetailRow
                      label="System summary"
                      value={selectedProject?.managedPath || latestPreviewSession?.servedPath || preview.projectPath || 'No managed project yet'}
                      mono
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : workspaceTab === 'project' ? (
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            <section style={subtleCardStyle}>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>CURRENT BUILD STATE</div>
              <div style={{ display: 'grid', gap: '0.55rem' }}>
                <DetailRow label="Project" value={selectedProject?.name || brief?.titleOverride || 'Draft brief'} />
                <DetailRow label="Status" value={selectedProject ? humanizeStatus(selectedProject.status) : 'briefing'} />
                <DetailRow label="Approval stop" value={detail?.approvalGate?.stage ? `Awaiting ${detail.approvalGate.stage} approval` : 'No pending approval stop'} />
                <DetailRow label="Template" value={activeTemplate?.name || selectedProject?.templateId || 'Auto'} />
                <DetailRow label="Managed path" value={selectedProject?.managedPath || 'Pending'} mono />
                <DetailRow label="Latest validation" value={formatValidationState(detail?.latestValidation)} />
              </div>
            </section>

            {(selectedProject?.metadata?.plannerReviewSummary || selectedProject?.metadata?.lastBuilderBriefSummary) ? (
              <section style={subtleCardStyle}>
                <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>MODEL LANES</div>
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  {selectedProject?.metadata?.plannerReviewSummary ? (
                    <div style={{ display: 'grid', gap: '0.35rem' }}>
                      <DetailRow label="Planner model" value={String(selectedProject.metadata?.plannerReviewModel || 'default planner route')} mono />
                      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {String(selectedProject.metadata.plannerReviewSummary)}
                      </div>
                    </div>
                  ) : null}
                  {selectedProject?.metadata?.lastBuilderBriefSummary ? (
                    <div style={{ display: 'grid', gap: '0.35rem' }}>
                      <DetailRow label="Build model" value={String(selectedProject.metadata?.lastBuilderBriefModel || 'default build route')} mono />
                      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {String(selectedProject.metadata.lastBuilderBriefSummary)}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section style={subtleCardStyle}>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>MANAGED CODE REPO</div>
              {selectedProject ? (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  <DetailRow label="Repo root" value={selectedProject.managedPath || 'Not created yet'} mono />
                  <DetailRow label="Deploy snapshot" value={selectedProject.deployPath || 'Not deployed'} mono />
                  <DetailRow label="Export bundle" value={selectedProject.exportPath || 'Not exported'} mono />
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>Tracked files</div>
                    {(latestFileGraph?.files?.length
                      ? latestFileGraph.files.slice(0, 10).map((file) => `${file.path} — ${file.purpose}`)
                      : (activeTemplate?.generatedFiles || []).slice(0, 10).map((file) => `${file} — starter blueprint`)).length ? (
                      <div style={{ display: 'grid', gap: '0.4rem' }}>
                        {(latestFileGraph?.files?.length
                          ? latestFileGraph.files.slice(0, 10).map((file) => `${file.path} — ${file.purpose}`)
                          : (activeTemplate?.generatedFiles || []).slice(0, 10).map((file) => `${file} — starter blueprint`)).map((entry) => (
                          <div key={entry} className="mono" style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                            {entry}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        RawClaw will list generated files here after planning and generation start wiring the managed repo.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState message="The managed code repo appears here once a builder project exists." />
              )}
            </section>

            <section style={subtleCardStyle}>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>STRUCTURED SPEC</div>
              {latestSpec ? (
                <div style={{ display: 'grid', gap: '0.55rem' }}>
                  <div style={{ fontWeight: 700 }}>{latestSpec.summary}</div>
                  <DetailRow label="Domain" value={latestSpec.domain} />
                  <DetailRow label="Routes" value={latestSpec.routes.map((route) => route.path).join(', ') || 'None'} mono />
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Features: {latestSpec.features.join(', ') || 'No features captured yet.'}
                  </div>
                </div>
              ) : (
                <EmptyState message="The spec artifact will appear here after planning completes." />
              )}
            </section>

            <section style={subtleCardStyle}>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>ARCHITECTURE + FILE GRAPH</div>
              {latestArchitecture || latestFileGraph ? (
                <div style={{ display: 'grid', gap: '0.55rem' }}>
                  {latestArchitecture ? (
                    <>
                      <DetailRow label="Framework" value={`${latestArchitecture.framework} / ${latestArchitecture.language}`} />
                      <DetailRow label="Build" value={`${latestArchitecture.buildTool} / ${latestArchitecture.previewStrategy}`} />
                      <DetailRow label="SDK transport" value={latestArchitecture.sdkTransport} />
                    </>
                  ) : null}
                  {latestFileGraph ? (
                    <>
                      <DetailRow label="Files" value={String(latestFileGraph.files.length)} />
                      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        Generation order: {latestFileGraph.generationOrder.slice(0, 5).join(', ')}
                        {latestFileGraph.generationOrder.length > 5 ? ' ...' : ''}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <EmptyState message="Architecture and file graph appear after planning moves into generation." />
              )}
            </section>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            <section style={subtleCardStyle}>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>LOG STREAM</div>
              {logEntries.length ? (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  {logEntries.map((entry) => (
                    <div key={entry.id} style={compactRowStyle}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{entry.label}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{entry.summary}</div>
                      </div>
                      <StatusPill label={entry.status} tone={entry.tone} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="Logs will appear here once generation, validation, or preview activity begins." />
              )}
            </section>

            <section style={subtleCardStyle}>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>VALIDATION + HEALING</div>
              {latestValidationSession || healingAttempts.length ? (
                <div style={{ display: 'grid', gap: '0.65rem' }}>
                  {latestValidationSession ? (
                    <>
                      <DetailRow label="Attempts" value={String(latestValidationSession.attempts)} />
                      {latestValidationSession.commands.map((command) => (
                        <div key={command.id} style={compactRowStyle}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{command.label}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{command.tool}</div>
                          </div>
                          <StatusPill
                            label={command.status}
                            tone={command.status === 'passed' ? 'good' : command.status === 'failed' ? 'warning' : 'default'}
                          />
                        </div>
                      ))}
                    </>
                  ) : null}
                  {healingAttempts.length ? (
                    healingAttempts.slice(0, 3).map((attempt) => (
                      <div key={`${attempt.attempt}-${attempt.createdAt}`} style={compactRowStyle}>
                        <div>
                          <div style={{ fontWeight: 700 }}>Healing attempt {attempt.attempt}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                            {attempt.failedFiles.join(', ') || 'No file ownership recorded'}
                          </div>
                        </div>
                        <StatusPill label={attempt.ok ? 'recovered' : 'retry'} tone={attempt.ok ? 'good' : 'warning'} />
                      </div>
                    ))
                  ) : null}
                </div>
              ) : (
                <EmptyState message="Validation artifacts appear here after build, typecheck, or lint runs." />
              )}
            </section>
          </div>
        */}

        {!hasProject && projectList.length ? (
          <section style={subtleCardStyle}>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.55rem' }}>CONTINUE A PROJECT</div>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {projectList.slice(0, 4).map((project) => (
                <section key={project.id} style={projectCardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{project.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {humanizeAppType(project.appType)} / {humanizeControlMode(project.controlMode)}
                      </div>
                    </div>
                    <StatusPill label={humanizeStatus(project.status)} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.55rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                    <button className="btn-ghost" onClick={() => onResumeProject(project.id)} style={compactActionButtonStyle}>
                      Open
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => onDeleteProject(project.id)}
                      disabled={deletingProjectId === project.id}
                      style={destructiveActionButtonStyle}
                    >
                      {deletingProjectId === project.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </section>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </section>
  );
}

function LivePreviewPage({
  selectedProject,
  detail,
  preview,
  busyAction,
  contextLoading,
  onRefresh,
  onOpenBuilder,
}: {
  selectedProject: AppBuilderProject | null;
  detail: AppBuilderProjectDetail | null;
  preview: AppBuilderPreviewState;
  busyAction: string | null;
  contextLoading: boolean;
  onRefresh: () => void;
  onOpenBuilder: () => void;
}) {
  if (!selectedProject) {
    return (
      <ModeEmptyState
        title="Live Preview unlocks after a project exists"
        description="Create or continue a builder project first, then open Live Preview when RawClaw has something to show."
        onGoBack={onOpenBuilder}
      />
    );
  }

  return (
    <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Live Preview</h2>
          <div style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            {detail?.project.name || selectedProject.name} / {humanizeStatus(detail?.project.status || selectedProject.status)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={onRefresh} disabled={Boolean(busyAction)}>
            {busyAction === 'refresh' ? 'Refreshing...' : 'Refresh preview'}
          </button>
        </div>
      </div>

      <div style={previewCanvasStyle}>
        {contextLoading ? (
          <EmptyState message="Loading live preview..." />
        ) : preview.status === 'ready' && preview.url ? (
          <iframe title="App Builder preview" src={preview.url} style={{ ...previewFrameStyle, height: '78vh' }} />
        ) : (
          <div style={previewPlaceholderStyle}>
            <div style={{ display: 'grid', gap: '0.7rem', maxWidth: '620px' }}>
              <StatusPill label={humanizeStatus(detail?.project.status || selectedProject.status)} tone="info" />
              <h2 style={{ fontSize: '1.45rem', margin: 0 }}>{preview.title}</h2>
              <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65 }}>{preview.summary}</p>
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                <DetailRow label="Project path" value={preview.projectPath || selectedProject.managedPath || 'Pending'} mono />
                <DetailRow label="Preview URL" value={preview.url || 'Not active yet'} mono />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectsPage({
  projects,
  selectedProjectId,
  contextLoading,
  onOpenBuilder,
  onOpenPreview,
  onOpenConsole,
  onDeleteProject,
  deletingProjectId,
}: {
  projects: AppBuilderProject[];
  selectedProjectId: string | null;
  contextLoading: boolean;
  onOpenBuilder: (projectId: string) => void;
  onOpenPreview: (projectId: string) => void;
  onOpenConsole: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  deletingProjectId: string | null;
}) {
  return (
    <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Projects</h2>
          <div style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Resume a build, jump into preview, or open the technical console without crowding the main Builder page.
          </div>
        </div>
      </div>

      {contextLoading && !projects.length ? (
        <EmptyState message="Loading App Builder projects..." />
      ) : projects.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem' }}>
          {projects.map((project) => (
            <section
              key={project.id}
              style={{
                ...subtleCardStyle,
                borderColor: selectedProjectId === project.id ? 'rgba(95,225,255,0.45)' : 'var(--border-glass)',
              }}
            >
              <div style={{ display: 'grid', gap: '0.7rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{project.name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {humanizeAppType(project.appType)} / {humanizeControlMode(project.controlMode)}
                    </div>
                  </div>
                  <StatusPill label={humanizeStatus(project.status)} />
                </div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {project.description || 'No description captured yet.'}
                </div>
                <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                  <button className="btn-primary" onClick={() => onOpenBuilder(project.id)}>Open Builder</button>
                  <button className="btn-ghost" onClick={() => onOpenPreview(project.id)}>Preview</button>
                  <button className="btn-ghost" onClick={() => onOpenConsole(project.id)}>Console</button>
                  <button
                    className="btn-ghost"
                    onClick={() => onDeleteProject(project.id)}
                    disabled={deletingProjectId === project.id}
                    style={destructiveActionButtonStyle}
                  >
                    {deletingProjectId === project.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState message="No App Builder projects yet. Start in Builder and send the first prompt." />
      )}
    </section>
  );
}

function ConsolePage({
  selectedProject,
  detail,
  preview,
  registryRecords,
  runs,
  actions,
  onAction,
  busyAction,
  onOpenBuilder,
}: {
  selectedProject: AppBuilderProject | null;
  detail: AppBuilderProjectDetail | null;
  preview: AppBuilderPreviewState;
  registryRecords: AppRegistryRecord[];
  runs: AppBuilderRun[];
  actions: AppBuilderSuggestedAction[];
  onAction: (action: AppBuilderSuggestedAction) => void;
  busyAction: string | null;
  onOpenBuilder: () => void;
}) {
  if (!selectedProject) {
    return (
      <ModeEmptyState
        title="Console unlocks after a project exists"
        description="Create or continue a builder project first, then use Console for registry, deployment, and control depth."
        onGoBack={onOpenBuilder}
      />
    );
  }

  return (
    <section style={{ display: 'grid', gap: '1rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Registry And Control</h2>
          <div style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Deep runtime view for deployment, registry, endpoints, and control actions.
          </div>
        </div>
      </div>

        <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
          {actions.map((action) => (
            <button
              key={action.id}
              className={action.emphasis === 'primary' ? 'btn-primary' : 'btn-ghost'}
              onClick={() => onAction(action)}
              disabled={Boolean(action.disabled) || Boolean(busyAction)}
              title={action.reason || undefined}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.9fr)', gap: '1rem', alignItems: 'start' }}>
        <Panel title="Deployment State">
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            <DetailRow label="Status" value={humanizeStatus(detail?.project.status || selectedProject.status)} />
            <DetailRow label="Managed path" value={selectedProject.managedPath || 'Pending'} mono />
            <DetailRow label="Deploy path" value={selectedProject.deployPath || 'Not deployed'} mono />
            <DetailRow label="Preview URL" value={preview.url || 'No live preview yet'} mono />
          </div>
        </Panel>

        <Panel title="Recent Runs">
          {runs.length ? (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {runs.slice(0, 6).map((run) => (
                <div key={run.id} style={compactRowStyle}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{humanizePhase(run.phase)}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {run.summary || run.error || run.status}
                    </div>
                  </div>
                  <StatusPill label={humanizeStatus(run.status)} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="Builder runs will appear here once RawClaw starts queuing work." />
          )}
        </Panel>
      </div>

      <Panel title="App Registry">
        {registryRecords.length ? (
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            {registryRecords.map((record) => (
              <div key={record.id} style={subtleCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{record.appId}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{record.version}</div>
                  </div>
                  <StatusPill label={record.status} tone={record.healthStatus === 'healthy' ? 'good' : 'warning'} />
                </div>
                <div style={{ display: 'grid', gap: '0.55rem' }}>
                  <DetailRow label="Control" value={record.controlEndpoint} mono />
                  <DetailRow label="Events" value={record.eventStreamEndpoint} mono />
                  <DetailRow label="Deploy" value={record.deploymentLocation || 'Pending'} mono />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No App Builder registry records are available yet." />
        )}
      </Panel>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: '0.35rem' }}>
      <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
      <h2 style={{ fontSize: '1.02rem', margin: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function ComposerModeButtons({ value, onChange }: { value: ComposerAction; onChange: (value: ComposerAction) => void }) {
  const options: Array<{ value: ComposerAction; label: string; title: string }> = [
    { value: 'discuss', label: 'Chat', title: 'Talk through the brief without starting work.' },
    { value: 'plan', label: 'Plan', title: 'Turn the brief into a project plan.' },
    { value: 'build', label: 'Build', title: 'Start generating or advancing the app.' },
  ];

  return (
    <div role="group" aria-label="Builder action" style={composerModeGroupStyle}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            style={active ? composerModeButtonActiveStyle : composerModeButtonStyle}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({ message }: { message: AppBuilderMessage }) {
  const isUser = message.role === 'user';
  const tone = message.tone || 'default';
  const timestamp = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const showWorkflowDetails = Boolean(
    (!isUser && message.meta && message.tone !== 'error')
    || message.modelId
    || message.provenanceSummary
    || message.researchSummary
    || message.toolSummary,
  );
  const shellStyle = isUser
    ? userBubbleStyle
    : tone === 'success'
      ? assistantSuccessStyle
      : tone === 'warning' || tone === 'error'
        ? assistantWarningStyle
        : assistantBubbleStyle;

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={shellStyle}>
        <div style={messageMetaRowStyle}>
          <span style={messageAuthorStyle}>
            {isUser ? 'You' : 'RawClaw'}
          </span>
          <span style={messageTimestampStyle}>
            {timestamp}
          </span>
        </div>
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.9rem' }}>{message.content}</div>
        ) : (
          <div className="markdown-content" style={{ lineHeight: 1.7, fontSize: '0.9rem' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.attachments?.length ? (
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
            {message.attachments.map((attachment, index) => (
              <div key={`${attachment.filename}-${index}`} style={attachmentChipStyle}>
                <FiFileText size={13} />
                <span>{attachment.filename}</span>
              </div>
            ))}
          </div>
        ) : null}
        {showWorkflowDetails ? (
          <details style={{ marginTop: '0.7rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.74rem' }}>Workflow details</summary>
            <div style={{ display: 'grid', gap: '0.28rem', marginTop: '0.55rem' }}>
              {!isUser && message.meta && message.tone !== 'error' ? (
                <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  workflow: {message.meta}
                </div>
              ) : null}
              {message.modelId ? (
                <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  model: {message.modelId}
                </div>
              ) : null}
              {message.toolSummary ? (
                <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  tools: {message.toolSummary}
                </div>
              ) : null}
              {message.provenanceSummary ? (
                <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  provenance: {message.provenanceSummary}
                </div>
              ) : null}
              {message.researchSummary ? (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  {message.researchSummary}
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
        {message.tone === 'error' && message.meta ? (
          <details style={{ marginTop: '0.8rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Debug details</summary>
            <div className="mono" style={{ marginTop: '0.45rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {message.meta}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function BriefChip({
  label,
  value,
  onClick,
  compact = false,
}: {
  label: string;
  value?: string | null;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button onClick={onClick} style={compact ? compactBriefChipStyle : briefChipStyle}>
      <span className="mono" style={compact ? compactBriefChipLabelStyle : briefChipLabelStyle}>{label}</span>
      <span style={compact ? compactBriefChipValueStyle : briefChipValueStyle}>{value || 'Set'}</span>
      <FiEdit3 size={compact ? 12 : 14} color="var(--text-muted)" />
    </button>
  );
}

function RouteChip({ label, value }: { label: string; value: string }) {
  return (
    <Link to="/models" style={routeChipStyle}>
      <span className="mono" style={routeChipLabelStyle}>{label}</span>
      <span style={routeChipValueStyle}>{value}</span>
    </Link>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.08em' }}>{label}</span>
      <span
        className={mono ? 'mono' : undefined}
        style={{ textAlign: 'right', color: 'var(--text-primary)', overflowWrap: 'anywhere', fontSize: '0.9rem', lineHeight: 1.55, maxWidth: '68%' }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function StatusPill({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'good' | 'warning' | 'info';
}) {
  const palette =
    tone === 'good'
      ? { background: '#0a2010', border: '#1a4020', color: 'var(--accent-glow)' }
      : tone === 'warning'
        ? { background: 'rgba(255,183,0,0.08)', border: 'rgba(255,183,0,0.24)', color: '#ffd27a' }
        : tone === 'info'
          ? { background: 'rgba(0,180,216,0.12)', border: 'var(--border-accent)', color: 'var(--accent-primary)' }
          : { background: 'rgba(255,255,255,0.03)', border: 'var(--border)', color: 'var(--text-secondary)' };
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.2rem 0.5rem',
        borderRadius: '4px',
        background: palette.background,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        fontSize: '0.68rem',
        letterSpacing: '0.08em',
        textTransform: 'lowercase',
      }}
    >
      {tone === 'good' ? <FiCheckCircle size={13} /> : tone === 'warning' ? <FiAlertTriangle size={13} /> : null}
      {label}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ ...subtleCardStyle, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      {message}
    </div>
  );
}

function DashboardStatCard({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="glass-card" style={{ ...subtleCardStyle, display: 'grid', gap: '0.28rem', padding: '0.85rem 0.9rem' }}>
      <div className="mono" style={{ fontSize: '0.64rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.12rem', fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{meta}</div>
    </div>
  );
}

function ModeEmptyState({
  title,
  description,
  onGoBack,
}: {
  title: string;
  description: string;
  onGoBack: () => void;
}) {
  return (
    <section className="glass-card" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: '540px', textAlign: 'center', display: 'grid', gap: '0.85rem' }}>
        <h2 style={{ fontSize: '1.4rem', margin: 0 }}>{title}</h2>
        <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{description}</p>
        <div>
          <button className="btn-primary" onClick={onGoBack}>Go back to Builder</button>
        </div>
      </div>
    </section>
  );
}

function assistantModeForPage(page: AppBuilderPage, hasProject: boolean): AppBuilderMode {
  if (page === 'console') return 'console';
  if (page === 'builder') return hasProject ? 'workspace' : 'chat';
  return 'workspace';
}

function shouldRevealBuilderWorkspace(
  detail: AppBuilderProjectDetail | null,
  preview: AppBuilderPreviewState | null,
): boolean {
  if (!detail) return false;
  if (detail.docs?.length) return true;
  if (detail.taskList?.tasks?.length) return true;
  if (detail.activity?.length) return true;
  if (detail.artifacts?.length) return true;
  if (detail.fileTree?.tree?.length) return true;
  if (detail.terminal?.commands?.length) return true;
  if (detail.runs?.length) return true;
  if (detail.previewConnection && detail.previewConnection.source !== 'none') return true;
  if (preview && preview.status !== 'empty') return true;
  return false;
}

function isComposerAction(value: string | null): value is ComposerAction {
  return value === 'discuss' || value === 'plan' || value === 'build';
}

function isWorkspaceTab(value: string | null | undefined): value is WorkspaceTab {
  return value === 'activity' || value === 'preview' || value === 'files' || value === 'docs' || value === 'terminal' || value === 'logs' || value === 'project';
}

function firstFilePath(nodes: WorkspaceFileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.path;
    }
    if (node.children?.length) {
      const childPath = firstFilePath(node.children);
      if (childPath) return childPath;
    }
  }
  return null;
}

function composerActionLabel(action: ComposerAction): string {
  switch (action) {
    case 'discuss':
      return 'Send';
    case 'plan':
      return 'Plan';
    case 'build':
      return 'Build';
    default:
      return 'Send';
  }
}

function resolveRoutePage(pathname: string): AppBuilderPage {
  if (pathname.startsWith('/app-builder/live-preview')) return 'live-preview';
  if (pathname.startsWith('/app-builder/projects')) return 'projects';
  if (pathname.startsWith('/app-builder/console')) return 'console';
  return 'builder';
}

function routePageMeta(page: AppBuilderPage): { eyebrow: string; title: string; description: string } {
  switch (page) {
    case 'live-preview':
      return {
        eyebrow: 'LIVE PREVIEW',
        title: 'Live Preview',
        description: 'Focus on the generated app and keep the Builder itself free of oversized preview chrome.',
      };
    case 'projects':
      return {
        eyebrow: 'PROJECTS',
        title: 'Projects',
        description: 'Browse, resume, and switch builder projects without crowding the main conversation workspace.',
      };
    case 'console':
      return {
        eyebrow: 'CONSOLE',
        title: 'Console',
        description: 'Inspect registry, deployment, endpoints, and runtime control details when you need operational depth.',
      };
    default:
      return {
        eyebrow: 'BUILDER',
        title: 'Builder',
        description: 'Chat on the left, watch the workspace evolve on the right, and keep the conversation flowing while RawClaw builds with you.',
      };
  }
}

function sanitizeConversation(conversation: AppBuilderConversation): AppBuilderConversation {
  return {
    ...conversation,
    messages: conversation.messages.map(sanitizeBuilderMessage),
  };
}

function sanitizeTerminalText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function detectPreviewUrlFromTerminalOutput(value: string | null | undefined): string | null {
  const text = sanitizeTerminalText(value);
  const match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)(?:[^\s]*)?/i);
  return match ? match[0] : null;
}

function extractPortFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.port || null;
  } catch {
    return null;
  }
}

function sanitizeBuilderMessage(message: AppBuilderMessage): AppBuilderMessage {
  const content = message.content || '';
  if (message.role !== 'assistant' && message.role !== 'system') {
    return message;
  }
  if (/request failed with status code\s*\d+/i.test(content) || /^Request failed with status code/i.test(content.trim())) {
    return {
      ...message,
      tone: 'error',
      content: "I couldn't complete that builder step. Nothing was deployed or registered from this failed request.",
      meta: message.meta || content,
    };
  }
  return message;
}

function approvalStage(detail: AppBuilderProjectDetail | null): AppBuilderApprovalStage | null {
  return detail?.approvalGate?.stage || null;
}

function buildLocalSuggestedActions(detail: AppBuilderProjectDetail | null): AppBuilderSuggestedAction[] {
  if (!detail) return [];
  const actions: AppBuilderSuggestedAction[] = [];
  const pendingStage = approvalStage(detail);
  if (pendingStage) {
    actions.push({ id: 'approve', label: `Approve ${pendingStage}`, kind: 'approve', emphasis: 'primary' });
  }
  switch (detail.project.status) {
    case 'draft':
    case 'planned':
      actions.push({ id: 'generate', label: 'Build first version', kind: 'phase', phase: 'generate', emphasis: 'primary' });
      actions.push({ id: 'plan', label: 'Re-plan', kind: 'phase', phase: 'plan', emphasis: 'ghost' });
      break;
    case 'approval_required':
      if (pendingStage === 'plan') {
        actions.push({ id: 'plan', label: 'Revise plan', kind: 'phase', phase: 'plan', emphasis: 'ghost' });
        break;
      }
      if (pendingStage === 'build') {
        actions.push({ id: 'generate', label: 'Revise build', kind: 'phase', phase: 'generate', emphasis: 'ghost' });
        break;
      }
      if (pendingStage === 'validate') {
        actions.push({ id: 'validate', label: 'Retry validation', kind: 'phase', phase: 'validate', emphasis: 'ghost' });
        break;
      }
      if (pendingStage === 'deploy') {
        actions.push({ id: 'deploy', label: 'Retry deploy', kind: 'phase', phase: 'deploy', emphasis: 'ghost' });
        break;
      }
      if (pendingStage === 'register') {
        actions.push({ id: 'register', label: 'Retry register', kind: 'phase', phase: 'register', emphasis: 'ghost' });
        break;
      }
      actions.push({ id: 'validate', label: 'Validate', kind: 'phase', phase: 'validate', emphasis: 'primary' });
      break;
    case 'generating':
    case 'integrating':
    case 'deployment_ready':
      actions.push({ id: 'validate', label: 'Run validation', kind: 'phase', phase: 'validate', emphasis: 'primary' });
      actions.push({ id: 'deploy', label: 'Deploy locally', kind: 'phase', phase: 'deploy', emphasis: 'ghost' });
      break;
    case 'deployed':
      actions.push({ id: 'register', label: 'Register', kind: 'phase', phase: 'register', emphasis: 'primary' });
      break;
    case 'registered':
      actions.push({ id: 'control-test', label: 'Control test', kind: 'phase', phase: 'control-test', emphasis: 'primary' });
      actions.push({ id: 'export', label: 'Export', kind: 'phase', phase: 'export', emphasis: 'ghost' });
      break;
    default:
      actions.push({ id: 'plan', label: 'Plan', kind: 'phase', phase: 'plan', emphasis: 'primary' });
      actions.push({ id: 'validate', label: 'Validate', kind: 'phase', phase: 'validate', emphasis: 'ghost' });
      break;
  }
  actions.push({ id: 'refresh', label: 'Refresh', kind: 'refresh', emphasis: 'ghost' });
  actions.push({ id: 'console', label: 'Console', kind: 'open_mode', mode: 'console', emphasis: 'ghost' });
  return actions;
}

function promptForPhase(phase?: AppBuilderPhase | null): string {
  switch (phase) {
    case 'plan':
      return 'create a plan';
    case 'generate':
      return 'generate the first version';
    case 'validate':
      return 'run validation';
    case 'deploy':
      return 'deploy locally';
    case 'register':
      return 'register it in RawClaw';
    case 'control-test':
      return 'run a control test';
    case 'export':
      return 'export the project';
    default:
      return 'start build';
  }
}

function resolveBuilderRouteValue(
  routes: ModelsHealthResponse['routing'] | AppBuilderProjectDetail['modelRoutes'] | null | undefined,
  lane: 'chat' | 'planner' | 'build',
): string {
  if (!routes) return 'default';
  if (lane === 'chat') return (routes as any).chat || (routes as any).appBuilder || 'default';
  if (lane === 'planner') return (routes as any).planner || (routes as any).appBuilderPlanner || 'default';
  return (routes as any).build || (routes as any).appBuilderBuilder || 'default';
}

function inferTemplateName(templates: AppBuilderTemplate[], templateId?: string | null): string {
  if (!templateId) return 'Auto';
  return templates.find((template) => template.id === templateId)?.name || 'Auto';
}

function buildWorkspaceLogEntries(
  preview: AppBuilderPreviewState,
  runs: AppBuilderRun[],
  validationSession: ValidationSession | null,
): Array<{ id: string; label: string; summary: string; status: string; tone: 'default' | 'good' | 'warning' | 'info' }> {
  const previewLogs: Array<{ id: string; label: string; summary: string; status: string; tone: 'default' | 'good' | 'warning' | 'info' }> = (preview.logs || []).map((line, index) => ({
    id: `preview-log-${index}`,
    label: 'Preview',
    summary: line,
    status: preview.status,
    tone: preview.status === 'ready' ? 'good' : preview.status === 'fallback' ? 'info' : 'default',
  }));
  const runLogs: Array<{ id: string; label: string; summary: string; status: string; tone: 'default' | 'good' | 'warning' | 'info' }> = runs.slice(0, 5).map((run) => ({
    id: run.id,
    label: humanizePhase(run.phase),
    summary: run.summary || run.error || run.status,
    status: humanizeStatus(run.status),
    tone: run.status === 'completed' ? 'good' : run.status.startsWith('failed_') ? 'warning' : 'default',
  }));
  const validationLogs: Array<{ id: string; label: string; summary: string; status: string; tone: 'default' | 'good' | 'warning' | 'info' }> = (validationSession?.commands || []).map((command) => ({
    id: command.id,
    label: command.label,
    summary: command.output || command.tool,
    status: command.status,
    tone: command.status === 'passed' ? 'good' : command.status === 'failed' ? 'warning' : 'default',
  }));
  return [...previewLogs, ...runLogs, ...validationLogs];
}

function latestArtifactPayload<T>(detail: AppBuilderProjectDetail, kind: AppBuilderArtifactKind): T | null {
  const artifact = detail.artifacts.find((entry) => entry.kind === kind);
  return artifact ? (artifact.payload as T) : null;
}

function listArtifactPayloads<T>(detail: AppBuilderProjectDetail, kind: AppBuilderArtifactKind): T[] {
  return detail.artifacts
    .filter((artifact) => artifact.kind === kind)
    .map((artifact) => artifact.payload as T);
}

function humanizeStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function humanizeAppType(value?: AppBuilderAppType | null): string {
  if (!value) return 'Unknown';
  return value === 'ai_tool' ? 'AI Tool' : 'Web App';
}

function humanizeSourceType(value?: string | null): string {
  if (!value) return 'Generated App';
  return value === 'imported' ? 'Imported Project' : 'Generated App';
}

function humanizeControlMode(value?: AppBuilderControlMode | null): string {
  return (value || 'assist_only').replace(/_/g, ' ');
}

function humanizePhase(phase: AppBuilderPhase): string {
  return phase.replace(/-/g, ' ');
}

function formatValidationState(validation: AppBuilderValidationResult | null | undefined): string {
  if (!validation) return 'Not run yet';
  return validation.ok ? 'Passed' : 'Needs fixes';
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function inferReferenceUploadKind(file: File): 'image' | 'document' | 'code_reference' {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/.test(name)) return 'image';
  if (/\.(ts|tsx|js|jsx|json|ya?ml|graphql|gql)$/.test(name)) return 'code_reference';
  return 'document';
}

function summarizeReferenceInfluence(value: Record<string, unknown>): string {
  const direct = value.references || value.referenceInfluence || value.files;
  if (Array.isArray(direct) && direct.length) {
    return direct.slice(0, 3).map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry).slice(0, 80)).join(', ');
  }
  const approach = typeof value.approach === 'string' ? value.approach : null;
  const assumptions = Array.isArray(value.assumptions) ? value.assumptions.slice(0, 2).join(', ') : null;
  return approach || assumptions || 'generation-level attribution recorded';
}

function makeErrorMessage(error: any): AppBuilderMessage {
  const status = error?.response?.status;
  const detail = extractErrorDetails(error);
  return {
    id: `assistant-error-${Date.now()}`,
    role: 'assistant',
    content: status
      ? `I couldn't complete that builder step because the service returned ${status}. Nothing was deployed or registered from this failed request.`
      : "I couldn't complete that builder step. Nothing was deployed or registered from this failed request.",
    createdAt: new Date().toISOString(),
    tone: 'error',
    meta: detail,
  };
}

function extractErrorDetails(error: any): string {
  const responseMessage =
    typeof error?.response?.data?.message === 'string'
      ? error.response.data.message.trim()
      : null;
  const genericMessage =
    typeof error?.message === 'string' && !/request failed with status code\s*\d+/i.test(error.message)
      ? error.message.trim()
      : null;
  const pieces = [responseMessage, genericMessage].filter(Boolean);
  return pieces.length ? pieces.join('\n') : 'Unknown builder error.';
}

function uploadErrorMessage(error: any): string {
  const code = error?.response?.data?.code || error?.response?.data?.errorCode;
  if (code === 'upload_rate_limit_unavailable') {
    return 'Upload processing is temporarily unavailable. Retry manually in a minute.';
  }
  if (code === 'upload_processing_rate_limited') {
    return 'Upload processing is rate limited. Retry manually after the current window clears.';
  }
  return extractErrorDetails(error);
}

const chatRailStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  flex: '0 0 clamp(380px, 30vw, 460px)',
  width: 'clamp(380px, 30vw, 460px)',
  minHeight: 0,
  height: '100%',
  maxHeight: '100%',
  overflow: 'hidden',
  alignSelf: 'stretch',
  background: 'var(--bg-surface)',
  borderColor: 'var(--border)',
  padding: '0.9rem',
};

const chatViewportStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 0',
  gap: '0.95rem',
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  scrollbarGutter: 'stable',
  paddingRight: '0.2rem',
  paddingBottom: '0.2rem',
};

const workspacePanelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  flex: '1 1 0',
  minHeight: 0,
  height: '100%',
  maxHeight: '100%',
  overflow: 'hidden',
  background: 'var(--bg-surface)',
  borderColor: 'var(--border)',
  padding: '0.9rem',
};

const workspaceContentFrameStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 0',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  scrollbarGutter: 'stable',
};

const workspaceToolbarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  paddingBottom: '0.75rem',
  borderBottom: '1px solid var(--border)',
};

const topBarActionStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.4rem 0.7rem',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const dashboardShellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  flex: '1 1 0',
  minHeight: 0,
  height: '100%',
  maxHeight: '100%',
  overflow: 'hidden',
};

const dashboardSummaryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '0.75rem',
  flex: '0 0 auto',
};

const dashboardBodyStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.45fr) minmax(320px, 0.95fr)',
  gap: '0.9rem',
  flex: '1 1 0',
  minHeight: 0,
  overflow: 'hidden',
};

const dashboardChatCardStyle: CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'auto auto minmax(0, 1fr) auto auto',
  gap: '0.75rem',
  minHeight: 0,
  overflow: 'hidden',
  padding: '0.95rem',
  background: 'var(--bg-surface)',
  borderColor: 'var(--border)',
};

const dashboardConversationStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.95rem',
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  scrollbarGutter: 'stable',
  paddingRight: '0.2rem',
};

const dashboardSideRailStyle: CSSProperties = {
  display: 'grid',
  minHeight: 0,
};

const dashboardRailCardStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  minHeight: 0,
  overflowY: 'auto',
  padding: '0.9rem',
  borderRadius: '6px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
};

const activeComposerShellStyle: CSSProperties = {
  display: 'grid',
  gap: '0.55rem',
  padding: '0.8rem',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  overflow: 'hidden',
};

const activeComposerInputStyle: CSSProperties = {
  width: '100%',
  minHeight: '60px',
  maxHeight: '120px',
  resize: 'none',
  overflowY: 'auto',
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontSize: '0.82rem',
  lineHeight: 1.6,
};

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};

const subtleCardStyle: CSSProperties = {
  padding: '0.9rem',
  borderRadius: '6px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
};

const compactRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.75rem',
  alignItems: 'flex-start',
  padding: '0.75rem 0.8rem',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.015)',
};

const sectionLabelStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.62rem',
  marginBottom: '0.55rem',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
};

const workspaceCanvasStyle: CSSProperties = {
  display: 'grid',
  minHeight: 0,
  height: '100%',
};

const workspaceGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.85rem',
  minHeight: 0,
  height: '100%',
  alignContent: 'start',
};

const fileWorkspaceStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '260px minmax(0, 1fr) minmax(260px, 0.8fr)',
  gap: '0.85rem',
  minHeight: 0,
  height: '100%',
};

const docsWorkspaceStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '260px minmax(0, 1fr) minmax(260px, 0.72fr)',
  gap: '0.85rem',
  minHeight: 0,
  height: '100%',
};

const fileTreeButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  width: '100%',
  textAlign: 'left',
  borderRadius: '4px',
  border: '1px solid transparent',
  padding: '0.5rem 0.65rem',
  background: 'transparent',
  color: 'var(--text-secondary)',
};

const fileEditorStyle: CSSProperties = {
  width: '100%',
  minHeight: 0,
  height: '100%',
  resize: 'none',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: '#060914',
  color: 'var(--text-primary)',
  padding: '0.95rem',
  fontFamily: 'JetBrains Mono, monospace',
  lineHeight: 1.6,
};

const diffLineStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '14px minmax(0, 1fr)',
  gap: '0.5rem',
  padding: '0.22rem 0.45rem',
  borderRadius: '6px',
  fontSize: '0.78rem',
  overflowX: 'auto',
};

const docContentStyle: CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  fontSize: '0.84rem',
};

const terminalCommandCardStyle: CSSProperties = {
  display: 'grid',
  gap: '0.45rem',
  padding: '0.85rem',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.015)',
};

const terminalSummaryCardStyle: CSSProperties = {
  ...subtleCardStyle,
  padding: '0.85rem',
  minHeight: 0,
};

const terminalSummaryValueStyle: CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: '0.84rem',
  lineHeight: 1.6,
  overflowWrap: 'anywhere',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const terminalHistoryCommandStyle: CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: '0.82rem',
  lineHeight: 1.55,
  overflowWrap: 'anywhere',
};

const terminalHistoryMetaStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.78rem',
  lineHeight: 1.5,
  overflowWrap: 'anywhere',
};

const terminalHistoryUrlStyle: CSSProperties = {
  color: 'var(--accent-primary)',
  fontSize: '0.76rem',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
};

const terminalOutputStyle: CSSProperties = {
  margin: 0,
  minHeight: 0,
  height: '100%',
  overflow: 'auto',
  borderRadius: '4px',
  padding: '0.85rem 0.95rem',
  background: '#050814',
  color: '#d7f9ff',
  fontSize: '0.86rem',
  lineHeight: 1.65,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

const projectCardStyle: CSSProperties = {
  ...subtleCardStyle,
  width: '100%',
  textAlign: 'left',
  cursor: 'default',
};

const briefChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.35rem 0.55rem',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.015)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  flex: '0 0 auto',
};

const briefChipLabelStyle: CSSProperties = {
  fontSize: '0.56rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
};

const briefChipValueStyle: CSSProperties = {
  color: 'var(--text-primary)',
};

const compactBriefChipStyle: CSSProperties = {
  ...briefChipStyle,
  gap: '0.4rem',
  padding: '0.34rem 0.52rem',
  borderRadius: '4px',
  background: 'rgba(255,255,255,0.015)',
};

const compactBriefChipLabelStyle: CSSProperties = {
  fontSize: '0.54rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
};

const compactBriefChipValueStyle: CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: '0.76rem',
};

const routeChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.34rem 0.52rem',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  background: 'rgba(0, 212, 255, 0.04)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  flex: '0 0 auto',
};

const routeChipLabelStyle: CSSProperties = {
  fontSize: '0.54rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
};

const routeChipValueStyle: CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: '0.74rem',
};

const attachmentTrayStyle: CSSProperties = {
  display: 'flex',
  gap: '0.45rem',
  flexWrap: 'wrap',
  marginBottom: '0.55rem',
};

const attachmentChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.38rem',
  padding: '0.35rem 0.55rem',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.02)',
  color: 'var(--text-secondary)',
  fontSize: '0.76rem',
};

const emojiPickerStyle: CSSProperties = {
  display: 'flex',
  gap: '0.45rem',
  flexWrap: 'wrap',
  padding: '0.5rem',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.02)',
};

const emojiButtonStyle: CSSProperties = {
  border: 'none',
  background: 'rgba(255,255,255,0.04)',
  borderRadius: '4px',
  padding: '0.45rem 0.55rem',
  cursor: 'pointer',
  fontSize: '1.1rem',
};

const composerModeGroupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.2rem',
  padding: '0.18rem',
  borderRadius: '999px',
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.03)',
};

const composerModeButtonStyle: CSSProperties = {
  border: 'none',
  borderRadius: '999px',
  background: 'transparent',
  color: 'var(--text-muted)',
  padding: '0.42rem 0.72rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
  lineHeight: 1,
};

const composerModeButtonActiveStyle: CSSProperties = {
  ...composerModeButtonStyle,
  background: 'rgba(0, 212, 255, 0.14)',
  color: 'var(--text-primary)',
  boxShadow: 'inset 0 0 0 1px rgba(0, 212, 255, 0.22)',
};

const compactActionButtonStyle: CSSProperties = {
  padding: '0.38rem 0.68rem',
  fontSize: '0.74rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const destructiveActionButtonStyle: CSSProperties = {
  ...compactActionButtonStyle,
  color: 'var(--error)',
  borderColor: 'rgba(239, 68, 68, 0.28)',
};

const userBubbleStyle: CSSProperties = {
  maxWidth: '88%',
  padding: '0.75rem 0.9rem',
  borderRadius: '14px 14px 4px 14px',
  background: 'rgba(0, 212, 255, 0.11)',
  border: '1px solid rgba(0, 212, 255, 0.2)',
};

const assistantBubbleStyle: CSSProperties = {
  maxWidth: '88%',
  padding: '0.75rem 0.9rem',
  borderRadius: '14px 14px 14px 4px',
  background: 'rgba(255,255,255,0.035)',
  border: '1px solid rgba(255,255,255,0.06)',
};

const messageMetaRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.75rem',
  alignItems: 'center',
  marginBottom: '0.42rem',
};

const messageAuthorStyle: CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: '0.76rem',
  fontWeight: 700,
};

const messageTimestampStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.72rem',
};

const assistantSuccessStyle: CSSProperties = {
  ...assistantBubbleStyle,
  border: '1px solid #1a4020',
  background: 'rgba(20, 122, 48, 0.14)',
};

const assistantWarningStyle: CSSProperties = {
  ...assistantSuccessStyle,
  border: '1px solid rgba(255, 183, 0, 0.28)',
  background: 'rgba(255, 183, 0, 0.08)',
};

const previewCanvasStyle: CSSProperties = {
  minHeight: 0,
  height: '100%',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  overflow: 'hidden',
  padding: '0.85rem',
};

const previewFrameStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: '58vh',
  border: 'none',
  borderRadius: '4px',
  background: '#fff',
};

const previewPlaceholderStyle: CSSProperties = {
  width: '100%',
  minHeight: '58vh',
  borderRadius: '4px',
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.015)',
  padding: '2rem',
};

const drawerOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(2,4,10,0.64)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '1rem',
  zIndex: 120,
};

const drawerStyle: CSSProperties = {
  width: 'min(520px, 100%)',
  height: '100%',
  borderRadius: '24px',
  background: 'rgba(7,10,18,0.98)',
  border: '1px solid var(--border-glass)',
  padding: '1.2rem',
  display: 'grid',
  gap: '1rem',
  overflowY: 'auto',
};

const heroShellStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '34px',
  padding: '1.3rem',
  minHeight: '82vh',
  background: 'linear-gradient(180deg, rgba(8,12,20,0.98), rgba(14,17,28,0.96))',
  border: '1px solid rgba(255,255,255,0.08)',
};

const heroGlowTopStyle: CSSProperties = {
  position: 'absolute',
  inset: '0 0 auto 0',
  height: '78%',
  background: 'radial-gradient(circle at 20% 45%, rgba(89,148,255,0.72), transparent 30%), radial-gradient(circle at 85% 42%, rgba(96,131,255,0.68), transparent 28%)',
  filter: 'blur(36px)',
  opacity: 0.9,
};

const heroGlowBottomStyle: CSSProperties = {
  position: 'absolute',
  inset: 'auto 0 0 0',
  height: '54%',
  background: 'radial-gradient(circle at 18% 22%, rgba(248,65,182,0.76), transparent 26%), radial-gradient(circle at 82% 26%, rgba(248,65,182,0.74), transparent 28%)',
  filter: 'blur(40px)',
  opacity: 0.94,
};

const heroBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.55rem 0.8rem',
  borderRadius: '999px',
  background: 'rgba(12,16,26,0.58)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(239,246,252,0.88)',
  fontSize: '0.72rem',
  letterSpacing: '0.18em',
};

const heroComposerShellStyle: CSSProperties = {
  width: 'min(920px, 100%)',
  display: 'grid',
  gap: '0.75rem',
  padding: '1.15rem 1.2rem 1rem',
  borderRadius: '30px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(17,17,20,0.92)',
  boxShadow: '0 22px 60px rgba(0,0,0,0.35)',
};

const heroComposerInputStyle: CSSProperties = {
  width: '100%',
  minHeight: '170px',
  resize: 'vertical',
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontSize: '1.04rem',
  lineHeight: 1.7,
};

const heroPromptChipStyle: CSSProperties = {
  maxWidth: '340px',
  textAlign: 'left',
};

const recentRailStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  marginTop: 'auto',
  padding: '1rem',
  borderRadius: '28px',
  background: 'rgba(20,10,16,0.76)',
  border: '1px solid rgba(255,255,255,0.06)',
};

const recentProjectCardStyle: CSSProperties = {
  ...subtleCardStyle,
  textAlign: 'left',
  background: 'rgba(255,255,255,0.02)',
  cursor: 'default',
};
