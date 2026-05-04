import { Injectable } from '@nestjs/common';
import { AppBuilderTemplate, ArchitecturePlan, AppSpecJson } from '@rawclaw/shared';

@Injectable()
export class ArchitectureEngineService {
  createPlan(spec: AppSpecJson, template: AppBuilderTemplate): ArchitecturePlan {
    return {
      framework: 'react',
      buildTool: 'vite',
      language: 'typescript',
      styling: 'css',
      stateStrategy: 'local_state',
      sdkTransport: 'http',
      routes: spec.routes.map((route) => route.path),
      dependencies: ['react', 'react-dom'],
      devDependencies: ['vite', 'typescript'],
      validationCommands: (template.validationCommands || []).map((command) => command.id),
      previewStrategy: 'dist_http_server',
    };
  }
}
