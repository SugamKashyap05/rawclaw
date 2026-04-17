export type DocsCategory = 'root' | 'docs' | 'decision';

export interface DocsEntrySummary {
  id: string;
  slug: string;
  title: string;
  category: DocsCategory;
  relativePath: string;
  excerpt: string;
  wordCount: number;
  updatedAt: string;
}

export interface DocsEntry extends DocsEntrySummary {
  content: string;
}

export interface DocsIndexResponse {
  generatedAt: string;
  total: number;
  entries: DocsEntrySummary[];
}
