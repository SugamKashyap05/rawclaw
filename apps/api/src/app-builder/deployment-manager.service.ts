import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import { PreviewSession } from '@rawclaw/shared';
import { ProcessControllerService } from '../process-controller.service';

@Injectable()
export class DeploymentManagerService {
  constructor(private readonly processController: ProcessControllerService) {}

  async startPreview(projectName: string, servedPath: string, previousPid?: string | null): Promise<PreviewSession> {
    if (previousPid) {
      this.safeStop(previousPid);
    }

    const port = await this.findOpenPort(4173);
    const run = await this.processController.startRun({
      name: `App Builder preview: ${projectName}`,
      kind: 'app-builder-preview',
      workspace: servedPath,
      metadata: { servedPath, port },
    });
    const process = await this.processController.startProcess(run.id, {
      name: 'python-http-server',
      suiteKey: 'preview',
      command: ['python', '-m', 'http.server', String(port), '--bind', '127.0.0.1'],
      metadata: { servedPath, port },
    });

    const child = spawn('python', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
      cwd: servedPath,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    await this.processController.updateProcess(process.id, {
      status: 'running',
      pid: child.pid,
      summary: { servedPath, port, url: `http://127.0.0.1:${port}` },
    });

    return {
      status: 'ready',
      url: `http://127.0.0.1:${port}`,
      port,
      servedPath,
      processRunId: run.id,
      processId: child.pid ? String(child.pid) : null,
      startedAt: new Date().toISOString(),
    };
  }

  private safeStop(pid: string): void {
    const numeric = Number(pid);
    if (!Number.isFinite(numeric)) return;
    try {
      process.kill(numeric);
    } catch {
      // Best-effort stop only.
    }
  }

  private async findOpenPort(start: number): Promise<number> {
    for (let port = start; port < start + 100; port += 1) {
      const free = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
      });
      if (free) return port;
    }
    throw new Error('No open preview ports available.');
  }
}
