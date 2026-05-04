import { AppBuilderTemplate, RawClawAppCapability } from '@rawclaw/shared';

const DEFAULT_PERMISSIONS = {
  required: ['project.read', 'project.control'],
  dangerous: ['project.deploy'],
  approvalRequired: true,
};

export const APP_BUILDER_CAPABILITIES: Record<string, RawClawAppCapability[]> = {
  'web-dashboard': [
    {
      id: 'get_status',
      name: 'Get Status',
      description: 'Read the current dashboard runtime status.',
      command: 'app.status',
    },
    {
      id: 'navigate_home',
      name: 'Open Home',
      description: 'Navigate to the main dashboard route.',
      command: 'app.navigate',
      inputSchema: { routeId: 'home' },
    },
  ],
  'web-crud-app': [
    {
      id: 'get_status',
      name: 'Get Status',
      description: 'Read the current CRUD app runtime status.',
      command: 'app.status',
    },
    {
      id: 'create_record',
      name: 'Create Record',
      description: 'Create a record inside the managed CRUD dataset.',
      command: 'records.create',
      requiresApproval: true,
      inputSchema: { fields: ['title', 'status'] },
      outputSchema: { id: 'string' },
    },
  ],
  'ai-tool-web-console': [
    {
      id: 'get_status',
      name: 'Get Status',
      description: 'Read the current AI tool runtime status.',
      command: 'app.status',
    },
    {
      id: 'run_tool',
      name: 'Run Tool Action',
      description: 'Trigger the AI tool workflow from the console.',
      command: 'tool.run',
      requiresApproval: true,
      inputSchema: { task: 'string' },
    },
  ],
  'external-project-adapter': [
    {
      id: 'get_status',
      name: 'Get Status',
      description: 'Read the imported project adapter status.',
      command: 'app.status',
    },
    {
      id: 'bridge_command',
      name: 'Bridge Command',
      description: 'Pass a command through the generated adapter bridge.',
      command: 'adapter.forward',
      requiresApproval: true,
      inputSchema: { command: 'string', payload: 'object' },
    },
  ],
};

