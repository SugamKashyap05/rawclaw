import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  AppBuilderSecurityScan,
  AppBuilderSecurityScanFinding,
  AppBuilderSecurityScanStatus,
} from '@rawclaw/shared';

export type GeneratedFileForScan = {
  path: string;
  content: string;
};

@Injectable()
export class GeneratedContentSecurityService {
  scan(files: GeneratedFileForScan[], stagingId?: string | null): AppBuilderSecurityScan {
    const findings = files.flatMap((file) => this.scanFile(file));
    const status = this.rollup(findings);
    return {
      id: randomUUID(),
      stagingId: stagingId || null,
      status,
      findings,
      createdAt: new Date().toISOString(),
    };
  }

  private scanFile(file: GeneratedFileForScan): AppBuilderSecurityScanFinding[] {
    const findings: AppBuilderSecurityScanFinding[] = [];
    const normalizedPath = file.path.replace(/\\/g, '/');
    const fileHash = createHash('sha256').update(file.content).digest('hex');
    const add = (status: AppBuilderSecurityScanStatus, patternId: string, summary: string, details?: string) => {
      findings.push({
        id: randomUUID(),
        status,
        filePath: normalizedPath,
        fileHash,
        patternId,
        summary,
        details: details || null,
      });
    };

    if (/(^|\/)vite\.config\.[cm]?[jt]s$/.test(normalizedPath)) {
      add('needs_approval', 'vite_config_change', 'Vite config changes require review before apply.');
      if (/plugins\s*:\s*\[[\s\S]*\b(import|require)\s*\(/.test(file.content)) {
        add('blocked', 'vite_dynamic_plugin_import', 'Dynamic Vite plugin imports are not allowed.');
      }
    }

    if (/\b(child_process|node:child_process|fs|node:fs|fs\/promises|node:fs\/promises)\b/.test(file.content)) {
      add('blocked', 'node_process_or_filesystem_import', 'Generated app/test code cannot import process or filesystem APIs.');
    }
    if (/\bprocess\.env\b/.test(file.content)) {
      add('needs_approval', 'process_env_read', 'Environment variable reads require approval.');
    }
    if (/\bfetch\s*\(\s*['"`]https?:\/\//.test(file.content)) {
      add('needs_approval', 'external_network_call', 'External network calls require declared approval.');
    }
    if (/\bexec(Sync)?\s*\(|\bspawn(Sync)?\s*\(/.test(file.content)) {
      add('blocked', 'shell_execution', 'Shell execution is not allowed in generated files.');
    }

    return findings;
  }

  private rollup(findings: AppBuilderSecurityScanFinding[]): AppBuilderSecurityScanStatus {
    if (findings.some((finding) => finding.status === 'blocked')) return 'blocked';
    if (findings.some((finding) => finding.status === 'needs_approval')) return 'needs_approval';
    return 'pass';
  }
}
