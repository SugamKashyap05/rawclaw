import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantState, CommandMemoryOverview, MemorySearchResult, MemoryStats } from '@rawclaw/shared';
import Memory from './Memory';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}));

const STATS: MemoryStats = {
  totalEntries: 22793,
  collections: ['sessions', 'tool_discovery', 'operator'],
  collectionCounts: {
    sessions: 20010,
    tool_discovery: 2265,
    operator: 34,
  },
  embeddingModel: 'all-MiniLM-L6-v2 + ChromaDB + Wikipedia augmentation',
  warnings: [
    'Vector memory is large. Review session retention and cleanup.',
    'Collection "sessions" is large (20010 entries).',
  ],
};

const OVERVIEW: CommandMemoryOverview = {
  operator: [
    {
      id: 'operator-1',
      content: 'Operator preferred name: Maya',
      collection: 'operator',
      source: 'assistant-state',
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
  mission: [
    {
      id: 'mission-1',
      content: 'Mission summary: the RawClaw JARVIS rollout',
      collection: 'mission',
      source: 'assistant-state',
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
  session: [
    {
      id: 'session-1',
      content: 'Remember launch notes for this chat',
      collection: 'session',
      source: 'session:chat-1',
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
  recent: [],
};

const ASSISTANT_STATE: AssistantState = {
  operatorProfile: {
    name: 'Maya',
    preferences: ['concise briefings'],
    priorities: [],
    notes: [],
  },
  missionSummary: 'the RawClaw JARVIS rollout',
  activeFocus: ['operator dashboard'],
  commitments: [],
  pendingFollowUps: [],
  advisoryStatus: 'advisory-first',
  updatedAt: new Date().toISOString(),
};

const SEARCH_RESULTS: MemorySearchResult[] = [
  {
    id: 'entry-1',
    content: 'Operator preference: concise briefings',
    preview: 'Operator preference: concise briefings',
    score: 1,
    tags: ['operator'],
    source: 'assistant-state',
    collection: 'operator',
    createdAt: '',
    updatedAt: '',
  },
];

describe('Memory page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockImplementation((url: string) => {
      if (url === '/memory/stats') return Promise.resolve({ data: STATS });
      if (url === '/memory/overview') return Promise.resolve({ data: OVERVIEW });
      if (url === '/assistant/state') return Promise.resolve({ data: ASSISTANT_STATE });
      throw new Error(`Unhandled GET ${url}`);
    });
    apiPost.mockImplementation((url: string) => {
      if (url === '/memory/search') return Promise.resolve({ data: { results: SEARCH_RESULTS } });
      throw new Error(`Unhandled POST ${url}`);
    });
    apiDelete.mockResolvedValue({ data: {} });
  });

  it('separates profile memory from vector memory and shows health warnings', async () => {
    render(<Memory />);

    await screen.findByText('Profile Memory');

    expect(screen.getByText('Vector Memory Entries')).toBeInTheDocument();
    expect(screen.getByText('PRISMA + ASSISTANT STATE')).toBeInTheDocument();
    expect(screen.getByText('CHROMA RETRIEVAL INDEX')).toBeInTheDocument();
    expect(screen.getByText('Vector memory is large. Review session retention and cleanup.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sessions \(20010\)/i })).toBeInTheDocument();

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/memory/search',
        expect.objectContaining({
          collection: 'operator',
        }),
      ),
    );
  });
});
