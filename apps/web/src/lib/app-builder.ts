import {
  AppBuilderAssistantRequest,
  AppBuilderAssistantResponse,
  AppBuilderBriefDraft,
  AppBuilderConversation,
  AppBuilderManifestRecord,
  AppBuilderMode,
  AppBuilderPhase,
  AppBuilderPreviewState,
  AppBuilderProject,
  AppBuilderProjectDetail,
  AppBuilderRun,
  AppBuilderSecurityApproval,
  AppBuilderStagedGeneration,
  AppBuilderTemplate,
  AppBuilderValidationResult,
  AppRegistryRecord,
  AppBuilderTaskList,
  ProjectBibleDocument,
  TerminalSessionRecord,
  WorkspaceFileDiff,
  WorkspaceFileRecord,
  WorkspaceFileTree,
} from '@rawclaw/shared';
import { api } from './api';

export type AppBuilderStagedGenerationRecord = AppBuilderStagedGeneration & {
  appliedFilePaths?: string[];
  discardedFilePaths?: string[];
  conflicts?: Array<{ path: string; reason: string; baseHash?: string | null; currentHash?: string | null; stagedHash?: string | null }>;
  referenceInfluence?: Record<string, unknown> | null;
};

export type AppBuilderStagedDiff = {
  id: string;
  projectId: string;
  stagingId: string;
  files: WorkspaceFileDiff[];
  unifiedDiff: string;
  summary: string;
  createdAt: string;
};

export async function fetchAppBuilderTemplates(): Promise<AppBuilderTemplate[]> {
  const response = await api.get<{ templates: AppBuilderTemplate[] }>('/app-builder/templates');
  return response.data.templates || [];
}

export async function fetchAppBuilderProjects(): Promise<AppBuilderProject[]> {
  const response = await api.get<{ projects: AppBuilderProject[] }>('/app-builder/projects');
  return response.data.projects || [];
}

export async function fetchAppBuilderConversation(params?: {
  draftId?: string | null;
  projectId?: string | null;
  mode?: AppBuilderMode | null;
}): Promise<AppBuilderConversation> {
  const response = await api.get<{ conversation: AppBuilderConversation }>('/app-builder/conversations', {
    params: params || undefined,
  });
  return response.data.conversation;
}

export async function fetchAppBuilderBrief(params?: {
  draftId?: string | null;
  projectId?: string | null;
}): Promise<AppBuilderBriefDraft> {
  const response = await api.get<{ brief: AppBuilderBriefDraft }>('/app-builder/brief', {
    params: params || undefined,
  });
  return response.data.brief;
}

export async function updateAppBuilderBrief(
  params: {
    draftId?: string | null;
    projectId?: string | null;
  },
  payload: Partial<{
    workspaceId: string;
    sourceType: 'generated' | 'imported';
    appType: 'web_app' | 'ai_tool';
    controlMode: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
    templateId: string | null;
    titleOverride: string | null;
    sourcePath: string | null;
    prompt: string | null;
  }>,
): Promise<AppBuilderBriefDraft> {
  const response = await api.patch<{ brief: AppBuilderBriefDraft }>('/app-builder/brief', payload, {
    params,
  });
  return response.data.brief;
}

export async function sendAppBuilderAssistantMessage(payload: AppBuilderAssistantRequest): Promise<AppBuilderAssistantResponse> {
  const response = await api.post<{ response: AppBuilderAssistantResponse }>('/app-builder/assistant/messages', payload);
  return response.data.response;
}

export async function fetchAppBuilderProjectDetail(projectId: string): Promise<AppBuilderProjectDetail> {
  const response = await api.get<{ detail: AppBuilderProjectDetail }>(`/app-builder/projects/${projectId}`);
  return response.data.detail;
}

export async function createAppBuilderProject(payload: {
  name: string;
  description?: string;
  workspaceId?: string;
  appType?: 'web_app' | 'ai_tool';
  templateId?: string | null;
  controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
  requestedPermissions?: string[];
  requestedCapabilities?: string[];
}): Promise<AppBuilderProjectDetail> {
  const response = await api.post<{ detail: AppBuilderProjectDetail }>('/app-builder/projects', payload);
  return response.data.detail;
}

