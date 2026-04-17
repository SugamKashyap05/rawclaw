export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  source: string | null;
  collection: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStats {
  totalEntries: number;
  collections: string[];
  embeddingModel: string;
}

export interface MemorySearchRequest {
  query?: string;
  tags?: string[];
  source?: string;
  collection?: string;
}

export interface MemorySearchResult extends MemoryEntry {
  score: number;
  preview: string;
}
