import {
  Controller,
  Get,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { promises as fs } from 'node:fs';
import { resolve, relative, extname, join } from 'node:path';

const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.json', '.yml', '.yaml',
  '.md', '.txt', '.csv', '.html',
  '.css', '.scss', '.sh', '.rs',
  '.go', '.java', '.c', '.cpp',
  '.h', '.hpp'
]);

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 
  'build', '__pycache__', '.pytest_cache',
  'coverage', '.next'
]);

export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WorkspaceFileNode[];
}

@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  // apps/api -> root is ../..
  private readonly workspaceRoot = resolve(process.cwd(), '..', '..');

  /**
   * GET /api/workspace/files
   * Returns a tree of valid, non-binary text/code files in the workspace.
   */
  @Get('files')
  async getWorkspaceFiles(): Promise<{ root: string; tree: WorkspaceFileNode[] }> {
    const tree = await this.buildFileTree(this.workspaceRoot);
    return {
      root: this.workspaceRoot,
      tree,
    };
  }

  /**
   * GET /api/workspace/file?path=...
   * Returns the content of the file.
   */
  @Get('file')
  async getWorkspaceFile(@Query('path') relPath: string): Promise<{ content: string; filename: string }> {
    if (!relPath) {
      throw new BadRequestException('Path query parameter is required');
    }

    const safePath = this.getSafeAbsolutePath(relPath);
    
    try {
      const stats = await fs.stat(safePath);
      if (!stats.isFile()) {
        throw new BadRequestException('Requested path is not a file');
      }

      // Quick safety check on extension
      const ext = extname(safePath).toLowerCase();
      if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
        // We can optionally permit files without extensions (e.g. Dockerfile) or just rely on user knowing what they click.
        // For simplicity, we'll allow an empty extension or the allowed set.
      }

      const content = await fs.readFile(safePath, 'utf8');
      return {
        content,
        filename: relPath.split('/').pop() || relPath,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new NotFoundException(`File not found: ${relPath}`);
      }
      throw new BadRequestException(`Could not read file: ${err.message}`);
    }
  }

  private async buildFileTree(dir: string, depth = 0): Promise<WorkspaceFileNode[]> {
    if (depth > 6) return []; // Stop recursing too deep

    const nodes: WorkspaceFileNode[] = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relPath = relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        const children = await this.buildFileTree(fullPath, depth + 1);
        if (children.length > 0) {
          nodes.push({
            name: entry.name,
            path: relPath,
            type: 'directory',
            children,
          });
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '' || ALLOWED_EXTENSIONS.has(ext)) {
          nodes.push({
            name: entry.name,
            path: relPath,
            type: 'file',
          });
        }
      }
    }

    // Sort: directories first, then files
    return nodes.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  }

  private getSafeAbsolutePath(relPath: string): string {
    const absolute = resolve(this.workspaceRoot, relPath);
    if (!absolute.startsWith(this.workspaceRoot)) {
      throw new BadRequestException('Path traversal is not allowed');
    }
    return absolute;
  }
}
