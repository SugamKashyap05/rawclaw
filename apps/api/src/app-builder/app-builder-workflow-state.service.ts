import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AppBuilderApprovalStage,
  AppBuilderGenerationMode,
  AppBuilderPhase,
  AppBuilderProject,
  AppBuilderProjectDetail,
  AppBuilderProjectStatus,
  AppBuilderSuggestedAction,
  AppBuilderValidationResult,
  AppBuilderWorkflowState,
} from '@rawclaw/shared';
import { PrismaService } from '../prisma.service';
import { AppBuilderConfigService } from './app-builder.config.service';
import { AppBuilderWorkflowRepository } from './app-builder-workflow.repository';

type JsonObject = Record<string, unknown>;

type TransitionContext = {
  expectedBriefFingerprint?: string | null;
  expectedPlanFingerprint?: string | null;
  snapshotId?: string | null;
  generationMode?: AppBuilderGenerationMode | null;
  metadata?: JsonObject | null;
};

@Injectable()
export class AppBuilderWorkflowStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppBuilderConfigService,
    private readonly workflowRepo: AppBuilderWorkflowRepository,
  ) {}

  derive(detail: AppBuilderProjectDetail): AppBuilderWorkflowState {
    const metadata = detail.project.metadata || {};
    const validation = detail.latestValidation || null;
    const pendingApprovalStage = (metadata.pendingApprovalStage as AppBuilderApprovalStage | undefined) || detail.approvalGate?.stage || null;
    const validationState = this.validationState(validation);
    const generationMode = this.generationModeFromMetadata(metadata, detail.project.sourceType === 'imported' ? 'adapter' : 'template');
    const interrupted = detail.project.status === 'interrupted'
      ? {
          phase: (metadata.interruptedPhase as AppBuilderPhase | undefined) || null,
          retryCount: this.number(metadata.interruptedRetryCount, 0),
          lastStableSnapshotId: (metadata.lastStableSnapshotId as string | undefined) || null,
          recoveryActions: ['retry_phase', 'discard_incomplete_staging', 'rollback', 'inspect_logs', 'acknowledge_interruption'],
        }
      : null;
    return {
      status: detail.project.status,
      phase: (metadata.currentPhase as AppBuilderPhase | undefined) || null,
      generationMode,
      pendingApprovalStage,
      planCurrent: this.planCurrent(metadata),
      buildAllowed: this.buildAllowed(detail.project, metadata, pendingApprovalStage),
      validationState,
      recoveryFreeze: this.recoveryFreeze(metadata),
      interrupted,
      capacityState: (metadata.capacityState as AppBuilderWorkflowState['capacityState']) || null,
    };
  }

  nextAllowedActions(detail: AppBuilderProjectDetail, mode: 'chat' | 'workspace' | 'console' = 'chat'): AppBuilderSuggestedAction[] {
    const state = detail.workflowState || this.derive(detail);
    const actions: AppBuilderSuggestedAction[] = [];

    if (state.recoveryFreeze?.active) {
      actions.push({
        id: 'recovery-freeze',
        label: 'Recovery in progress',
        kind: 'refresh',
        disabled: true,
        reason: `Recovery is in progress. Reads are available, mutations are paused for up to ${Math.round(this.config.values.recoveryFreezeTtlMs / 1000)} seconds at a time.`,
        emphasis: 'secondary',
      });
      return actions;
    }

    if (detail.project.metadata?.smokeRestoreFailed) {
      if (detail.project.metadata.smokeRestoreSnapshotState) {
        actions.push({
          id: 'retry_smoke_restore',
          label: 'Retry smoke restore',
          kind: 'refresh',
          emphasis: 'primary',
          reason: 'Restore control state from the pre-smoke snapshot.',
        });
      }
      actions.push(
        {
          id: 'reset_control_state',
          label: 'Reset control state',
          kind: 'refresh',
          emphasis: 'secondary',
          requiresInput: true,
          reason: detail.project.metadata.smokeRestoreSnapshotState
            ? 'Explicit recovery action after repeated smoke restore failures.'
            : 'No pre-smoke snapshot is available; reset is the only control-state recovery action.',
        },
      );
      return actions;
    }

    if (detail.project.metadata?.suggestionVectorClearFailed) {
      actions.push({
        id: 'retry_suggestion_vector_clear',
        label: 'Retry suggestion cleanup',
        kind: 'refresh',
        emphasis: 'secondary',
        reason: 'Suggestion deduplication is degraded until stale vectors are cleared.',
      });
    }

    const infraFailure = detail.project.metadata?.registrationInfraFailure as Record<string, unknown> | undefined;
    const infraExpiresAt = typeof infraFailure?.expiresAt === 'string' ? Date.parse(infraFailure.expiresAt) : 0;
    if (infraFailure && Number.isFinite(infraExpiresAt) && infraExpiresAt > Date.now()) {
      actions.push({
        id: 'retry_register',
        label: 'Retry registration',
        kind: 'phase',
        phase: 'register',
        emphasis: 'primary',
        reason: 'The previous registration smoke pass hit infrastructure trouble. Retry runs the full smoke suite.',
      });
    }

    if (detail.latestValidation?.status === 'stale') {
      actions.push({
        id: 'rerun_validation',
        label: 'Rerun validation',
        kind: 'phase',
        phase: 'validate',
        emphasis: 'primary',
      });
    }

    const staged = detail.artifacts
      ?.map((artifact) => artifact.kind === 'staged_generation' ? artifact.payload as Record<string, unknown> : null)
      .find((payload) => payload && ['open', 'partially_applied', 'conflict'].includes(String(payload.status)));
    if (staged) {
      const changedFiles = Array.isArray(staged.changedFiles) ? staged.changedFiles.length : 0;
      const appliedFiles = Array.isArray(staged.appliedFilePaths) ? staged.appliedFilePaths.length : 0;
      const remaining = Math.max(0, changedFiles - appliedFiles);
      actions.push({
        id: 'apply_staging',
        label: staged.status === 'conflict' ? 'Resolve staged conflicts' : `Apply staged files${remaining ? ` (${remaining})` : ''}`,
        kind: staged.status === 'conflict' ? 'resolve_conflict' : 'apply_staging',
        emphasis: staged.status === 'conflict' ? 'secondary' : 'primary',
        reason: staged.status === 'conflict' ? 'Resolve conflicts before applying staged files.' : null,
      });
    }

    if (state.status === 'interrupted') {
      const retryAction: AppBuilderSuggestedAction = {
        id: 'retry_phase',
        label: state.interrupted?.retryCount && state.interrupted.retryCount >= 2 ? 'Retry phase again' : 'Retry phase',
        kind: 'phase',
        phase: state.interrupted?.phase || 'plan',
        emphasis: state.interrupted?.retryCount && state.interrupted.retryCount >= 2 ? 'secondary' : 'primary',
        disabled: (state.interrupted?.retryCount || 0) >= 3,
        reason: (state.interrupted?.retryCount || 0) >= 3 ? 'Acknowledge the repeated interruption before retrying again.' : null,
      };
      actions.push(
        retryAction,
        { id: 'acknowledge_interruption', label: 'Acknowledge interruption', kind: 'refresh', emphasis: 'secondary', reason: 'Clears retry lockout after repeated interruptions.' },
        { id: 'rollback', label: 'Rollback', kind: 'rollback', phase: 'rollback', emphasis: 'secondary' },
        { id: 'inspect_logs', label: 'Inspect logs', kind: 'open_mode', mode: 'console', emphasis: 'ghost' },
      );
      return actions;
    }

    if (state.pendingApprovalStage) {
      actions.push({ id: 'approve', label: `Approve ${state.pendingApprovalStage}`, kind: 'approve', emphasis: 'primary' });
    }

    switch (state.status) {
      case 'draft':
      case 'planned':
        actions.push({ id: 'generate', label: 'Build first version', kind: 'phase', phase: 'generate', emphasis: 'primary', disabled: !state.buildAllowed, reason: state.buildAllowed ? null : 'Approve the current Plan first.' });
        actions.push({ id: 'replan', label: 'Re-plan', kind: 'phase', phase: 'plan', emphasis: 'secondary' });
        break;
      case 'generated_unvalidated':
        actions.push({ id: 'validate', label: 'Run validation', kind: 'phase', phase: 'validate', emphasis: 'primary' });
        actions.push({ id: 'rollback', label: 'Rollback', kind: 'rollback', phase: 'rollback', emphasis: 'secondary' });
        break;
      case 'approval_required':
        this.approvalActions(state.pendingApprovalStage || null, actions);
        break;
      case 'deployment_ready':
      case 'deployed':
        actions.push({ id: 'deploy', label: 'Deploy locally', kind: 'phase', phase: 'deploy', emphasis: 'primary' });
        actions.push({ id: 'register', label: 'Register', kind: 'phase', phase: 'register', emphasis: 'secondary' });
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

    if (mode !== 'workspace') actions.push({ id: 'workspace', label: 'Workspace', kind: 'open_mode', mode: 'workspace', emphasis: 'ghost' });
    if (mode !== 'console') actions.push({ id: 'console', label: 'Console', kind: 'open_mode', mode: 'console', emphasis: 'ghost' });
    return actions;
  }

  async queuePhase(projectId: string, runId: string, phase: AppBuilderPhase, context: TransitionContext = {}): Promise<void> {
    const project = await this.getProject(projectId);
    await this.updateProject(projectId, 'queued', runId, {
      preRunStatus: project.status,
      currentPhase: phase,
      queuedPhase: phase,
      queuedAt: new Date().toISOString(),
      ...context.metadata,
    });
  }

  async beginPhase(projectId: string, runId: string, phase: AppBuilderPhase, context: TransitionContext = {}): Promise<void> {
    await this.assertProjectCanMutate(projectId, context);
    await this.prisma.appBuilderRun.update({
      where: { id: runId },
      data: { status: this.phaseStatus(phase), startedAt: new Date() },
    });
    await this.updateProject(projectId, this.phaseStatus(phase), runId, {
      currentPhase: phase,
      phaseStartedAt: new Date().toISOString(),
      ...context.metadata,
    }, undefined, undefined, context);
  }

  async completePhase(projectId: string, runId: string, phase: AppBuilderPhase, context: TransitionContext = {}): Promise<AppBuilderProjectStatus> {
    await this.assertProjectCanMutate(projectId, context);
    const nextStatus = this.completedProjectStatus(phase, true);
    const nextApprovalStage = this.approvalStageForPhase(phase);
    await this.prisma.appBuilderRun.update({
      where: { id: runId },
      data: { status: 'completed', finishedAt: new Date() },
    });
    await this.updateProject(projectId, nextStatus, runId, {
      pendingApprovalStage: nextApprovalStage,
      lastCompletedPhase: phase,
      lastCompletedAt: new Date().toISOString(),
      interruptedRetryCount: 0,
      ...context.metadata,
    }, nextApprovalStage ? false : true, undefined, context);
    return nextStatus;
  }

  async failPhase(projectId: string, runId: string, phase: AppBuilderPhase, error: string, output?: JsonObject | null): Promise<void> {
    await this.prisma.appBuilderRun.update({
      where: { id: runId },
      data: {
        status: 'failed_fixable',
        errorMessage: error,
        outputJson: JSON.stringify(output || null),
        finishedAt: new Date(),
      },
    });
    await this.updateProject(projectId, 'failed_fixable', runId, {
      currentPhase: phase,
      lastError: error,
      lastFailedAt: new Date().toISOString(),
    });
  }

  async markCompletionStale(projectId: string, runId: string, phase: AppBuilderPhase, reason: string, output?: JsonObject | null): Promise<void> {
    const project = await this.getProject(projectId);
    const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
    await this.prisma.appBuilderRun.update({
      where: { id: runId },
      data: {
        status: 'stale',
        summary: 'Run result ignored because project inputs changed.',
        errorMessage: reason,
        outputJson: JSON.stringify(output || null),
        finishedAt: new Date(),
      },
    });
    await this.updateProject(projectId, (metadata.preRunStatus as AppBuilderProjectStatus | undefined) || 'planned', project.latestRunId || null, {
      staleRunId: runId,
      staleRunPhase: phase,
      staleRunReason: reason,
      staleRunAt: new Date().toISOString(),
      currentPhase: null,
    });
  }

  async markInterrupted(projectId: string, phase: AppBuilderPhase | null, reason: string, context: TransitionContext = {}): Promise<void> {
    const project = await this.getProject(projectId);
    const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
    const baseKey = `${projectId}:${phase || 'unknown'}:${context.snapshotId || metadata.operationBaseSnapshotId || 'none'}`;
    const previousKey = metadata.interruptedRetryKey === baseKey ? this.number(metadata.interruptedRetryCount, 0) : 0;
    await this.updateProject(projectId, 'interrupted', project.latestRunId || null, {
      interruptedPhase: phase,
      interruptedReason: reason,
      interruptedAt: new Date().toISOString(),
      interruptedRetryKey: baseKey,
      interruptedRetryCount: previousKey + 1,
      lastStableSnapshotId: context.snapshotId || metadata.lastStableSnapshotId || metadata.operationBaseSnapshotId || metadata.initialSnapshotId || null,
      recoveryFreeze: null,
    });
  }

  async setRecoveryFreeze(projectId: string, reason: string, ttlMs: number): Promise<void> {
    const project = await this.getProject(projectId);
    const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
    await this.workflowRepo.patchMetadata(projectId, {
      ...metadata,
      recoveryFreeze: {
        active: true,
        reason,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async clearRecoveryFreeze(projectId: string): Promise<void> {
    const project = await this.getProject(projectId);
    const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
    await this.workflowRepo.patchMetadata(projectId, { ...metadata, recoveryFreeze: null });
  }

  async acknowledgeInterruption(projectId: string, reviewer = 'local-owner'): Promise<void> {
    const project = await this.getProject(projectId);
    const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
    await this.workflowRepo.patchMetadata(projectId, {
      ...metadata,
      interruptionAcknowledgedAt: new Date().toISOString(),
      interruptionAcknowledgedBy: reviewer,
      interruptedRetryCount: 0,
    });
  }

  async approvePendingStage(
    projectId: string,
    stagePatch: JsonObject,
    controlMode?: AppBuilderProject['controlMode'] | null,
  ): Promise<AppBuilderProjectStatus> {
    const project = await this.getProject(projectId);
    const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
    const pendingStage = (metadata.pendingApprovalStage as AppBuilderApprovalStage | undefined) || null;
    const nextStatus = this.nextStatusAfterApproval(pendingStage, project.status as AppBuilderProjectStatus);
    await this.updateProject(projectId, nextStatus, project.latestRunId || null, {
      ...stagePatch,
      pendingApprovalStage: null,
    }, true, { controlMode: controlMode || undefined });
    return nextStatus;
  }

  async applySnapshot(projectId: string, snapshotId: string, generationMode?: AppBuilderGenerationMode | null): Promise<void> {
    await this.updateProject(projectId, 'generated_unvalidated', null, {
      latestAppliedSnapshotId: snapshotId,
      generationMode: generationMode || null,
      validationStatus: 'none',
      appliedAt: new Date().toISOString(),
    });
  }

  async rollbackToSnapshot(projectId: string, snapshotId: string, reason = 'manual_rollback'): Promise<void> {
    await this.updateProject(projectId, 'generated_unvalidated', null, {
      latestAppliedSnapshotId: snapshotId,
      validationStatus: 'none',
      rolledBackAt: new Date().toISOString(),
      rollbackReason: reason,
    });
  }

  async markValidationStale(projectId: string, validationId?: string | null): Promise<void> {
    await this.updateProject(projectId, 'generated_unvalidated', null, {
      validationStatus: 'stale',
      staleValidationId: validationId || null,
      validationBecameStaleAt: new Date().toISOString(),
    });
  }

  async promoteValidation(projectId: string, validation: AppBuilderValidationResult): Promise<void> {
    if (validation.status === 'stale' || validation.status === 'superseded') {
      return;
    }
    await this.updateProject(projectId, validation.ok ? 'deployment_ready' : 'failed_fixable', null, {
      validationStatus: validation.ok ? 'current' : 'failed',
      latestValidationId: validation.id,
      latestValidationSnapshotId: validation.snapshotId || null,
      validatedAt: new Date().toISOString(),
    });
  }

  private approvalActions(stage: AppBuilderApprovalStage | null, actions: AppBuilderSuggestedAction[]): void {
    if (stage === 'plan') {
      actions.push({ id: 'replan', label: 'Revise plan', kind: 'phase', phase: 'plan', emphasis: 'ghost' });
      actions.push({ id: 'generate', label: 'Continue to build', kind: 'phase', phase: 'generate', emphasis: 'secondary', disabled: true, reason: 'Approve plan first.' });
      return;
    }
    if (stage === 'build') {
      actions.push({ id: 'regenerate', label: 'Revise build', kind: 'phase', phase: 'generate', emphasis: 'ghost' });
      actions.push({ id: 'validate', label: 'Run validation', kind: 'phase', phase: 'validate', emphasis: 'secondary', disabled: true, reason: 'Approve build first.' });
      return;
    }
    actions.push({ id: 'validate', label: 'Validate', kind: 'phase', phase: 'validate', emphasis: 'secondary' });
  }

  private async assertProjectCanMutate(projectId: string, context: TransitionContext): Promise<void> {
    const project = await this.getProject(projectId);
    this.assertProjectRecordCanMutate(project, context);
  }

  private assertProjectRecordCanMutate(project: any, context: TransitionContext): void {
    const metadata = this.parseJson<JsonObject>(project.metadataJson, {});
    const freeze = this.recoveryFreeze(metadata);
    if (freeze?.active) {
      throw new Error('Recovery is in progress. Mutating actions are paused.');
    }
    if (context.expectedBriefFingerprint && metadata.planApprovedBriefFingerprint && metadata.planApprovedBriefFingerprint !== context.expectedBriefFingerprint) {
      throw new Error('The brief changed while this phase was running. The result was not promoted.');
    }
    if (context.expectedPlanFingerprint && metadata.planFingerprint && metadata.planFingerprint !== context.expectedPlanFingerprint) {
      throw new Error('The Plan changed while this phase was running. The result was not promoted.');
    }
  }

  private async updateProject(
    projectId: string,
    status: AppBuilderProjectStatus,
    runId: string | null,
    metadataPatch: JsonObject,
    approvalGranted?: boolean,
    extraData?: { controlMode?: AppBuilderProject['controlMode'] },
    context?: TransitionContext,
  ): Promise<void> {
    await this.workflowRepo.updateStatus(projectId, {
      status,
      runId,
      metadataPatch,
      approvalGranted,
      extraData,
      validate: context ? (project) => this.assertProjectRecordCanMutate(project, context) : undefined,
    });
  }

  private async getProject(projectId: string): Promise<any> {
    const project = await this.prisma.appBuilderProject.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`App Builder project ${projectId} not found.`);
    }
    return project;
  }

  private validationState(validation: AppBuilderValidationResult | null): AppBuilderWorkflowState['validationState'] {
    if (!validation) return 'none';
    if (validation.status === 'stale') return 'stale';
    if (validation.status === 'superseded') return 'superseded';
    return validation.ok ? 'current' : 'failed';
  }

  private phaseStatus(phase: AppBuilderPhase): AppBuilderProjectStatus {
    if (phase === 'plan') return 'planned';
    if (phase === 'generate') return 'generating';
    if (phase === 'integrate' || phase === 'adapter-generate') return 'integrating';
    if (phase === 'validate' || phase === 'control-test') return 'validating';
    if (phase === 'deploy') return 'deploying';
    if (phase === 'register') return 'registration_pending';
    if (phase === 'import') return 'importing';
    return 'queued';
  }

  private completedProjectStatus(phase: AppBuilderPhase, approvalRequired: boolean): AppBuilderProjectStatus {
    if (approvalRequired && ['plan', 'generate', 'integrate', 'validate', 'deploy', 'register'].includes(phase)) {
      return 'approval_required';
    }
    if (phase === 'plan') return 'planned';
    if (phase === 'generate' || phase === 'integrate' || phase === 'adapter-generate') return 'generated_unvalidated';
    if (phase === 'validate') return 'deployment_ready';
    if (phase === 'deploy') return 'deployed';
    if (phase === 'register') return 'registered';
    return 'planned';
  }

  private approvalStageForPhase(phase: AppBuilderPhase): AppBuilderApprovalStage | null {
    if (phase === 'plan') return 'plan';
    if (phase === 'generate' || phase === 'integrate' || phase === 'adapter-generate') return 'build';
    if (phase === 'validate') return 'validate';
    if (phase === 'deploy') return 'deploy';
    if (phase === 'register') return 'register';
    return null;
  }

  private nextStatusAfterApproval(stage: AppBuilderApprovalStage | null, current: AppBuilderProjectStatus): AppBuilderProjectStatus {
    if (stage === 'plan') return 'planned';
    if (stage === 'build') return 'generated_unvalidated';
    if (stage === 'validate') return 'deployment_ready';
    if (stage === 'deploy') return 'deployed';
    if (stage === 'register') return 'registered';
    return current;
  }

  private buildAllowed(project: AppBuilderProject, metadata: JsonObject, pendingApprovalStage: AppBuilderApprovalStage | null): boolean {
    if (project.status === 'interrupted') return false;
    if (pendingApprovalStage === 'plan') return false;
    return this.planCurrent(metadata);
  }

  private planCurrent(metadata: JsonObject): boolean {
    return Boolean(metadata.planApprovedAt && metadata.planApprovedBriefFingerprint);
  }

  private recoveryFreeze(metadata: JsonObject): AppBuilderWorkflowState['recoveryFreeze'] {
    const freeze = metadata.recoveryFreeze as AppBuilderWorkflowState['recoveryFreeze'];
    if (!freeze?.active || !freeze.expiresAt) return null;
    if (Date.parse(freeze.expiresAt) <= Date.now()) return null;
    return freeze;
  }

  private generationModeFromMetadata(metadata: JsonObject, fallback: AppBuilderGenerationMode): AppBuilderGenerationMode {
    const value = metadata.generationMode;
    return value === 'template' || value === 'ai_scaffold' || value === 'ai_edit' || value === 'ai_repair' || value === 'adapter'
      ? value
      : fallback;
  }

  private number(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseJson<T>(value?: string | null, fallback: T = {} as T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
