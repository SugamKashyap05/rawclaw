import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { DocsCategory, DocsEntry, DocsEntrySummary, DocsIndexResponse } from '@rawclaw/shared';

type IndexedDoc = DocsEntry;

@Injectable()
export class DocsService {
  private readonly workspaceRoot = resolve(process.cwd(), '..', '..');
  private readonly docsRoot = resolve(this.workspaceRoot, 'docs');
  private readonly rootMarkdownFiles = ['README.md', 'CONTRIBUTING.md'];

  async getIndex(): Promise<DocsIndexResponse> {
    const entries = await this.loadDocs();
    return {
      generatedAt: new Date().toISOString(),
      total: entries.length,
      entries: entries.map(({ content, ...summary }) => summary),
    };
  }

  async getEntry(slug: string): Promise<DocsEntry> {
    const entries = await this.loadDocs();
    const entry = entries.find((item) => item.slug === slug);
    if (!entry) {
      throw new NotFoundException(`Documentation entry "${slug}" was not found.`);
    }
    return entry;
  }

  async getSystemContext(): Promise<string> {
    const entries = await this.loadDocs();
    const preferredPaths = new Set([
      'README.md',
      'docs/01-product-vision.md',
      'docs/02-architecture.md',
      'docs/04-core-systems.md',
      'docs/05-data-and-memory.md',
      'docs/06-mcp-and-tools.md',
      'docs/07-tasks-and-agents.md',
      'docs/11-roadmap.md',
      'docs/12-openclaw-gap-analysis.md',
    ]);

    const prioritized = entries.filter((entry) => preferredPaths.has(entry.relativePath)).slice(0, 9);

    const lines = prioritized.flatMap((entry) => [
      `## ${entry.title}`,
      entry.excerpt || entry.content.split(/\r?\n/).find((line) => line.trim().length > 0) || '',
      `Source: ${entry.relativePath}`,
      '',
    ]);

    return [
      'You are operating inside RawClaw, a local-first AI agent platform under active rebuild.',
      'Use the following system foundation as product and architecture context when answering, planning, or shaping outputs.',
      '',
      ...lines,
    ].join('\n');
  }

  private async loadDocs(): Promise<IndexedDoc[]> {
    const docsEntries = await this.collectMarkdownFiles(this.docsRoot, 'docs');
    const rootEntries = await Promise.all(
      this.rootMarkdownFiles.map(async (fileName) => {
        const absolutePath = resolve(this.workspaceRoot, fileName);
        try {
          return await this.buildEntry(absolutePath, 'root');
        } catch {
          return null;
        }
      }),
    );

    return [...docsEntries, ...rootEntries.filter((entry): entry is IndexedDoc => entry !== null)].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
    );
  }

  private async collectMarkdownFiles(directory: string, defaultCategory: DocsCategory): Promise<IndexedDoc[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const docs: IndexedDoc[] = [];

    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        docs.push(...(await this.collectMarkdownFiles(absolutePath, defaultCategory)));
        continue;
      }

      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') {
        continue;
      }

      const category = absolutePath.includes(`${sep}docs${sep}decisions${sep}`) ? 'decision' : defaultCategory;
      docs.push(await this.buildEntry(absolutePath, category));
    }

    return docs;
  }

  private async buildEntry(absolutePath: string, category: DocsCategory): Promise<IndexedDoc> {
    const content = await fs.readFile(absolutePath, 'utf8');
    const relativePath = relative(this.workspaceRoot, absolutePath).replace(/\\/g, '/');
    const title = this.extractTitle(content, absolutePath);
    const slug = relativePath.replace(/\.md$/i, '').replace(/\//g, '--').toLowerCase();
    const excerpt = this.extractExcerpt(content);
    const stats = await fs.stat(absolutePath);

    return {
      id: slug,
      slug,
      title,
      category,
      relativePath,
      excerpt,
      wordCount: content.trim().split(/\s+/).filter(Boolean).length,
      updatedAt: stats.mtime.toISOString(),
      content,
    };
  }

  private extractTitle(content: string, absolutePath: string): string {
    const heading = content.match(/^#\s+(.+)$/m);
    if (heading?.[1]) {
      return heading[1].trim();
    }
    return basename(absolutePath, '.md');
  }

  private extractExcerpt(content: string): string {
    const firstParagraph = content
      .split(/\r?\n\r?\n/)
      .map((block) => block.replace(/^#+\s+/gm, '').trim())
      .find((block) => block.length > 0);

    if (!firstParagraph) {
      return '';
    }

    return firstParagraph.length > 180 ? `${firstParagraph.slice(0, 177)}...` : firstParagraph;
  }
}
