import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppBuilderStorageService } from './app-builder-storage.service';

describe('AppBuilderStorageService', () => {
  const makeService = () => {
    const tx = { $executeRawUnsafe: jest.fn() };
    const prisma = {
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ count: 0 }]),
      $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<void>) => callback(tx)),
    };
    const locks = {
      acquire: jest.fn().mockResolvedValue({ key: 'lock', token: 'token' }),
      release: jest.fn().mockResolvedValue(undefined),
      blobKey: jest.fn((workspaceId: string, hash: string) => `blob:${workspaceId}:${hash}`),
      blobRefsKey: jest.fn((workspaceId: string) => `blob-refs:${workspaceId}`),
    };
    return new AppBuilderStorageService(prisma as any, locks as any);
  };

  it('restores a content-addressed snapshot and removes files not in the snapshot when requested', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rawclaw-storage-'));
    const service = makeService();
    try {
      await writeFile(path.join(root, 'App.tsx'), 'before', 'utf8');
      const snapshot = await service.createSnapshot({
        workspaceRoot: root,
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      });

      await writeFile(path.join(root, 'App.tsx'), 'after', 'utf8');
      await writeFile(path.join(root, 'extra.ts'), 'remove me', 'utf8');
      await service.restoreSnapshot({ workspaceRoot: root, snapshot, removeFilesNotInSnapshot: true });

      await expect(readFile(path.join(root, 'App.tsx'), 'utf8')).resolves.toBe('before');
      expect(existsSync(path.join(root, 'extra.ts'))).toBe(false);
      expect(existsSync(path.join(root, '.app-builder', 'blobs', snapshot.fileHashes['App.tsx']))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
