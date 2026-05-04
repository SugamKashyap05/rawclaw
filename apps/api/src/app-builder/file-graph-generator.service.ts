import { Injectable } from '@nestjs/common';
import { FileGraph, FileTask, AppSpecJson, ArchitecturePlan, AppBuilderProject } from '@rawclaw/shared';

@Injectable()
export class FileGraphGeneratorService {
  createGraph(rootDir: string, project: AppBuilderProject, spec: AppSpecJson, _plan: ArchitecturePlan): FileGraph {
    const files: FileTask[] = [
      { id: 'package', path: 'package.json', purpose: 'Project manifest and scripts', sourceKind: 'config', dependsOn: [] },
      { id: 'readme', path: 'README.md', purpose: 'Project summary and operator handoff notes', sourceKind: 'support', dependsOn: ['package'] },
      { id: 'tsconfig', path: 'tsconfig.json', purpose: 'TypeScript compiler configuration', sourceKind: 'config', dependsOn: [] },
      { id: 'viteconfig', path: 'vite.config.ts', purpose: 'Vite build configuration', sourceKind: 'config', dependsOn: ['package'] },
      { id: 'index', path: 'index.html', purpose: 'Vite HTML entry point', sourceKind: 'config', dependsOn: ['package'] },
      { id: 'styles', path: 'src/styles.css', purpose: 'Primary application styling', sourceKind: 'style', dependsOn: [] },
      { id: 'sdk', path: 'src/rawclaw-sdk.ts', purpose: 'RawClaw SDK hooks and manifest helpers', sourceKind: 'control_hook', dependsOn: [] },
      { id: 'main', path: 'src/main.tsx', purpose: 'React bootstrap entry point', sourceKind: 'support', dependsOn: ['styles'] },
      { id: 'manifest', path: 'rawclaw.app.manifest.json', purpose: 'RawClaw app manifest', sourceKind: 'manifest', dependsOn: ['sdk'] },
      { id: 'contract-test', path: 'src/rawclaw-contract.test.ts', purpose: 'RawClaw manifest and handler contract tests', sourceKind: 'support', dependsOn: ['sdk', 'manifest'] },
    ];

    if (spec.domain === 'calculator') {
      files.push(
        { id: 'calculator', path: 'src/components/Calculator.tsx', purpose: 'Calculator interaction logic and keypad UI', sourceKind: 'generated', dependsOn: ['sdk', 'styles'], validationOwner: 'src/components/Calculator.tsx' },
        { id: 'app', path: 'src/App.tsx', purpose: 'Application shell for calculator workspace', sourceKind: 'generated', dependsOn: ['calculator', 'sdk', 'styles'], validationOwner: 'src/App.tsx' },
      );
    } else if (spec.domain === 'ai_console') {
      files.push(
        { id: 'console', path: 'src/components/PromptConsole.tsx', purpose: 'AI tool console workflow surface', sourceKind: 'generated', dependsOn: ['sdk', 'styles'], validationOwner: 'src/components/PromptConsole.tsx' },
        { id: 'app', path: 'src/App.tsx', purpose: 'Application shell for AI console workspace', sourceKind: 'generated', dependsOn: ['console', 'sdk', 'styles'], validationOwner: 'src/App.tsx' },
      );
    } else if (spec.domain === 'dashboard') {
      files.push(
        { id: 'card', path: 'src/components/KpiCard.tsx', purpose: 'Reusable metric card', sourceKind: 'generated', dependsOn: ['styles'], validationOwner: 'src/components/KpiCard.tsx' },
        { id: 'app', path: 'src/App.tsx', purpose: 'Dashboard shell and data cards', sourceKind: 'generated', dependsOn: ['card', 'sdk', 'styles'], validationOwner: 'src/App.tsx' },
      );
    } else {
      files.push(
        { id: 'app', path: 'src/App.tsx', purpose: `${project.name} application shell`, sourceKind: 'generated', dependsOn: ['sdk', 'styles'], validationOwner: 'src/App.tsx' },
      );
    }

    files.push({
      id: 'app-test',
      path: 'src/App.test.tsx',
      purpose: 'Smoke and primary UI workflow tests',
      sourceKind: 'support',
      dependsOn: ['app'],
    });

    const orderedFiles = this.topologicallySort(files);
    return {
      rootDir,
      files: orderedFiles,
      generationOrder: orderedFiles.map((file) => file.path),
    };
  }

  private topologicallySort(files: FileTask[]): FileTask[] {
    const byId = new Map(files.map((file) => [file.id, file]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const ordered: FileTask[] = [];

    const visit = (file: FileTask) => {
      if (visited.has(file.id)) return;
      if (visiting.has(file.id)) {
        throw new Error(`Circular file graph dependency detected at ${file.id}.`);
      }
      visiting.add(file.id);
      for (const dependencyId of file.dependsOn) {
        const dependency = byId.get(dependencyId);
        if (dependency) visit(dependency);
      }
      visiting.delete(file.id);
      visited.add(file.id);
      ordered.push(file);
    };

    for (const file of files) {
      visit(file);
    }

    return ordered;
  }
}