export const APP_BUILDER_TEMPLATES: AppBuilderTemplate[] = [
  {
    id: 'web-dashboard',
    name: 'Web Dashboard',
    description: 'A managed React dashboard scaffold with RawClaw control hooks.',
    appType: 'web_app',
    starterStack: 'React + Vite',
    deployTargets: ['local_managed', 'local_export_bundle'],
    validationCommands: [
      { id: 'typecheck', label: 'TypeScript typecheck', tool: 'typescript' },
      { id: 'test', label: 'Vitest contract tests', tool: 'vitest' },
      { id: 'build', label: 'Vite production build', tool: 'vite_build' },
      { id: 'lint', label: 'ESLint', tool: 'eslint', optional: true },
    ],
    previewRuntime: {
      kind: 'python_http_server',
      host: '127.0.0.1',
      basePort: 4173,
    },
    manifestDefaults: {
      routes: [
        { id: 'home', path: '/', label: 'Home', description: 'Primary dashboard route.' },
        { id: 'analytics', path: '/analytics', label: 'Analytics', description: 'Telemetry and KPIs.' },
      ],
      permissions: { ...DEFAULT_PERMISSIONS, required: [...DEFAULT_PERMISSIONS.required], dangerous: [...DEFAULT_PERMISSIONS.dangerous] },
      envRequirements: ['RAWCLAW_API_URL'],
    },
    generatedFiles: [
      'package.json',
      'README.md',
      'src/main.tsx',
      'src/App.tsx',
      'src/rawclaw-sdk.ts',
      'src/App.test.tsx',
      'src/rawclaw-contract.test.ts',
      'rawclaw.app.manifest.json',
    ],
    validationChecks: ['manifest', 'sdk_contract', 'project_layout', 'control_test'],
  },
  {
    id: 'web-crud-app',
    name: 'Web CRUD App',
    description: 'A CRUD-oriented web scaffold with managed data hooks and RawClaw control actions.',
    appType: 'web_app',
    starterStack: 'React + Vite',
    deployTargets: ['local_managed', 'local_export_bundle'],
    validationCommands: [
      { id: 'typecheck', label: 'TypeScript typecheck', tool: 'typescript' },
      { id: 'test', label: 'Vitest contract tests', tool: 'vitest' },
      { id: 'build', label: 'Vite production build', tool: 'vite_build' },
      { id: 'lint', label: 'ESLint', tool: 'eslint', optional: true },
    ],
    previewRuntime: {
      kind: 'python_http_server',
      host: '127.0.0.1',
      basePort: 4173,
    },
    manifestDefaults: {
      routes: [
        { id: 'home', path: '/', label: 'Records', description: 'Record management table.' },
        { id: 'details', path: '/details', label: 'Details', description: 'Selected record detail view.' },
      ],
      permissions: { ...DEFAULT_PERMISSIONS, required: [...DEFAULT_PERMISSIONS.required], dangerous: [...DEFAULT_PERMISSIONS.dangerous] },
      envRequirements: ['RAWCLAW_API_URL'],
    },
    generatedFiles: [
      'package.json',
      'README.md',
      'src/main.tsx',
      'src/App.tsx',
      'src/rawclaw-sdk.ts',
      'src/App.test.tsx',
      'src/rawclaw-contract.test.ts',
      'rawclaw.app.manifest.json',
    ],
    validationChecks: ['manifest', 'sdk_contract', 'project_layout', 'control_test'],
  },
  {
    id: 'ai-tool-web-console',
    name: 'AI Tool Console',
    description: 'A managed AI tool console that exposes tool actions through the RawClaw SDK.',
    appType: 'ai_tool',
    starterStack: 'React + Vite',
    deployTargets: ['local_managed', 'local_export_bundle'],
    validationCommands: [
      { id: 'typecheck', label: 'TypeScript typecheck', tool: 'typescript' },
      { id: 'test', label: 'Vitest contract tests', tool: 'vitest' },
      { id: 'build', label: 'Vite production build', tool: 'vite_build' },
      { id: 'lint', label: 'ESLint', tool: 'eslint', optional: true },
    ],
    previewRuntime: {
      kind: 'python_http_server',
      host: '127.0.0.1',
      basePort: 4173,
    },
    manifestDefaults: {
      routes: [
        { id: 'console', path: '/', label: 'Console', description: 'Prompt and action console.' },
        { id: 'history', path: '/history', label: 'History', description: 'Recent tool runs and outputs.' },
      ],
      permissions: { ...DEFAULT_PERMISSIONS, required: [...DEFAULT_PERMISSIONS.required], dangerous: [...DEFAULT_PERMISSIONS.dangerous] },
      envRequirements: ['RAWCLAW_API_URL'],
    },
    generatedFiles: [
      'package.json',
      'README.md',
      'src/main.tsx',
      'src/App.tsx',
      'src/rawclaw-sdk.ts',
      'src/App.test.tsx',
      'src/rawclaw-contract.test.ts',
      'rawclaw.app.manifest.json',
    ],
    validationChecks: ['manifest', 'sdk_contract', 'project_layout', 'control_test'],
  },
  {
    id: 'external-project-adapter',
    name: 'External Project Adapter',
    description: 'Generate a RawClaw-compatible adapter around an imported project using MCP/plugin bridge metadata.',
    appType: 'web_app',
    starterStack: 'Adapter Wrapper',
    deployTargets: ['external_import', 'local_export_bundle'],
    validationCommands: [
      { id: 'lint', label: 'Adapter layout validation', tool: 'eslint', optional: true },
    ],
    previewRuntime: null,
    manifestDefaults: {
      routes: [
        { id: 'bridge', path: '/', label: 'Bridge', description: 'Adapter landing route.' },
      ],
      permissions: { ...DEFAULT_PERMISSIONS, required: [...DEFAULT_PERMISSIONS.required], dangerous: [...DEFAULT_PERMISSIONS.dangerous] },
      envRequirements: ['RAWCLAW_API_URL', 'RAWCLAW_ADAPTER_TARGET'],
    },
    generatedFiles: [
      'README.md',
      'rawclaw.app.manifest.json',
      'adapter/rawclaw-adapter.json',
      'adapter/mcp-plugin.json',
    ],
    validationChecks: ['manifest', 'sdk_contract', 'adapter_layout', 'control_test'],
  },
];
