import { AppBuilderService } from './app-builder.service';

describe('AppBuilderService lane execution routing', () => {
  const service = Object.create(AppBuilderService.prototype) as any;

  it('treats the plan lane as a plan execution request for normal briefs', () => {
    expect(service.applyLaneExecution({ kind: 'draft_chat' }, 'plan', 'generated')).toEqual({
      kind: 'execution',
      phase: 'plan',
      approve: false,
    });
  });

  it('treats the build lane as generate for generated apps and adapter-generate for imports', () => {
    expect(service.applyLaneExecution({ kind: 'draft_chat' }, 'build', 'generated')).toEqual({
      kind: 'execution',
      phase: 'generate',
      approve: false,
    });
    expect(service.applyLaneExecution({ kind: 'draft_chat' }, 'build', 'imported')).toEqual({
      kind: 'execution',
      phase: 'adapter-generate',
      approve: false,
    });
  });

  it('preserves explicit state queries and phase commands ahead of lane defaults', () => {
    expect(service.applyLaneExecution({ kind: 'state_query', query: 'usage' }, 'build', 'generated')).toEqual({
      kind: 'state_query',
      query: 'usage',
    });
    expect(service.applyLaneExecution({ kind: 'execution', phase: 'deploy', approve: false }, 'plan', 'generated')).toEqual({
      kind: 'execution',
      phase: 'deploy',
      approve: false,
    });
  });

  it('blocks build phases until the current plan fingerprint is approved', () => {
    const prompt = 'Build an image viewing tool with upload, gallery, and zoom.';
    const stalePrompt = 'Build an image viewing tool with upload, gallery, zoom, and annotations.';
    const fingerprint = service.briefFingerprint(prompt);

    expect(service.planApprovalIssue({
      name: 'Image Viewer',
      description: prompt,
      metadata: {},
    }, prompt)).toContain('approved Plan first');

    expect(service.planApprovalIssue({
      name: 'Image Viewer',
      description: prompt,
      metadata: {
        planApprovedAt: '2026-05-04T10:00:00.000Z',
        planApprovedBriefFingerprint: fingerprint,
      },
    }, prompt)).toBeNull();

    expect(service.planApprovalIssue({
      name: 'Image Viewer',
      description: stalePrompt,
      metadata: {
        planApprovedAt: '2026-05-04T10:00:00.000Z',
        planApprovedBriefFingerprint: fingerprint,
      },
    }, stalePrompt)).toContain('brief changed after the Plan was approved');
  });

  it('treats destructive-name mismatches as destructive unless code allowlisted', () => {
    expect(service.classifyDestructiveCapability({ command: 'records.delete', destructive: false })).toEqual({
      destructive: true,
      destructiveNameMismatch: true,
      allowlisted: false,
    });
  });

  it('flags top-level dynamic imports as handler import-time side effects', () => {
    expect(service.scanTopLevelSideEffects("await import('./side-effect');\nexport async function handler(){ return null; }")).toContain('line 1 top-level dynamic import');
  });

  it('flags lazy external initialization that is not smoke/dry-run guarded', () => {
    const findings = service.scanTopLevelSideEffects("export async function handler(){\n  const client = new WebSocket('ws://example.test');\n  return { ok: true };\n}");
    expect(findings).toContain('line 2 unguarded lazy external initialization');
  });
});
