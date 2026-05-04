import { Injectable } from '@nestjs/common';
import { AppBuilderGenerationMode, AppBuilderHarnessMetadataV1 } from '@rawclaw/shared';

export type AppBuilderHarnessMetadataRead =
  | { kind: 'v1'; metadata: AppBuilderHarnessMetadataV1 }
  | { kind: 'legacy_mapped'; metadata: AppBuilderHarnessMetadataV1 }
  | { kind: 'legacy_unmapped'; raw: Record<string, unknown> | null };

@Injectable()
export class AppBuilderHarnessMetadataService {
  create(input: Omit<AppBuilderHarnessMetadataV1, 'schemaVersion'>): AppBuilderHarnessMetadataV1 {
    return {
      schemaVersion: 1,
      rawOutputArtifactIds: [],
      ...input,
    };
  }

  read(raw: Record<string, unknown> | null | undefined): AppBuilderHarnessMetadataRead {
    if (!raw || typeof raw !== 'object') {
      return { kind: 'legacy_unmapped', raw: null };
    }
    if (raw.schemaVersion === 1 && typeof raw.projectId === 'string') {
      return { kind: 'v1', metadata: raw as unknown as AppBuilderHarnessMetadataV1 };
    }
    if (typeof raw.projectId === 'string' && typeof raw.templateId === 'string') {
      return {
        kind: 'legacy_mapped',
        metadata: {
          schemaVersion: 1,
          projectId: raw.projectId,
          appBuilderRunId: typeof raw.runId === 'string' ? raw.runId : null,
          snapshotId: null,
          stagingId: null,
          generationMode: this.inferGenerationMode(raw),
          validationTrigger: 'user_requested',
          commandKind: 'other',
          fileHashSummary: null,
          timeoutPolicy: null,
          supersededBy: null,
          rawOutputArtifactIds: [],
        },
      };
    }
    return { kind: 'legacy_unmapped', raw: raw as Record<string, unknown> };
  }

  private inferGenerationMode(raw: Record<string, unknown>): AppBuilderGenerationMode {
    if (raw.sourceType === 'imported') return 'adapter';
    return 'template';
  }
}
