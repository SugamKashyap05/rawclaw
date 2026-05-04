import { Injectable } from '@nestjs/common';
import { AppBuilderGenerationSnapshot } from '@rawclaw/shared';
import { createHash, randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma.service';
import { AppBuilderLockService } from './app-builder-lock.service';

type SnapshotManifest = AppBuilderGenerationSnapshot & {
  files: Record<string, { hash: string; size: number }>;
};

@Injectable()
export class AppBuilderStorageService {
  private readonly excludedSnapshotDirs = new Set(['.app-builder', '.git', 'node_modules', 'dist', '.vite', 'coverage']);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: AppBuilderLockService,
  ) {}

  async ensureSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_builder_blob_refs (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        blobHash TEXT NOT NULL,
        snapshotId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        filePath TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_builder_blob_refs_unique ON app_builder_blob_refs(workspaceId, blobHash, snapshotId, filePath)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_blob_refs_hash ON app_builder_blob_refs(workspaceId, blobHash)`);
    await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_app_builder_blob_refs_snapshot ON app_builder_blob_refs(snapshotId)`);
  }

  async writeBlob(workspaceRoot: string, workspaceId: string, bytes: Buffer): Promise<{ hash: string; blobPath: string }> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const blobDir = path.join(workspaceRoot, '.app-builder', 'blobs');
    const blobPath = path.join(blobDir, hash);
    await fs.mkdir(blobDir, { recursive: true });

    const lock = await this.locks.acquire(this.locks.blobKey(workspaceId, hash), `blob-writer:${process.pid}`, 30_000);
    if (!lock) {
      throw new Error(`Blob ${hash} is locked by another writer.`);
    }
    const tempPath = path.join(blobDir, `${hash}.${randomUUID()}.tmp`);
    try {
      if (existsSync(blobPath)) {
        await this.verifyBlob(blobPath, hash);
        return { hash, blobPath };
      }
      await fs.writeFile(tempPath, bytes);
      await this.verifyBlob(tempPath, hash);
      await fs.rename(tempPath, blobPath);
      return { hash, blobPath };
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      await this.locks.release(lock).catch(() => undefined);
    }
  }

  async replaceSnapshotRefs(input: {
    workspaceId: string;
    projectId: string;
    snapshotId: string;
    refs: Array<{ blobHash: string; filePath: string }>;
  }): Promise<void> {
    await this.ensureSchema();
    const lock = await this.locks.acquire(this.locks.blobRefsKey(input.workspaceId), `blob-refs:${process.pid}`, 30_000);
    if (!lock) {
      throw new Error(`Blob references for workspace ${input.workspaceId} are locked.`);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM app_builder_blob_refs WHERE snapshotId = ?`, input.snapshotId);
        for (const ref of input.refs) {
          await tx.$executeRawUnsafe(
            `INSERT OR IGNORE INTO app_builder_blob_refs (id, workspaceId, blobHash, snapshotId, projectId, filePath) VALUES (?, ?, ?, ?, ?, ?)`,
            randomUUID(),
            input.workspaceId,
            ref.blobHash,
            input.snapshotId,
            input.projectId,
            ref.filePath,
          );
        }
      });
    } finally {
      await this.locks.release(lock).catch(() => undefined);
    }
  }

  async blobReferenceCount(workspaceId: string, blobHash: string): Promise<number> {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*) as count FROM app_builder_blob_refs WHERE workspaceId = ? AND blobHash = ?`,
      workspaceId,
      blobHash,
    );
    return Number(rows[0]?.count || 0);
  }

  async createSnapshot(input: {
    workspaceRoot: string;
    workspaceId: string;
    projectId: string;
    baseSnapshotId?: string | null;
    status?: AppBuilderGenerationSnapshot['status'];
  }): Promise<SnapshotManifest> {
    await fs.mkdir(input.workspaceRoot, { recursive: true });
    const snapshotId = `snapshot-${randomUUID()}`;
    const fileEntries = await this.listSnapshotFiles(input.workspaceRoot);
    const files: Record<string, { hash: string; size: number }> = {};
    const refs: Array<{ blobHash: string; filePath: string }> = [];

    for (const relPath of fileEntries) {
      const absolute = this.resolveInside(input.workspaceRoot, relPath);
      const bytes = await fs.readFile(absolute);
      const blob = await this.writeBlob(input.workspaceRoot, input.workspaceId, bytes);
      files[relPath] = { hash: blob.hash, size: bytes.byteLength };
      refs.push({ blobHash: blob.hash, filePath: relPath });
    }

    const manifestPath = path.join(input.workspaceRoot, '.app-builder', 'snapshots', snapshotId, 'manifest.json');
    const manifest: SnapshotManifest = {
      id: snapshotId,
      projectId: input.projectId,
      baseSnapshotId: input.baseSnapshotId || null,
      status: input.status || 'initial',
      validationPassedAt: null,
      manifestPath,
      fileHashes: Object.fromEntries(Object.entries(files).map(([filePath, entry]) => [filePath, entry.hash])),
      files,
      createdAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await this.replaceSnapshotRefs({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      snapshotId,
      refs,
    });
    return manifest;
  }

  async readSnapshot(workspaceRoot: string, snapshotId: string): Promise<SnapshotManifest> {
    const manifestPath = this.resolveInside(path.join(workspaceRoot, '.app-builder', 'snapshots'), path.join(snapshotId, 'manifest.json'));
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as SnapshotManifest;
    return {
      ...parsed,
      files: parsed.files || Object.fromEntries(Object.entries(parsed.fileHashes || {}).map(([filePath, hash]) => [filePath, { hash, size: 0 }])),
    };
  }

  async restoreSnapshot(input: {
    workspaceRoot: string;
    snapshot: SnapshotManifest;
    removeFilesNotInSnapshot?: boolean;
  }): Promise<void> {
    await fs.mkdir(input.workspaceRoot, { recursive: true });
    const snapshotFiles = new Set(Object.keys(input.snapshot.files || input.snapshot.fileHashes || {}));

    if (input.removeFilesNotInSnapshot) {
      const currentFiles = await this.listSnapshotFiles(input.workspaceRoot);
      for (const relPath of currentFiles) {
        if (!snapshotFiles.has(relPath)) {
          await fs.rm(this.resolveInside(input.workspaceRoot, relPath), { force: true });
        }
      }
    }

    for (const [relPath, entry] of Object.entries(input.snapshot.files || {})) {
      const blobPath = path.join(input.workspaceRoot, '.app-builder', 'blobs', entry.hash);
      await this.verifyBlob(blobPath, entry.hash);
      const target = this.resolveInside(input.workspaceRoot, relPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(blobPath, target);
    }
  }

  async stageFiles(input: {
    workspaceRoot: string;
    stagingId: string;
    files: Record<string, string>;
  }): Promise<string> {
    const stagingRoot = path.join(input.workspaceRoot, '.app-builder', 'staging', input.stagingId);
    await fs.mkdir(stagingRoot, { recursive: true });
    for (const [relPath, content] of Object.entries(input.files)) {
      const target = this.resolveInside(stagingRoot, this.normalizeRelativePath(relPath));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    }
    return stagingRoot;
  }

  async readStagedFile(workspaceRoot: string, stagingId: string, relPath: string): Promise<string> {
    const stagingRoot = path.join(workspaceRoot, '.app-builder', 'staging', stagingId);
    return fs.readFile(this.resolveInside(stagingRoot, this.normalizeRelativePath(relPath)), 'utf8');
  }

  async deleteStaging(workspaceRoot: string, stagingId: string): Promise<void> {
    const stagingRoot = this.resolveInside(path.join(workspaceRoot, '.app-builder', 'staging'), stagingId);
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }

  async pruneSnapshots(input: {
    workspaceRoot: string;
    workspaceId: string;
    keepLatest: number;
    olderThanDays: number;
    protectedSnapshotIds?: string[];
  }): Promise<{ deletedSnapshots: string[]; deletedBlobs: string[] }> {
    const snapshotsRoot = path.join(input.workspaceRoot, '.app-builder', 'snapshots');
    const entries = await fs.readdir(snapshotsRoot, { withFileTypes: true }).catch(() => []);
    const protectedIds = new Set(input.protectedSnapshotIds || []);
    const manifests: Array<{ id: string; manifestPath: string; createdAt: number; fileHashes: Record<string, string> }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(snapshotsRoot, entry.name, 'manifest.json');
      const raw = await fs.readFile(manifestPath, 'utf8').catch(() => null);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as SnapshotManifest;
        manifests.push({
          id: parsed.id || entry.name,
          manifestPath,
          createdAt: Date.parse(parsed.createdAt) || 0,
          fileHashes: parsed.fileHashes || {},
        });
      } catch {
        continue;
      }
    }

    manifests.sort((a, b) => b.createdAt - a.createdAt);
    const keepRecent = new Set(manifests.slice(0, Math.max(1, input.keepLatest)).map((entry) => entry.id));
    const cutoff = Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000;
    const deletedSnapshots: string[] = [];
    const candidateBlobHashes = new Set<string>();

    for (const manifest of manifests) {
      if (protectedIds.has(manifest.id) || keepRecent.has(manifest.id) || manifest.createdAt >= cutoff) {
        continue;
      }
      const lock = await this.locks.acquire(this.locks.blobRefsKey(input.workspaceId), `snapshot-prune:${process.pid}`, 30_000);
      if (!lock) continue;
      try {
        for (const hash of Object.values(manifest.fileHashes)) {
          candidateBlobHashes.add(hash);
        }
        await this.prisma.$executeRawUnsafe(`DELETE FROM app_builder_blob_refs WHERE snapshotId = ?`, manifest.id);
        await fs.rm(path.dirname(manifest.manifestPath), { recursive: true, force: true });
        deletedSnapshots.push(manifest.id);
      } finally {
        await this.locks.release(lock).catch(() => undefined);
      }
    }

    const deletedBlobs: string[] = [];
    for (const hash of candidateBlobHashes) {
      if (!hash || await this.blobReferenceCount(input.workspaceId, hash) > 0) {
        continue;
      }
      const blobPath = path.join(input.workspaceRoot, '.app-builder', 'blobs', hash);
      await fs.rm(blobPath, { force: true }).catch(() => undefined);
      deletedBlobs.push(hash);
    }
    return { deletedSnapshots, deletedBlobs };
  }

  hashContent(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private async verifyBlob(filePath: string, expectedHash: string): Promise<void> {
    const bytes = await fs.readFile(filePath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expectedHash) {
      throw new Error(`Blob hash mismatch for ${filePath}.`);
    }
  }

  private async listSnapshotFiles(root: string, current = root): Promise<string[]> {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const entryName = String(entry.name);
      if (entry.isDirectory()) {
        if (this.excludedSnapshotDirs.has(entryName)) {
          continue;
        }
        files.push(...(await this.listSnapshotFiles(root, path.join(current, entryName))));
        continue;
      }
      if (entry.isFile()) {
        files.push(this.normalizeRelativePath(path.relative(root, path.join(current, entryName))));
      }
    }
    return files.sort((a, b) => a.localeCompare(b));
  }

  private resolveInside(root: string, relativePath: string): string {
    if (!relativePath || relativePath.includes('\0')) {
      throw new Error('A valid relative path is required.');
    }
    const rootPath = path.resolve(root);
    const target = path.resolve(rootPath, relativePath);
    const relative = path.relative(rootPath, target);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path ${relativePath} is outside the workspace root.`);
    }
    return target;
  }

  private normalizeRelativePath(value: string): string {
    if (!value || path.isAbsolute(value) || value.includes('\0')) {
      throw new Error('A valid relative path is required.');
    }
    return value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  }
}