export async function importAppBuilderProject(payload: {
  name: string;
  description?: string;
  workspaceId?: string;
  appType?: 'web_app' | 'ai_tool';
  sourcePath?: string | null;
  controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
}): Promise<AppBuilderProjectDetail> {
  const response = await api.post<{ detail: AppBuilderProjectDetail }>('/app-builder/projects/import', payload);
  return response.data.detail;
}

export async function updateAppBuilderProject(
  projectId: string,
  payload: Partial<{
    name: string;
    description: string | null;
    workspaceId: string;
    appType: 'web_app' | 'ai_tool';
    sourceType: 'generated' | 'imported';
    templateId: string | null;
    controlMode: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
    sourcePath: string | null;
  }>,
): Promise<AppBuilderProjectDetail> {
  const response = await api.patch<{ detail: AppBuilderProjectDetail }>(`/app-builder/projects/${projectId}`, payload);
  return response.data.detail;
}

export async function deleteAppBuilderProject(projectId: string): Promise<void> {
  await api.delete(`/app-builder/projects/${projectId}`);
}

export async function fetchAppBuilderManifest(projectId: string): Promise<AppBuilderManifestRecord | null> {
  const response = await api.get<{ manifest: AppBuilderManifestRecord | null }>(`/app-builder/projects/${projectId}/manifest`);
  return response.data.manifest || null;
}

export async function fetchAppBuilderPreview(projectId: string): Promise<AppBuilderPreviewState> {
  const response = await api.get<{ preview: AppBuilderPreviewState }>(`/app-builder/projects/${projectId}/preview`);
  return response.data.preview;
}

export async function fetchAppBuilderWorkspaceTree(projectId: string): Promise<WorkspaceFileTree> {
  const response = await api.get<{ fileTree: WorkspaceFileTree }>(`/app-builder/projects/${projectId}/workspace/tree`);
  return response.data.fileTree;
}

export async function fetchAppBuilderWorkspaceFile(projectId: string, filePath: string): Promise<WorkspaceFileRecord> {
  const response = await api.get<{ file: WorkspaceFileRecord }>(`/app-builder/projects/${projectId}/workspace/file`, {
    params: { path: filePath },
  });
  return response.data.file;
}

export async function saveAppBuilderWorkspaceFile(projectId: string, payload: {
  path: string;
  content?: string | null;
  newPath?: string | null;
  isDirectory?: boolean;
}): Promise<WorkspaceFileRecord> {
  const response = await api.post<{ file: WorkspaceFileRecord }>(`/app-builder/projects/${projectId}/workspace/file`, payload);
  return response.data.file;
}

export async function createAppBuilderWorkspaceFolder(projectId: string, filePath: string): Promise<WorkspaceFileTree> {
  const response = await api.post<{ fileTree: WorkspaceFileTree }>(`/app-builder/projects/${projectId}/workspace/folder`, { path: filePath });
  return response.data.fileTree;
}

export async function renameAppBuilderWorkspacePath(projectId: string, pathValue: string, newPath: string): Promise<WorkspaceFileTree> {
  const response = await api.post<{ fileTree: WorkspaceFileTree }>(`/app-builder/projects/${projectId}/workspace/rename`, {
    path: pathValue,
    newPath,
  });
  return response.data.fileTree;
}

export async function deleteAppBuilderWorkspacePath(projectId: string, filePath: string): Promise<WorkspaceFileTree> {
  const response = await api.post<{ fileTree: WorkspaceFileTree }>(`/app-builder/projects/${projectId}/workspace/delete`, { path: filePath });
  return response.data.fileTree;
}

export async function formatAppBuilderWorkspaceFile(projectId: string, filePath: string): Promise<WorkspaceFileRecord> {
  const response = await api.post<{ file: WorkspaceFileRecord }>(`/app-builder/projects/${projectId}/workspace/format`, { path: filePath });
  return response.data.file;
}

export async function fetchAppBuilderWorkspaceDiff(projectId: string, filePath: string): Promise<WorkspaceFileDiff> {
  const response = await api.get<{ diff: WorkspaceFileDiff }>(`/app-builder/projects/${projectId}/workspace/diff`, {
    params: { path: filePath },
  });
  return response.data.diff;
}

export async function fetchAppBuilderStagedGenerations(projectId: string): Promise<AppBuilderStagedGenerationRecord[]> {
  const response = await api.get<{ stagedGenerations: AppBuilderStagedGenerationRecord[] }>(`/app-builder/projects/${projectId}/staged-generations`);
  return response.data.stagedGenerations || [];
}

