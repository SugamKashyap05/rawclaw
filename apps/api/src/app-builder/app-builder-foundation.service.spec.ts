import { BadRequestException } from '@nestjs/common';
import { AppBuilderConfigService } from './app-builder.config.service';
import { AppBuilderHarnessMetadataService } from './app-builder-harness-metadata.service';
import { AppBuilderWorkflowStateService } from './app-builder-workflow-state.service';
import { SAFE_DESTRUCTIVE_NAME_ALLOWLIST, SAFE_DESTRUCTIVE_NAME_ALLOWLIST_MAX_ENTRIES } from './destructive-name-allowlist';
import { GeneratedContentSecurityService } from './generated-content-security.service';
import { SecureWorkspacePathService } from './secure-workspace-path.service';
import { existsSync } from 'fs';
import * as path from 'path';

describe('App Builder foundation services', () => {
  it('loads default App Builder config thresholds', () => {
    const service = new AppBuilderConfigService({
      get: jest.fn((key: string) => key === 'NODE_ENV' ? 'test' : undefined),
    } as any);
    service.onModuleInit();

    expect(service.values.templateConfidenceThreshold).toBe(0.72);
    expect(service.values.editClassifierConfidenceThreshold).toBe(0.65);
    expect(service.values.foregroundStartWindowMs).toBe(10_000);
    expect(service.values.smokeRestoreMaxAttempts).toBe(5);
    expect(service.values.suggestionVectorClearMaxAttempts).toBe(12);
  });

  it('rejects unsafe workspace paths', () => {
    const service = new SecureWorkspacePathService();
    const root = process.platform === 'win32' ? 'C:\\workspace\\project' : '/workspace/project';

    expect(service.resolveInside(root, 'src/App.tsx')).toContain('src');
    expect(() => service.resolveInside(root, '../secret.txt')).toThrow(BadRequestException);
  });

  it('classifies generated content security findings', () => {
    const service = new GeneratedContentSecurityService();

    const pass = service.scan([{ path: 'src/App.tsx', content: 'export default function App(){ return null; }' }]);
    expect(pass.status).toBe('pass');

    const approval = service.scan([{ path: 'src/App.tsx', content: 'fetch("https://example.com")' }]);
    expect(approval.status).toBe('needs_approval');
    expect(approval.findings[0].patternId).toBe('external_network_call');

    const blocked = service.scan([{ path: 'src/App.tsx', content: 'import { exec } from "child_process"; exec("x")' }]);
    expect(blocked.status).toBe('blocked');
  });

  it('maps versioned and legacy harness metadata', () => {
    const service = new AppBuilderHarnessMetadataService();
    const metadata = service.create({
      projectId: 'project-1',
      appBuilderRunId: 'run-1',
      snapshotId: 'snapshot-1',
      stagingId: null,
      generationMode: 'template',
      validationTrigger: 'user_requested',
      commandKind: 'typecheck',
      fileHashSummary: null,
      timeoutPolicy: { timeoutMs: 120_000 },
      supersededBy: null,
      rawOutputArtifactIds: [],
    });

    expect(service.read(metadata as unknown as Record<string, unknown>).kind).toBe('v1');
    expect(service.read({ projectId: 'project-1', templateId: 'react-vite' }).kind).toBe('legacy_mapped');
    expect(service.read({ hello: 'world' }).kind).toBe('legacy_unmapped');
  });

  it('keeps the destructive-name allowlist code-owned and fixture-backed', () => {
    expect(SAFE_DESTRUCTIVE_NAME_ALLOWLIST.length).toBeLessThanOrEqual(SAFE_DESTRUCTIVE_NAME_ALLOWLIST_MAX_ENTRIES);
    const seen = new Set<string>();
    for (const entry of SAFE_DESTRUCTIVE_NAME_ALLOWLIST) {
      expect(entry.command.trim()).toBe(entry.command);
      expect(entry.command).toBeTruthy();
      expect(entry.justification.trim().length).toBeGreaterThan(12);
      expect(entry.fixturePath.trim()).toBeTruthy();
      expect(seen.has(entry.command)).toBe(false);
      seen.add(entry.command);
      expect(existsSync(path.resolve(__dirname, entry.fixturePath))).toBe(true);
    }
  });

  it('surfaces interrupted and stale-validation actions from workflow state', () => {
    const service = new AppBuilderWorkflowStateService({} as any, {
      values: { recoveryFreezeTtlMs: 120_000 },
    } as any, {} as any);
    const detail: any = {
      project: {
        id: 'project-1',
        status: 'interrupted',
        sourceType: 'generated',
        metadata: {
          interruptedPhase: 'generate',
          interruptedRetryCount: 3,
        },
      },
      latestValidation: {
        status: 'stale',
      },
      approvalGate: null,
    };

    const state = service.derive(detail);
    const actions = service.nextAllowedActions({ ...detail, workflowState: state }, 'workspace');

    expect(state.status).toBe('interrupted');
    expect(actions.some((action) => action.id === 'retry_phase' && action.disabled)).toBe(true);
  });

  it('surfaces smoke restore recovery actions from workflow state', () => {
    const service = new AppBuilderWorkflowStateService({} as any, {
      values: { recoveryFreezeTtlMs: 120_000 },
    } as any, {} as any);
    const detail: any = {
      project: {
        id: 'project-1',
        status: 'registered',
        sourceType: 'generated',
        metadata: {
          smokeRestoreFailed: true,
          smokeRestoreSnapshotState: { health: 'healthy' },
        },
      },
      latestValidation: null,
      approvalGate: null,
      artifacts: [],
    };

    const state = service.derive(detail);
    const actions = service.nextAllowedActions({ ...detail, workflowState: state }, 'workspace');

    expect(actions.map((action) => action.id)).toEqual(['retry_smoke_restore', 'reset_control_state']);
  });
});
