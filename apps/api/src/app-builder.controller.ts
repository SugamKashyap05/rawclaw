import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AppBuilderAssistantRequest, AppBuilderMode, AppBuilderPhase, RawClawControlCommand } from '@rawclaw/shared';
import { AppBuilderService } from './app-builder/app-builder.service';

@UseGuards(JwtAuthGuard)
@Controller('app-builder')
export class AppBuilderController {
  constructor(private readonly appBuilder: AppBuilderService) {}

  @Get('templates')
  async listTemplates() {
    return { templates: await this.appBuilder.listTemplates() };
  }

  @Get('templates/:id')
  async getTemplate(@Param('id') id: string) {
    return { template: await this.appBuilder.getTemplate(id) };
  }

  @Get('projects')
  async listProjects() {
    return { projects: await this.appBuilder.listProjects() };
  }

  @Get('conversations')
  async getConversation(
    @Query('draftId') draftId?: string,
    @Query('projectId') projectId?: string,
    @Query('mode') mode?: AppBuilderMode,
  ) {
    return { conversation: await this.appBuilder.getConversation({ draftId, projectId, mode }) };
  }

  @Get('brief')
  async getBrief(@Query('draftId') draftId?: string, @Query('projectId') projectId?: string) {
    return { brief: await this.appBuilder.getBriefDraft({ draftId, projectId }) };
  }

  @Patch('brief')
  async updateBrief(
    @Query('draftId') draftId?: string,
    @Query('projectId') projectId?: string,
    @Body()
    payload?: {
      workspaceId?: string;
      sourceType?: 'generated' | 'imported';
      appType?: 'web_app' | 'ai_tool';
      controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
      templateId?: string | null;
      titleOverride?: string | null;
      sourcePath?: string | null;
      prompt?: string | null;
    },
  ) {
    return { brief: await this.appBuilder.updateBriefDraft({ draftId, projectId }, payload || {}) };
  }

  @Post('assistant/messages')
  async sendAssistantMessage(
    @Body() payload: AppBuilderAssistantRequest,
  ) {
    return { response: await this.appBuilder.sendAssistantMessage(payload) };
  }

  @Post('projects')
  async createProject(
    @Body()
    payload: {
      name: string;
      description?: string | null;
      workspaceId?: string | null;
      appType?: 'web_app' | 'ai_tool';
      templateId?: string | null;
      controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
      requestedPermissions?: string[];
      requestedCapabilities?: string[];
      metadata?: Record<string, unknown> | null;
    },
  ) {
    return { detail: await this.appBuilder.createProject(payload) };
  }

