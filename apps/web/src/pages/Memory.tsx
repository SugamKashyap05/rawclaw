import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { FiBookOpen, FiDatabase, FiSearch, FiTrash2, FiUploadCloud, FiUser } from 'react-icons/fi';
import { AssistantState, CommandMemoryOverview, MemoryEntry, MemorySearchResult, MemoryStats } from '@rawclaw/shared';
import { api } from '../lib/api';

export default function Memory() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [overview, setOverview] = useState<CommandMemoryOverview | null>(null);
  const [assistantState, setAssistantState] = useState<AssistantState | null>(null);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [collection, setCollection] = useState('operator');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
    void runSearch();
  }, []);

  const load = async () => {
    const [statsRes, overviewRes, stateRes] = await Promise.all([
      api.get<MemoryStats>('/memory/stats').catch(() => null),
      api.get<CommandMemoryOverview>('/memory/overview').catch(() => null),
      api.get<AssistantState>('/assistant/state').catch(() => null),
    ]);
    setStats(statsRes?.data || null);
    setOverview(overviewRes?.data || null);
    setAssistantState(stateRes?.data || null);
  };

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    setSearching(true);
    setMessage(null);
    try {
      const res = await api.post<{ results: MemorySearchResult[] }>('/memory/search', {
        query: query || undefined,
        tags: normalizeTags(tags),
        source: source || undefined,
        collection: collection || undefined,
      });
      setResults(res.data.results);
    } catch (error) {
      console.error('Failed to search memory', error);
      setMessage('Search failed. Check backend memory service.');
    } finally {
      setSearching(false);
    }
  };

  const addMemory = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;

    setSaving(true);
    setMessage(null);
    try {
      await api.post('/memory/add', {
        content,
        tags: normalizeTags(tags),
        source: source || undefined,
        collection: collection || 'default',
      });
      setContent('');
      setMessage('Memory entry saved successfully.');
      await load();
      await runSearch();
    } catch (error) {
      console.error('Failed to add memory', error);
      setMessage('Unable to save memory entry.');
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/memory/entries/${id}`);
      await load();
      await runSearch();
    } catch (error) {
      console.error('Failed to delete memory entry', error);
      setMessage('Unable to delete memory entry.');
    } finally {
      setDeletingId(null);
    }
  };

  const clearMemory = async () => {
    const confirmed = window.confirm(
      collection
        ? `Clear all entries in collection "${collection}"?`
        : 'Clear all memory entries?',
    );
    if (!confirmed) return;

    try {
      await api.delete('/memory/clear', { params: collection ? { collection } : undefined });
      setMessage('Memory cleared.');
      await load();
      await runSearch();
    } catch (error) {
      console.error('Failed to clear memory', error);
      setMessage('Unable to clear memory.');
    }
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.25rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '2.15rem', fontWeight: 800, marginBottom: '0.45rem' }}>Command Memory</h1>
            <p className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              OPERATOR_PROFILE // MISSION_MEMORY // SESSION_RECALL
            </p>
          </div>
          <button className="btn-ghost" onClick={clearMemory} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FiTrash2 /> CLEAR_COLLECTION
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.85rem' }}>
          <Metric label="Total Entries" value={String(stats?.totalEntries ?? 0)} />
          <Metric label="Operator" value={String(overview?.operator.length ?? 0)} />
          <Metric label="Mission" value={String(overview?.mission.length ?? 0)} />
          <Metric label="Session" value={String(overview?.session.length ?? 0)} />
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.95fr)', gap: '1.25rem', alignItems: 'start' }}>
        <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <FiUser />
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>What RawClaw Knows</h2>
          </div>
          <Detail title="Operator" body={assistantState?.operatorProfile.name || 'Operator name not set yet.'} />
          <Detail title="Preferences" body={(assistantState?.operatorProfile.preferences || []).join('; ') || 'No operator preferences stored yet.'} />
          <Detail title="Mission Summary" body={assistantState?.missionSummary || 'No mission summary is pinned yet.'} />
          <Detail title="Active Focus" body={(assistantState?.activeFocus || []).join('; ') || 'No active focus items are pinned.'} />
          <Detail
            title="Commitments"
            body={assistantState?.commitments.filter((item) => item.status === 'active').map((item) => item.summary).join('; ') || 'No active commitments are being tracked.'}
          />
        </div>

        <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <FiBookOpen />
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Memory Layers</h2>
          </div>
          <LayerPreview title="Operator Memory" items={overview?.operator || []} />
          <LayerPreview title="Mission Memory" items={overview?.mission || []} />
          <LayerPreview title="Session Memory" items={overview?.session || []} />
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <FiDatabase style={{ color: 'var(--neon-cyan)' }} />
              <span className="mono" style={{ fontSize: '0.8rem' }}>[ MEMORY_STATS ]</span>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Total Entries</span>
                <strong>{stats?.totalEntries ?? '...'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Collections</span>
                <strong>{stats?.collections.length ?? 0}</strong>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                Embedding Mode: {stats?.embeddingModel ?? 'loading'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                {(stats?.collections || ['operator', 'mission', 'session', 'default']).map((item: string) => (
                  <button
                    key={item}
                    className="btn-ghost"
                    onClick={() => setCollection(item)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.7rem',
                      borderColor: collection === item ? 'var(--neon-cyan)' : undefined,
                      color: collection === item ? 'var(--neon-cyan)' : undefined,
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <form className="glass-card" onSubmit={addMemory}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <FiUploadCloud style={{ color: 'var(--neon-cyan)' }} />
              <span className="mono" style={{ fontSize: '0.8rem' }}>[ ADD_MEMORY ]</span>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Store operator facts, mission notes, or reusable context..."
                rows={8}
                style={textAreaStyle}
              />
              <input value={collection} onChange={(event) => setCollection(event.target.value)} placeholder="Collection" style={inputStyle} />
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags: operator, mission, preference" style={inputStyle} />
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Source label or URL" style={inputStyle} />
              <button className="btn-primary" disabled={saving || !content.trim()}>
                {saving ? 'SAVING...' : 'SAVE_ENTRY'}
              </button>
            </div>
          </form>
        </aside>

        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <form className="glass-card" onSubmit={runSearch}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <FiSearch style={{ color: 'var(--neon-cyan)' }} />
              <span className="mono" style={{ fontSize: '0.8rem' }}>[ SEARCH_MEMORY ]</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.75rem' }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory..." style={inputStyle} />
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Filter tags" style={inputStyle} />
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Filter source" style={inputStyle} />
              <button className="btn-primary" disabled={searching}>{searching ? 'SCANNING...' : 'SEARCH'}</button>
            </div>
            {message && (
              <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{message}</div>
            )}
          </form>

          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>Search Results</h2>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{results.length} MATCHES</span>
            </div>

            {results.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
                No memory entries matched the current filters.
              </div>
            ) : (
              results.map((entry) => (
                <MemoryResultCard key={entry.id} entry={entry} deleting={deletingId === entry.id} onDelete={() => void deleteEntry(entry.id)} />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MemoryResultCard({ entry, deleting, onDelete }: { entry: MemorySearchResult; deleting: boolean; onDelete: () => void }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-glass)',
        borderRadius: '8px',
        padding: '1rem',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '1rem' }}>
        <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--neon-cyan)' }}>
          {entry.collection.toUpperCase()}
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            SCORE {entry.score}
          </div>
          <button className="btn-ghost" onClick={onDelete} disabled={deleting} style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
      <div style={{ fontSize: '0.95rem', lineHeight: 1.6 }}>{entry.preview}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
        {entry.tags.map((tag: string) => (
          <span key={tag} className="mono" style={tagStyle}>{tag}</span>
        ))}
        {entry.source && (
          <span className="mono" style={tagStyle}>SRC {entry.source}</span>
        )}
      </div>
    </div>
  );
}

function LayerPreview({ title, items }: { title: string; items: MemoryEntry[] }) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{title.toUpperCase()}</div>
      {items.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>Nothing stored yet.</div>
      ) : (
        items.slice(0, 3).map((item) => (
          <div key={item.id} style={layerCardStyle}>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{item.content}</div>
          </div>
        ))
      )}
    </div>
  );
}

function Detail({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: 'grid', gap: '0.22rem' }}>
      <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{title.toUpperCase()}</div>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: 'rgba(255,255,255,0.05)' }}>
      <div style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '0.25rem' }}>{value}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>{label}</div>
    </div>
  );
}

function normalizeTags(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.75rem',
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid var(--border-glass)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
};

const textAreaStyle: CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
};

const tagStyle: CSSProperties = {
  fontSize: '0.65rem',
  background: 'rgba(255,255,255,0.05)',
  borderRadius: '999px',
  padding: '0.2rem 0.5rem',
  color: 'var(--text-secondary)',
};

const layerCardStyle: CSSProperties = {
  border: '1px solid var(--border-glass)',
  borderRadius: '12px',
  padding: '0.75rem',
  background: 'rgba(255,255,255,0.03)',
};
