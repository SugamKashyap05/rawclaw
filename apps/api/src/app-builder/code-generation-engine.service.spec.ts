import {
  AppBuilderProject,
  AppSpecJson,
  ArchitecturePlan,
  FileGraph,
  RawClawAppManifest,
} from '@rawclaw/shared';
import { CodeGenerationEngineService } from './code-generation-engine.service';
import { ContextEngineService } from './context-engine.service';

function makeProject(): AppBuilderProject {
  return {
    id: 'project-image-viewer',
    name: 'Image Review Viewer',
    slug: 'image-review-viewer',
    workspaceId: 'default',
    appType: 'web_app',
    sourceType: 'generated',
    templateId: 'web-dashboard',
    status: 'draft',
    controlMode: 'action_limited',
    approvalRequired: false,
    approvalGranted: false,
    requestedPermissions: ['project.read', 'project.control'],
    requestedCapabilities: ['list_images', 'open_image', 'zoom_image', 'rotate_image', 'get_viewer_state'],
    managedPath: 'data/app-builder/projects/image-review-viewer/current',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  };
}

function makeImageViewerSpec(): AppSpecJson {
  return {
    title: 'Image Review Viewer',
    summary: 'Local image viewing tool with gallery, viewer, metadata, and review controls.',
    appType: 'web_app',
    templateId: 'web-dashboard',
    domain: 'generic_web',
    routes: [{ id: 'home', path: '/', label: 'Home', description: 'Primary viewer route.' }],
    features: [
      'image gallery',
      'single image viewer',
      'metadata details panel',
      'review history panel',
      'zoom and fit controls',
      'image rotation',
      'favorites',
      'image review actions',
    ],
    uiSections: ['Gallery Overview', 'Single Image Viewer', 'Metadata / Details', 'Review History'],
    dataModel: [
      {
        id: 'image',
        label: 'Image',
        fields: ['title', 'owner', 'status', 'priority', 'submittedDate', 'notes'],
      },
    ],
    controlActions: [
      'list_images',
      'open_image',
      'zoom_image',
      'rotate_image',
      'fit_image',
      'mark_favorite',
      'approve_image',
      'reject_image',
      'filter_images',
      'get_viewer_state',
    ],
    runtimeEvents: ['image.opened', 'zoom.changed', 'image.rotated', 'image.approved', 'image.rejected', 'filters.changed'],
  };
}

function makeArchitecture(): ArchitecturePlan {
  return {
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
  };
}

function makeFileGraph(): FileGraph {
  return {
    rootDir: 'data/app-builder/projects/image-review-viewer/current',
    generationOrder: ['src/App.tsx', 'rawclaw.app.manifest.json'],
    files: [
      { id: 'app', path: 'src/App.tsx', purpose: 'App shell', sourceKind: 'generated', dependsOn: [] },
      { id: 'manifest', path: 'rawclaw.app.manifest.json', purpose: 'Manifest', sourceKind: 'manifest', dependsOn: [] },
    ],
  };
}

function makeManifest(spec: AppSpecJson): RawClawAppManifest {
  return {
    appId: 'image-review-viewer',
    name: 'Image Review Viewer',
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
    controlMode: 'action_limited',
    routes: spec.routes,
    capabilities: spec.controlActions.map((action) => ({
      id: action,
      name: action.replace(/_/g, ' '),
      description: `Run ${action}.`,
      command: action,
    })),
    permissions: {
      required: ['project.read', 'project.control'],
      dangerous: [],
      approvalRequired: false,
    },
    controlEndpoints: {
      commands: 'http://localhost:3000/api/app-builder/apps/image-review-viewer/control',
      events: 'http://localhost:3000/api/app-builder/apps/image-review-viewer/events/stream',
      health: 'http://localhost:3000/api/app-builder/apps/image-review-viewer/health',
    },
    envRequirements: [],
    deployment: {
      target: 'local_managed',
      location: 'data/app-builder/projects/image-review-viewer/current',
    },
    metadata: { templateId: 'web-dashboard' },
  };
}

describe('CodeGenerationEngineService', () => {
  it('generates an image viewer UI from the requested spec and manifest capabilities', () => {
    const service = new CodeGenerationEngineService(new ContextEngineService());
    const spec = makeImageViewerSpec();
    const files = service.generateFiles({
      project: makeProject(),
      spec,
      architecture: makeArchitecture(),
      fileGraph: makeFileGraph(),
      manifest: makeManifest(spec),
    });

    expect(files['src/App.tsx']).toContain('Gallery Overview');
    expect(files['src/App.tsx']).toContain('Single Image Viewer');
    expect(files['src/App.tsx']).toContain('Metadata / Details');
    expect(files['src/App.tsx']).toContain('Review History');
    expect(files['src/App.tsx']).toContain('Upload images');
    expect(files['src/App.tsx']).toContain('type="file"');
    expect(files['src/App.tsx']).toContain('image.uploaded');
    expect(files['src/App.tsx']).toContain('Zoom in');
    expect(files['src/App.tsx']).toContain('Rotate');
    expect(files['src/App.tsx']).toContain('approve_image');
    expect(files['src/App.tsx']).toContain('get_viewer_state');
    expect(files['src/App.tsx']).not.toContain('Tickets queued');
    expect(files['src/App.tsx']).not.toContain('Support queues');

    const manifest = JSON.parse(files['rawclaw.app.manifest.json']) as RawClawAppManifest;
    expect(manifest.capabilities.map((capability) => capability.command)).toEqual(spec.controlActions);
  });
});