  @Post('projects/import')
  async importProject(
    @Body()
    payload: {
      name: string;
      description?: string | null;
      workspaceId?: string | null;
      appType?: 'web_app' | 'ai_tool';
      sourcePath?: string | null;
      controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
      metadata?: Record<string, unknown> | null;
    },
  ) {
    return { detail: await this.appBuilder.importProject(payload) };
  }

  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    return { detail: await this.appBuilder.getProjectDetail(id) };
  }

  @Patch('projects/:id')
  async updateProject(
    @Param('id') id: string,
    @Body()
    payload: {
      name?: string;
      description?: string | null;
      workspaceId?: string | null;
      appType?: 'web_app' | 'ai_tool';
      sourceType?: 'generated' | 'imported';
      templateId?: string | null;
      controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
      requestedPermissions?: string[];
      requestedCapabilities?: string[];
      sourcePath?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    return { detail: await this.appBuilder.updateProject(id, payload) };
  }

  @Delete('projects/:id')
  async deleteProject(@Param('id') id: string) {
    return await this.appBuilder.deleteProject(id);
  }

  @Get('projects/:id/manifest')
  async getManifest(@Param('id') id: string) {
    return { manifest: await this.appBuilder.getLatestManifest(id) };
  }

  @Get('projects/:id/preview')
  async getPreview(@Param('id') id: string) {
    return { preview: await this.appBuilder.getPreviewState(id) };
  }

  @Get('projects/:id/workspace/tree')
  async getWorkspaceTree(@Param('id') id: string) {
    return { fileTree: await this.appBuilder.getWorkspaceFileTree(id) };
  }

  @Get('projects/:id/workspace/file')
  async getWorkspaceFile(@Param('id') id: string, @Query('path') filePath: string) {
    return { file: await this.appBuilder.getWorkspaceFile(id, filePath) };
  }

  @Post('projects/:id/workspace/folder')
  async createWorkspaceFolder(@Param('id') id: string, @Body() payload: { path: string }) {
    return { fileTree: await this.appBuilder.createWorkspaceFolder(id, payload.path) };
  }

  @Post('projects/:id/workspace/file')
  async saveWorkspaceFile(
    @Param('id') id: string,
    @Body() payload: { path: string; content?: string | null; newPath?: string | null; isDirectory?: boolean },
  ) {
    return { file: await this.appBuilder.saveWorkspaceFile(id, payload) };
  }

  @Post('projects/:id/workspace/rename')
  async renameWorkspacePath(@Param('id') id: string, @Body() payload: { path: string; newPath: string }) {
    return { fileTree: await this.appBuilder.renameWorkspacePath(id, payload.path, payload.newPath) };
  }

  @Post('projects/:id/workspace/delete')
  async deleteWorkspacePath(@Param('id') id: string, @Body() payload: { path: string }) {
    return { fileTree: await this.appBuilder.deleteWorkspacePath(id, payload.path) };
  }

  @Post('projects/:id/workspace/format')
  async formatWorkspaceFile(@Param('id') id: string, @Body() payload: { path: string }) {
    return { file: await this.appBuilder.formatWorkspaceFile(id, payload.path) };
  }

  @Get('projects/:id/workspace/diff')
  async getWorkspaceDiff(@Param('id') id: string, @Query('path') filePath: string) {
    return { diff: await this.appBuilder.getWorkspaceFileDiff(id, filePath) };
  }

  @Get('projects/:id/staged-generations')
  async listStagedGenerations(@Param('id') id: string) {
    return { stagedGenerations: await this.appBuilder.listStagedGenerations(id) };
  }

  @Get('projects/:id/staged-generations/:stagingId/diff')
  async getStagedGenerationDiff(@Param('id') id: string, @Param('stagingId') stagingId: string) {
    return { diff: await this.appBuilder.getStagedGenerationDiff(id, stagingId) };
  }

  @Post('projects/:id/staged-generations/:stagingId/apply')
  async applyStagedGeneration(
    @Param('id') id: string,
    @Param('stagingId') stagingId: string,
    @Body() payload?: { filePaths?: string[] | null },
  ) {
    return await this.appBuilder.applyStagedGeneration(id, stagingId, payload?.filePaths || null);
  }

  @Post('projects/:id/staged-generations/:stagingId/apply-file')
  async applyStagedGenerationFile(
    @Param('id') id: string,
    @Param('stagingId') stagingId: string,
    @Body() payload: { filePath: string },
  ) {
    return await this.appBuilder.applyStagedGenerationFile(id, stagingId, payload.filePath);
  }

  @Post('projects/:id/staged-generations/:stagingId/discard')
  async discardStagedGeneration(
    @Param('id') id: string,
    @Param('stagingId') stagingId: string,
    @Body() payload?: { filePaths?: string[] | null },
  ) {
    return await this.appBuilder.discardStagedGeneration(id, stagingId, payload?.filePaths || null);
  }

  @Post('projects/:id/staged-generations/:stagingId/rollback')
  async rollbackStagedGeneration(@Param('id') id: string, @Param('stagingId') stagingId: string) {
    return await this.appBuilder.rollbackStagedGeneration(id, stagingId);
  }

  @Post('projects/:id/staged-generations/:stagingId/regenerate-conflicts')
  async regenerateStagedGenerationConflicts(@Param('id') id: string, @Param('stagingId') stagingId: string) {
    return await this.appBuilder.regenerateStagedGenerationConflicts(id, stagingId);
  }

  @Post('projects/:id/staged-generations/:stagingId/resolve-conflict')
  async resolveStagedGenerationConflict(
    @Param('id') id: string,
    @Param('stagingId') stagingId: string,
    @Body() payload: { filePath: string; decision: 'keep_current' | 'overwrite_staged' | 'regenerate_patch' },
  ) {
    return await this.appBuilder.resolveStagedGenerationConflict(id, stagingId, payload);
  }

  @Get('projects/:id/code/explain')
  async explainProjectCode(
    @Param('id') id: string,
    @Query('path') filePath: string,
    @Query('startLine') startLine?: string,
    @Query('endLine') endLine?: string,
  ) {
    return {
      explanation: await this.appBuilder.explainProjectCode(
        id,
        filePath,
        startLine ? Number(startLine) : null,
        endLine ? Number(endLine) : null,
      ),
    };
  }

  @Get('projects/:id/search')
  async searchProject(@Param('id') id: string, @Query('q') query = '', @Query('limit') limit?: string) {
    return { search: await this.appBuilder.searchProject(id, query, limit ? Number(limit) : 20) };
  }

  @Get('projects/:id/suggestions')
  async listProjectSuggestions(@Param('id') id: string) {
    return { suggestions: await this.appBuilder.listProjectSuggestions(id) };
  }

  @Post('projects/:id/suggestions/vector-clear/retry')
  async retrySuggestionVectorClear(@Param('id') id: string) {
    return { detail: await this.appBuilder.retrySuggestionVectorClear(id) };
  }

  @Get('projects/:id/uploads')
  async listProjectUploads(@Param('id') id: string) {
    return { uploads: await this.appBuilder.listProjectUploads(id) };
  }

  @Post('projects/:id/uploads')
  async createProjectUpload(
    @Param('id') id: string,
    @Body()
    payload: {
      kind: 'image' | 'document' | 'code_reference';
      filename: string;
      mimeType?: string | null;
      contentBase64: string;
      selectedForContext?: boolean;
    },
  ) {
    return await this.appBuilder.createProjectUpload(id, payload);
  }

  @Post('projects/:id/uploads/file')
  async createProjectMultipartUpload(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return await this.appBuilder.createProjectMultipartUploadStream(id, req);
  }

  @Post('projects/:id/uploads/:uploadId/reanalyze')
  async reanalyzeProjectUpload(@Param('id') id: string, @Param('uploadId') uploadId: string) {
    return await this.appBuilder.reanalyzeProjectUpload(id, uploadId);
  }

  @Post('projects/:id/uploads/:uploadId/language')
  async updateUploadLanguage(
    @Param('id') id: string,
    @Param('uploadId') uploadId: string,
    @Body() payload: { language: string },
  ) {
    return await this.appBuilder.updateUploadLanguage(id, uploadId, payload.language);
  }

  @Delete('projects/:id/uploads/:uploadId')
  async deleteProjectUpload(@Param('id') id: string, @Param('uploadId') uploadId: string) {
    return await this.appBuilder.deleteProjectUpload(id, uploadId);
  }

  @Get('projects/:id/docs')
  async getProjectBible(@Param('id') id: string) {
    return { docs: await this.appBuilder.getProjectBible(id) };
  }

  @Get('projects/:id/tasks')
  async getProjectTaskList(@Param('id') id: string) {
    return { taskList: await this.appBuilder.getProjectTaskList(id) };
  }

  @Get('projects/:id/terminal')
  async getTerminalSession(@Param('id') id: string) {
    return { session: await this.appBuilder.getTerminalSession(id) };
  }

  @Post('projects/:id/terminal/session')
  async startTerminalSession(@Param('id') id: string) {
    return { session: await this.appBuilder.startTerminalSession(id) };
  }

  @Post('projects/:id/terminal/commands')
  async submitTerminalCommand(
    @Param('id') id: string,
    @Body() payload: { command: string; requestedBy?: string | null; background?: boolean; registerPreview?: boolean },
  ) {
    return { session: await this.appBuilder.submitTerminalCommand(id, payload) };
  }

  @Post('projects/:id/terminal/stop')
  async stopTerminalSession(@Param('id') id: string) {
    return { session: await this.appBuilder.stopTerminalSession(id) };
  }

  @Post('projects/:id/manifest/generate')
  async generateManifest(@Param('id') id: string) {
    return { manifest: await this.appBuilder.generateManifest(id) };
  }

  @Post('projects/:id/manifest/validate')
  async validateManifest(@Param('id') id: string) {
    return { validation: await this.appBuilder.validateProject(id) };
  }

  @Post('projects/:id/approval')
  async approveProject(
    @Param('id') id: string,
    @Body()
    payload?: {
      reviewer?: string | null;
      notes?: string | null;
      controlMode?: 'observe_only' | 'assist_only' | 'action_limited' | 'full_control';
    },
  ) {
    return { detail: await this.appBuilder.approveProject(id, payload) };
  }

  @Post('projects/:id/interruption/acknowledge')
  async acknowledgeInterruption(
    @Param('id') id: string,
    @Body() payload?: { reviewer?: string | null; notes?: string | null },
  ) {
    return { detail: await this.appBuilder.acknowledgeInterruption(id, payload) };
  }

  @Post('projects/:id/smoke-restore/retry')
  async retrySmokeRestore(@Param('id') id: string) {
    return { detail: await this.appBuilder.retrySmokeRestore(id) };
  }

  @Post('projects/:id/control-state/reset')
  async resetControlState(
    @Param('id') id: string,
    @Body() payload: { confirm?: boolean | null; reason?: string | null },
  ) {
    return { detail: await this.appBuilder.resetControlState(id, payload || {}) };
  }

  @Post('projects/:id/security/approvals')
  async approveSecurityFinding(
    @Param('id') id: string,
    @Body()
    payload: {
      stagingId: string;
      filePath: string;
      fileHash: string;
      patternId: string;
      decision?: 'approved' | 'rejected';
      notes?: string | null;
      approverId?: string | null;
      approverRole?: 'local_owner' | 'authenticated_user' | 'admin' | 'system';
    },
  ) {
    return { approval: await this.appBuilder.approveSecurityFinding(id, payload) };
  }

  @Get('runs')
  async listRuns(@Query('projectId') projectId?: string) {
    return { runs: await this.appBuilder.listRuns(projectId) };
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    return { run: await this.appBuilder.getRun(id) };
  }

  @Post('projects/:id/runs')
  async queueRun(
    @Param('id') id: string,
    @Body() payload: { phase: AppBuilderPhase; requestPayload?: Record<string, unknown> | null },
  ) {
    if (payload.requestPayload?.backgroundable === false) {
      return await this.appBuilder.startProjectPhaseForeground(id, payload.phase, payload.requestPayload || null);
    }
    return { run: await this.appBuilder.queueProjectPhase(id, payload.phase, payload.requestPayload || null) };
  }

  @Post('projects/:id/deploy')
  async queueDeploy(@Param('id') id: string) {
    return { run: await this.appBuilder.queueProjectPhase(id, 'deploy') };
  }

  @Post('projects/:id/register')
  async queueRegister(@Param('id') id: string) {
    return { run: await this.appBuilder.queueProjectPhase(id, 'register') };
  }

  @Post('projects/:id/export')
  async queueExport(@Param('id') id: string) {
    return { run: await this.appBuilder.queueProjectPhase(id, 'export') };
  }

  @Post('projects/:id/rollback')
  async queueRollback(@Param('id') id: string) {
    return { run: await this.appBuilder.queueProjectPhase(id, 'rollback') };
  }

  @Post('projects/:id/control-test')
  async queueControlTest(@Param('id') id: string) {
    return { run: await this.appBuilder.queueProjectPhase(id, 'control-test') };
  }

  @Get('metrics')
  async getMetrics(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(await this.appBuilder.getMetricsText());
  }

  @Get('projects/:id/health')
  async getProjectHealth(@Param('id') id: string) {
    return { health: await this.appBuilder.getProjectHealth(id) };
  }

  @Get('registry')
  async listRegistry() {
    return { records: await this.appBuilder.listRegistryRecords() };
  }

  @Get('registry/:id')
  async getRegistry(@Param('id') id: string) {
    return { record: await this.appBuilder.getRegistryRecord(id) };
  }

  @Post('apps/:appId/control')
  async controlApp(@Param('appId') appId: string, @Body() payload: Omit<RawClawControlCommand, 'requestedAt'> & { requestedAt?: string }) {
    return {
      response: await this.appBuilder.executeControlCommand(appId, {
        ...payload,
        appId,
        requestedAt: payload.requestedAt || new Date().toISOString(),
      }),
    };
  }

  @Get('apps/:appId/health')
  async appHealth(@Param('appId') appId: string) {
    const response = await this.appBuilder.executeControlCommand(appId, {
      id: `health-${Date.now()}`,
      appId,
      command: 'app.status',
      requestedAt: new Date().toISOString(),
    });
    return {
      ok: response.ok,
      summary: response.summary,
      data: response.data,
    };
  }

  @Get('apps/:appId/events')
  async listAppEvents(@Param('appId') appId: string, @Query('limit') limit?: string) {
    const parsedLimit = Number(limit || 30);
    return { events: await this.appBuilder.listAppEvents(appId, Number.isFinite(parsedLimit) ? parsedLimit : 30) };
  }

  @Get('apps/:appId/events/stream')
  async streamAppEvents(@Param('appId') appId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const backlog = await this.appBuilder.listAppEvents(appId, 12);
    for (const event of backlog.reverse()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const unsubscribe = await this.appBuilder.subscribeToAppEvents(appId, async (event) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
      }
    }, 10000);

    res.on('close', () => {
      clearInterval(heartbeat);
      void unsubscribe();
      if (!res.writableEnded) {
        res.end();
      }
    });
  }
}
