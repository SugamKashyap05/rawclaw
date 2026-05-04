import { BadRequestException, Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

@Injectable()
export class SecureWorkspacePathService {
  resolveInside(root: string, relativeOrAbsolutePath: string): string {
    if (!relativeOrAbsolutePath || typeof relativeOrAbsolutePath !== 'string') {
      throw new BadRequestException('A file path is required.');
    }
    if (relativeOrAbsolutePath.includes('\0')) {
      throw new BadRequestException('File path contains an invalid null byte.');
    }
    const rootPath = path.resolve(root);
    const requested = path.isAbsolute(relativeOrAbsolutePath)
      ? path.resolve(relativeOrAbsolutePath)
      : path.resolve(rootPath, relativeOrAbsolutePath);
    if (!this.isInside(rootPath, requested)) {
      throw new BadRequestException(`Path ${relativeOrAbsolutePath} is outside the project workspace.`);
    }
    return requested;
  }

  async resolveExistingInside(root: string, relativeOrAbsolutePath: string): Promise<string> {
    const resolved = this.resolveInside(root, relativeOrAbsolutePath);
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(path.resolve(root)).catch(() => path.resolve(root)),
      fs.realpath(resolved).catch(() => resolved),
    ]);
    if (!this.isInside(realRoot, realTarget)) {
      throw new BadRequestException(`Path ${relativeOrAbsolutePath} resolves outside the project workspace.`);
    }
    return realTarget;
  }

  relative(root: string, target: string): string {
    const rootPath = path.resolve(root);
    const targetPath = path.resolve(target);
    if (!this.isInside(rootPath, targetPath)) {
      throw new BadRequestException(`Path ${target} is outside the project workspace.`);
    }
    return path.relative(rootPath, targetPath).replace(/\\/g, '/');
  }

  private isInside(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  }
}