export async function fetchAppBuilderStagedGenerationDiff(projectId: string, stagingId: string): Promise<AppBuilderStagedDiff> {
  const response = await api.get<{ diff: AppBuilderStagedDiff }>(`/app-builder/projects/${projectId}/staged-generations/${stagingId}/diff`);
  return response.data.diff;
}

export async function applyAppBuilderStagedGeneration(projectId: string, stagingId: string, filePaths?: string[] | null): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/staged-generations/${stagingId}/apply`, {
    filePaths: filePaths || null,
  });
  return response.data;
}

export async function applyAppBuilderStagedGenerationFile(projectId: string, stagingId: string, filePath: string): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/staged-generations/${stagingId}/apply-file`, { filePath });
  return response.data;
}

export async function discardAppBuilderStagedGeneration(projectId: string, stagingId: string, filePaths?: string[] | null): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/staged-generations/${stagingId}/discard`, {
    filePaths: filePaths || null,
  });
  return response.data;
}

export async function rollbackAppBuilderStagedGeneration(projectId: string, stagingId: string): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/staged-generations/${stagingId}/rollback`);
  return response.data;
}

export async function resolveAppBuilderStagedConflict(
  projectId: string,
  stagingId: string,
  payload: { filePath: string; decision: 'keep_current' | 'overwrite_staged' | 'regenerate_patch' },
): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(
    `/app-builder/projects/${projectId}/staged-generations/${stagingId}/resolve-conflict`,
    payload,
  );
  return response.data;
}

export async function approveAppBuilderSecurityFinding(projectId: string, payload: {
  stagingId: string;
  filePath: string;
  fileHash: string;
  patternId: string;
  decision?: 'approved' | 'rejected';
  notes?: string | null;
}): Promise<AppBuilderSecurityApproval> {
  const response = await api.post<{ approval: AppBuilderSecurityApproval }>(`/app-builder/projects/${projectId}/security/approvals`, payload);
  return response.data.approval;
}

export async function fetchAppBuilderSuggestions(projectId: string): Promise<Record<string, unknown>[]> {
  const response = await api.get<{ suggestions: Record<string, unknown>[] }>(`/app-builder/projects/${projectId}/suggestions`);
  return response.data.suggestions || [];
}

export async function fetchAppBuilderUploads(projectId: string): Promise<Record<string, unknown>[]> {
  const response = await api.get<{ uploads: Record<string, unknown>[] }>(`/app-builder/projects/${projectId}/uploads`);
  return response.data.uploads || [];
}

export async function createAppBuilderUpload(projectId: string, payload: {
  kind: 'image' | 'document' | 'code_reference';
  filename: string;
  mimeType?: string | null;
  contentBase64: string;
  selectedForContext?: boolean;
}): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/uploads`, payload);
  return response.data;
}

export async function createAppBuilderMultipartUpload(projectId: string, file: File, kind?: 'image' | 'document' | 'code_reference'): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append('file', file);
  if (kind) formData.append('kind', kind);
  formData.append('selectedForContext', 'true');
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/uploads/file`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function reanalyzeAppBuilderUpload(projectId: string, uploadId: string): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/uploads/${uploadId}/reanalyze`);
  return response.data;
}

export async function updateAppBuilderUploadLanguage(projectId: string, uploadId: string, language: string): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/app-builder/projects/${projectId}/uploads/${uploadId}/language`, { language });
  return response.data;
}

export async function deleteAppBuilderUpload(projectId: string, uploadId: string): Promise<Record<string, unknown>> {
  const response = await api.delete<Record<string, unknown>>(`/app-builder/projects/${projectId}/uploads/${uploadId}`);
  return response.data;
}

export async function fetchAppBuilderDocs(projectId: string): Promise<ProjectBibleDocument[]> {
  const response = await api.get<{ docs: ProjectBibleDocument[] }>(`/app-builder/projects/${projectId}/docs`);
  return response.data.docs || [];
}

export async function fetchAppBuilderTaskList(projectId: string): Promise<AppBuilderTaskList | null> {
  const response = await api.get<{ taskList: AppBuilderTaskList | null }>(`/app-builder/projects/${projectId}/tasks`);
  return response.data.taskList || null;
}

