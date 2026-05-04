import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AppBuilderHarnessMetadataV1, AppBuilderTemplate, ValidationSession } from '@rawclaw/shared';
import { ProcessControllerService } from '../process-controller.service';

@Injectable()
export class ValidationEngineService {
  constructor(private readonly processController: ProcessControllerService) {}

  async runValidation(
    projectRoot: string,
    template: AppBuilderTemplate,
    attempts: number,
    options: {
      snapshotId?: string | null;
      trigger?: ValidationSession['trigger'];
      harnessMetadata?: AppBuilderHarnessMetadataV1;
      timeoutMs?: number;
    } = {},
  ): Promise<ValidationSession> {
    const workspaceRoot = this.resolveWorkspaceRoot(projectRoot);
    const toolDir = path.join(workspaceRoot, 'node_modules');
    const commands = (template.validationCommands || []).map((command) => ({
      id: command.id,
      label: command.label,
      tool: command.tool,
      optional: command.optional ?? false,
      argv: this.commandArgsForTool(command.tool, toolDir),
    }));

    const run = await this.processController.startRun({
      name: `App Builder validation: ${path.basename(projectRoot)}`,
      kind: 'app-builder-validation',
      workspace: projectRoot,
      metadata: {
        attempts,
        templateId: template.id,
        ...(options.harnessMetadata || {}),
      },
    });

    const startedAt = new Date().toISOString();
    const results: ValidationSession['commands'] = [];

    for (const command of commands) {
      const process = await this.processController.startProcess(run.id, {
        name: command.label,
        suiteKey: command.id,
        command: command.argv,
        metadata: {
          tool: command.tool,
          ...(options.harnessMetadata
            ? {
                ...options.harnessMetadata,
                commandKind: command.tool === 'typescript' ? 'typecheck' : command.tool === 'vite_build' ? 'build' : command.tool === 'vitest' ? 'test' : 'other',
              }
            : {}),
        },
      });
      const execution = await this.exec(command.argv, projectRoot, options.timeoutMs || 120_000, async (pid) => {
        await this.processController.updateProcess(process.id, {
          status: 'running',
          pid,
          metadata: {
            pid,
          },
        });
      });
      const status: ValidationSession['commands'][number]['status'] = execution.ok ? 'passed' : (command.optional ? 'skipped' : 'failed');
      await this.processController.updateProcess(process.id, {
        status: execution.timedOut ? 'timed_out' : execution.ok ? 'passed' : 'failed',
        outputLog: execution.output,
        summary: { status, exitCode: execution.exitCode, timedOut: execution.timedOut },
      });
      results.push({
        id: command.id,
        label: command.label,
        tool: command.tool,
        status,
        output: execution.output,
      });
      if (!execution.ok && !command.optional) {
        break;
      }
    }

    const ok = results.every((entry) => entry.status !== 'failed');
    await this.processController.completeRun(run.id, {
      status: ok ? 'passed' : 'failed',
      summary: { ok, attempts },
      artifacts: [],
    });

    return {
      ok,
      attempts,
      snapshotId: options.snapshotId || options.harnessMetadata?.snapshotId || null,
      status: 'current',
      trigger: options.trigger || options.harnessMetadata?.validationTrigger || null,
      harnessRunId: run.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      commands: results,
    };
  }

  private resolveWorkspaceRoot(projectRoot: string): string {
    let current = path.resolve(projectRoot);
    while (path.dirname(current) !== current) {
      if (current.endsWith('rawclaw')) {
        return current;
      }
      current = path.dirname(current);
    }
    return path.resolve(projectRoot, '..', '..', '..');
  }

  private commandArgsForTool(tool: 'typescript' | 'vite_build' | 'eslint' | 'vitest', toolDir: string): string[] {
    switch (tool) {
      case 'typescript':
        return [process.execPath, path.join(toolDir, 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.json'];
      case 'eslint':
        return [process.execPath, path.join(toolDir, 'eslint', 'bin', 'eslint.js'), 'src', '--ext', '.ts,.tsx'];
      case 'vitest':
        return [process.execPath, path.join(toolDir, 'vitest', 'vitest.mjs'), 'run', '--environment', 'jsdom'];
      case 'vite_build':
      default:
        return [process.execPath, path.join(toolDir, 'vite', 'bin', 'vite.js'), 'build'];
    }
  }

  async supersedeRunningAutoValidations(projectId: string, supersededBySnapshotId: string): Promise<number> {
    const runs = await this.processController.listRuns(100);
    const matches = runs.filter((run) => {
      const metadata = (run.metadata || {}) as Record<string, unknown>;
      return run.kind === 'app-builder-validation'
        && run.status === 'running'
        && metadata.projectId === projectId
        && metadata.validationTrigger === 'auto_post_apply'
        && metadata.snapshotId !== supersededBySnapshotId;
    });
    for (const run of matches) {
      await this.processController.cancelRun(run.id, {
        status: 'superseded',
        summary: `Superseded by validation snapshot ${supersededBySnapshotId}.`,
        metadata: {
          supersededBy: supersededBySnapshotId,
        },
      });
      if (run.workspace) {
        await this.cleanSupersededArtifacts(run.workspace);
      }
    }
    return matches.length;
  }

  private async cleanSupersededArtifacts(projectRoot: string): Promise<void> {
    const targets = [
      path.join(projectRoot, 'dist'),
      path.join(projectRoot, 'coverage'),
      path.join(projectRoot, 'node_modules', '.vite'),
      path.join(projectRoot, '.vite'),
      path.join(projectRoot, 'tsconfig.tsbuildinfo'),
      path.join(projectRoot, 'tsconfig.app.tsbuildinfo'),
      path.join(projectRoot, 'tsconfig.node.tsbuildinfo'),
    ];
    for (const target of targets) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async exec(
    argv: string[],
    cwd: string,
    timeoutMs: number,
    onSpawn?: (pid: number) => Promise<void>,
  ): Promise<{ ok: boolean; exitCode: number | null; output: string; timedOut: boolean }> {
    return await new Promise((resolve) => {
      const [command, ...args] = argv;
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      if (child.pid && onSpawn) {
        void onSpawn(child.pid);
      }
      let output = '';
      let timedOut = false;
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // Process may already be gone.
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Process may already be gone.
          }
        }, 5_000).unref();
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          ok: code === 0,
          exitCode: code,
          output: output.trim(),
          timedOut,
        });
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          exitCode: null,
          output: error.message,
          timedOut,
        });
      });
    });
  }
}
