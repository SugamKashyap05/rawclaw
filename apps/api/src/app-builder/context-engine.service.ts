import { Injectable } from '@nestjs/common';
import {
  AppBuilderProject,
  AppSpecJson,
  ArchitecturePlan,
  FileGraph,
  FileTask,
  RawClawAppManifest,
} from '@rawclaw/shared';

export type FileGenerationContext = {
  task: FileTask;
  project: {
    id: string;
    name: string;
    slug: string;
    managedPath: string | null;
  };
  spec: Pick<AppSpecJson, 'title' | 'summary' | 'domain' | 'features' | 'uiSections' | 'controlActions' | 'runtimeEvents' | 'routes' | 'notes'>;
  architecture: Pick<ArchitecturePlan, 'framework' | 'buildTool' | 'language' | 'styling' | 'stateStrategy' | 'sdkTransport' | 'previewStrategy' | 'dependencies' | 'devDependencies' | 'validationCommands'>;
  manifest: Pick<RawClawAppManifest, 'appId' | 'controlMode' | 'capabilities' | 'routes'>;
  dependencies: Array<{
    id: string;
    path: string;
    purpose: string;
    sourceKind: FileTask['sourceKind'];
  }>;
  generationOrder: string[];
};

type ContextInput = {
  task: FileTask;
  project: AppBuilderProject;
  spec: AppSpecJson;
  architecture: ArchitecturePlan;
  fileGraph: FileGraph;
  manifest: RawClawAppManifest;
};

@Injectable()
export class ContextEngineService {
  build(input: ContextInput): FileGenerationContext {
    return {
      task: input.task,
      project: {
        id: input.project.id,
        name: input.project.name,
        slug: input.project.slug,
        managedPath: input.project.managedPath || null,
      },
      spec: {
        title: input.spec.title,
        summary: input.spec.summary,
        domain: input.spec.domain,
        features: input.spec.features,
        uiSections: input.spec.uiSections,
        controlActions: input.spec.controlActions,
        runtimeEvents: input.spec.runtimeEvents,
        routes: input.spec.routes,
        notes: input.spec.notes,
      },
      architecture: {
        framework: input.architecture.framework,
        buildTool: input.architecture.buildTool,
        language: input.architecture.language,
        styling: input.architecture.styling,
        stateStrategy: input.architecture.stateStrategy,
        sdkTransport: input.architecture.sdkTransport,
        previewStrategy: input.architecture.previewStrategy,
        dependencies: input.architecture.dependencies,
        devDependencies: input.architecture.devDependencies,
        validationCommands: input.architecture.validationCommands,
      },
      manifest: {
        appId: input.manifest.appId,
        controlMode: input.manifest.controlMode,
        capabilities: input.manifest.capabilities,
        routes: input.manifest.routes,
      },
      dependencies: input.task.dependsOn
        .map((dependencyId) => input.fileGraph.files.find((file) => file.id === dependencyId))
        .filter((file): file is FileTask => Boolean(file))
        .map((file) => ({
          id: file.id,
          path: file.path,
          purpose: file.purpose,
          sourceKind: file.sourceKind,
        })),
      generationOrder: input.fileGraph.generationOrder,
    };
  }
}