export async function fetchAppBuilderTerminalSession(projectId: string): Promise<TerminalSessionRecord | null> {
  const response = await api.get<{ session: TerminalSessionRecord | null }>(`/app-builder/projects/${projectId}/terminal`);
  return response.data.session || null;
}

export async function startAppBuilderTerminalSession(projectId: string): Promise<TerminalSessionRecord | null> {
  const response = await api.post<{ session: TerminalSessionRecord | null }>(`/app-builder/projects/${projectId}/terminal/session`);
  return response.data.session || null;
}

export async function submitAppBuilderTerminalCommand(projectId: string, payload: {
  command: string;
  requestedBy?: string | null;
  background?: boolean;
  registerPreview?: boolean;
}): Promise<TerminalSessionRecord | null> {
  const response = await api.post<{ session: TerminalSessionRecord | null }>(`/app-builder/projects/${projectId}/terminal/commands`, payload);
  return response.data.session || null;
}

export async function stopAppBuilderTerminalSession(projectId: string): Promise<TerminalSessionRecord | null> {
  const response = await api.post<{ session: TerminalSessionRecord | null }>(`/app-builder/projects/${projectId}/terminal/stop`);
  return response.data.session || null;
}

export async function generateAppBuilderManifest(projectId: string): Promise<AppBuilderManifestRecord> {
  const response = await api.post<{ manifest: AppBuilderManifestRecord }>(`/app-builder/projects/${projectId}/manifest/generate`);
  return response.data.manifest;
}

export async function validateAppBuilderProject(projectId: string): Promise<AppBuilderValidationResult> {
  const response = await api.post<{ validation: AppBuilderValidationResult }>(`/app-builder/projects/${projectId}/manifest/validate`);
  return response.data.validation;
}

export async function approveAppBuilderProject(
  projectId: string,
  payload?: {
    reviewer?: string | null;
    notes?: string | null;
    controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
  },
): Promise<AppBuilderProjectDetail> {
  const response = await api.post<{ detail: AppBuilderProjectDetail }>(`/app-builder/projects/${projectId}/approval`, payload || {});
  return response.data.detail;
}

export async function acknowledgeAppBuilderInterruption(
  projectId: string,
  payload?: { reviewer?: string | null; notes?: string | null },
): Promise<AppBuilderProjectDetail> {
  const response = await api.post<{ detail: AppBuilderProjectDetail }>(`/app-builder/projects/${projectId}/interruption/acknowledge`, payload || {});
  return response.data.detail;
}

export async function retryAppBuilderSmokeRestore(projectId: string): Promise<AppBuilderProjectDetail> {
  const response = await api.post<{ detail: AppBuilderProjectDetail }>(`/app-builder/projects/${projectId}/smoke-restore/retry`);
  return response.data.detail;
}

export async function resetAppBuilderControlState(projectId: string, payload: { confirm: true; reason: string }): Promise<AppBuilderProjectDetail> {
  const response = await api.post<{ detail: AppBuilderProjectDetail }>(`/app-builder/projects/${projectId}/control-state/reset`, payload);
  return response.data.detail;
}

export async function retryAppBuilderSuggestionVectorClear(projectId: string): Promise<AppBuilderProjectDetail> {
  const response = await api.post<{ detail: AppBuilderProjectDetail }>(`/app-builder/projects/${projectId}/suggestions/vector-clear/retry`);
  return response.data.detail;
}

export async function queueAppBuilderPhase(
  projectId: string,
  phase: AppBuilderPhase,
  requestPayload?: Record<string, unknown> | null,
): Promise<AppBuilderRun> {
  const response = await api.post<{ run: AppBuilderRun }>(`/app-builder/projects/${projectId}/runs`, {
    phase,
    requestPayload: requestPayload || null,
  });
  return response.data.run;
}

export async function fetchAppBuilderRuns(projectId?: string): Promise<AppBuilderRun[]> {
  const response = await api.get<{ runs: AppBuilderRun[] }>('/app-builder/runs', {
    params: projectId ? { projectId } : undefined,
  });
  return response.data.runs || [];
}

export async function fetchAppRegistryRecords(): Promise<AppRegistryRecord[]> {
  const response = await api.get<{ records: AppRegistryRecord[] }>('/app-builder/registry');
  return response.data.records || [];
}
