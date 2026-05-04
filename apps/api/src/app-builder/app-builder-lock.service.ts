import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis.service';

export type AppBuilderLockHandle = {
  key: string;
  token: string;
  owner: string;
  expiresAt: string;
};

@Injectable()
export class AppBuilderLockService {
  constructor(private readonly redis: RedisService) {}

  async acquire(key: string, owner: string, ttlMs: number): Promise<AppBuilderLockHandle | null> {
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const acquired = await this.redis.setJsonIfAbsent(key, { token, owner, expiresAt }, ttlSeconds);
    return acquired ? { key, token, owner, expiresAt } : null;
  }

  async read(key: string): Promise<AppBuilderLockHandle | null> {
    const value = await this.redis.getJson<AppBuilderLockHandle>(key);
    return value || null;
  }

  async extend(handle: AppBuilderLockHandle, ttlMs: number): Promise<AppBuilderLockHandle | null> {
    const current = await this.read(handle.key);
    if (!current || current.token !== handle.token) {
      return null;
    }
    const next: AppBuilderLockHandle = {
      ...handle,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    await this.redis.setJson(handle.key, next, Math.max(1, Math.ceil(ttlMs / 1000)));
    return next;
  }

  async release(handle: AppBuilderLockHandle): Promise<boolean> {
    const current = await this.read(handle.key);
    if (!current || current.token !== handle.token) {
      return false;
    }
    await this.redis.delete(handle.key);
    return true;
  }

  workflowKey(projectId: string): string {
    return `app-builder:workflow-lock:${projectId}`;
  }

  cleanupKey(projectId: string): string {
    return `app-builder:cleanup-lock:${projectId}`;
  }

  controlTestKey(projectId: string): string {
    return `app-builder:control-test-lock:${projectId}`;
  }

  blobKey(workspaceId: string, hash: string): string {
    return `app-builder:blob-lock:${workspaceId}:${hash}`;
  }

  blobRefsKey(workspaceId: string): string {
    return `app-builder:blob-refs-lock:${workspaceId}`;
  }
}
