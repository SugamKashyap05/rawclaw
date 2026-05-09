import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { CommandMemoryOverview, MemoryEntry, MemorySearchRequest, MemorySearchResult, MemoryStats } from '@rawclaw/shared';
import { PrismaService } from './prisma.service';

type PrismaMemoryRow = {
  id: string;
  content: string;
  tags: string | null;
  source: string | null;
  collection: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get agentUrl(): string {
    return this.configService.get<string>('agentUrl') || 'http://localhost:8001';
  }

  async getStats(): Promise<MemoryStats> {
    try {
      const response = await firstValueFrom(this.httpService.get<MemoryStats>(`${this.agentUrl}/api/memory/stats`));
      return response.data;
    } catch {
      return this.getFallbackStats();
    }
  }

  async add(payload: { content: string; tags?: string[]; source?: string; collection?: string }): Promise<MemoryEntry> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<MemoryEntry>(`${this.agentUrl}/api/memory/add`, payload),
      );
      const entry = response.data;
      await this.prisma.memoryEntry.upsert({
        where: { id: entry.id },
        update: {
          content: entry.content,
          tags: JSON.stringify(entry.tags ?? []),
          source: entry.source ?? null,
          collection: entry.collection?.trim() || payload.collection?.trim() || 'default',
        },
        create: {
          id: entry.id,
          content: entry.content,
          tags: JSON.stringify(entry.tags ?? []),
          source: entry.source ?? null,
          collection: entry.collection?.trim() || payload.collection?.trim() || 'default',
        },
      });
      return entry;
    } catch {
      return this.addFallback(payload);
    }
  }

  async search(query: MemorySearchRequest): Promise<MemorySearchResult[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<{ results: MemorySearchResult[] }>(`${this.agentUrl}/api/memory/search`, query),
      );
      return response.data.results;
    } catch {
      return this.searchFallback(query);
    }
  }

  async clear(collection?: string): Promise<{ cleared: number }> {
    // Memory scope clearing is intentionally independent from pending NLU clarification state.
    try {
      const response = await firstValueFrom(
        this.httpService.delete<{ cleared: number }>(`${this.agentUrl}/api/memory/clear`, {
          params: collection ? { collection } : undefined,
        }),
      );
      return response.data;
    } catch {
      return this.clearFallback(collection);
    }
  }

  async dedupeToolDiscovery(dryRun = false): Promise<{
    collection: string;
    totalEntries: number;
    duplicatesRemoved: number;
    keptEntries: number;
    dryRun?: boolean;
    error?: string;
  }> {
    return await firstValueFrom(
      this.httpService.post<{
        collection: string;
        totalEntries: number;
        duplicatesRemoved: number;
        keptEntries: number;
        dryRun?: boolean;
        error?: string;
      }>(`${this.agentUrl}/api/memory/maintenance/dedupe-tool-discovery`, { dryRun }),
    ).then((response) => response.data);
  }

  async pruneSessionIndex(options: { ttlDays?: number; maxEntriesPerSession?: number; dryRun?: boolean } = {}): Promise<{
    collection: string;
    totalEntries: number;
    deletedEntries: number;
    remainingEntries: number;
    sessionsTouched: number;
    ttlDays: number;
    maxEntriesPerSession: number;
    dryRun?: boolean;
    error?: string;
  }> {
    return await firstValueFrom(
      this.httpService.post<{
        collection: string;
        totalEntries: number;
        deletedEntries: number;
        remainingEntries: number;
        sessionsTouched: number;
        ttlDays: number;
        maxEntriesPerSession: number;
        dryRun?: boolean;
        error?: string;
      }>(`${this.agentUrl}/api/memory/maintenance/prune-sessions`, {
        ttlDays: options.ttlDays ?? 14,
        maxEntriesPerSession: options.maxEntriesPerSession ?? 100,
        dryRun: options.dryRun ?? false,
      }),
    ).then((response) => response.data);
  }

  async listEntries(options?: { collection?: string; source?: string; limit?: number }): Promise<MemoryEntry[]> {
    const rows = await this.prisma.memoryEntry.findMany({
      where: {
        ...(options?.collection ? { collection: options.collection } : {}),
        ...(options?.source ? { source: options.source } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: options?.limit ?? 50,
    });

    return rows.map((row) => this.toEntry(row));
  }

  async deleteEntry(id: string): Promise<{ success: true }> {
    await this.prisma.memoryEntry.delete({ where: { id } });
    return { success: true };
  }

  async updateEntry(id: string, payload: { content?: string; tags?: string[] }): Promise<MemoryEntry> {
    const updated = await this.prisma.memoryEntry.update({
      where: { id },
      data: {
        ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
        ...(Array.isArray(payload.tags) ? { tags: JSON.stringify(payload.tags) } : {}),
      },
    });
    return this.toEntry(updated);
  }

  async getCommandOverview(sessionId?: string): Promise<CommandMemoryOverview> {
    const [operator, mission, recent, session] = await Promise.all([
      this.listEntries({ collection: 'operator', limit: 10 }),
      this.listEntries({ collection: 'mission', limit: 10 }),
      this.listEntries({ limit: 12 }),
      this.listEntries({ collection: 'session', source: sessionId ? `session:${sessionId}` : undefined, limit: 10 }),
    ]);

    return {
      operator,
      mission,
      session,
      recent,
    };
  }

  private async getFallbackStats(): Promise<MemoryStats> {
    const [count, collections, rows] = await Promise.all([
      this.prisma.memoryEntry.count(),
      this.prisma.memoryEntry.findMany({
        distinct: ['collection'],
        select: { collection: true },
        orderBy: { collection: 'asc' },
      }),
      this.prisma.memoryEntry.findMany({
        select: { collection: true },
      }),
    ]);
    const collectionCounts = rows.reduce<Record<string, number>>((acc, row: { collection: string }) => {
      acc[row.collection] = (acc[row.collection] || 0) + 1;
      return acc;
    }, {});
    const warnings: string[] = [];
    if (count > 5000) {
      warnings.push('Vector memory is large. Review session retention and cleanup.');
    }
    for (const [collection, collectionCount] of Object.entries(collectionCounts)) {
      if (collectionCount > 1000) {
        warnings.push(`Collection "${collection}" is large (${collectionCount} entries).`);
      }
    }

    return {
      totalEntries: count,
      collections: collections.map((item: { collection: string }) => item.collection),
      collectionCounts,
      embeddingModel: 'prisma fallback (agent memory unavailable)',
      warnings,
    };
  }

  private async addFallback(payload: { content: string; tags?: string[]; source?: string; collection?: string }): Promise<MemoryEntry> {
    const entry = await this.prisma.memoryEntry.create({
      data: {
        content: payload.content,
        tags: JSON.stringify(payload.tags ?? []),
        source: payload.source ?? null,
        collection: payload.collection?.trim() || 'default',
      },
    });

    return this.toEntry(entry);
  }

  private async searchFallback(query: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const rows = await this.prisma.memoryEntry.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    const normalizedQuery = query.query?.trim().toLowerCase() || '';
    const requestedTags = (query.tags ?? []).map((tag) => tag.toLowerCase());
    const requestedSource = query.source?.trim().toLowerCase();
    const requestedCollection = query.collection?.trim().toLowerCase();

    return rows
      .map((row) => this.toSearchResult(row, normalizedQuery))
      .filter((entry: MemorySearchResult) => {
        const tagSet = entry.tags.map((tag) => tag.toLowerCase());
        const collectionMatch = !requestedCollection || entry.collection.toLowerCase() === requestedCollection;
        const sourceMatch = !requestedSource || (entry.source ?? '').toLowerCase().includes(requestedSource);
        const tagsMatch = requestedTags.length === 0 || requestedTags.every((tag) => tagSet.includes(tag));
        const queryMatch = !normalizedQuery || entry.score > 0;
        return collectionMatch && sourceMatch && tagsMatch && queryMatch;
      })
      .sort((a: MemorySearchResult, b: MemorySearchResult) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  }

  private async clearFallback(collection?: string): Promise<{ cleared: number }> {
    const result = await this.prisma.memoryEntry.deleteMany({
      where: collection ? { collection } : undefined,
    });
    return { cleared: result.count };
  }

  private toEntry(row: PrismaMemoryRow): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      tags: this.parseTags(row.tags),
      source: row.source,
      collection: row.collection,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toSearchResult(row: PrismaMemoryRow, normalizedQuery: string): MemorySearchResult {
    const entry = this.toEntry(row);
    const haystack = `${entry.content} ${entry.tags.join(' ')} ${entry.source ?? ''}`.toLowerCase();
    const score = this.score(haystack, normalizedQuery, entry.tags);

    return {
      ...entry,
      score,
      preview: entry.content.length > 220 ? `${entry.content.slice(0, 217)}...` : entry.content,
    };
  }

  private parseTags(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  private score(haystack: string, query: string, tags: string[]): number {
    if (!query) return 1;

    const tokens = query.split(/\s+/).filter(Boolean);
    let score = 0;

    for (const token of tokens) {
      if (haystack.includes(token)) score += 2;
      if (tags.some((tag) => tag.toLowerCase() === token)) score += 3;
    }

    return score;
  }
}
