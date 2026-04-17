import { ToolResult } from '@rawclaw/shared';

interface SearchEntry {
  title?: string;
  url?: string;
  snippet?: string;
}

export function WebSearchResult({ result }: { result: ToolResult }) {
  const payload = asObject(result.output);
  const query = asString(payload.query) || asString(result.input?.query) || 'Unknown query';
  const results = Array.isArray(payload.results) ? payload.results.map(asObject) : [];

  return (
    <div className="glass-card" style={{ padding: '1rem' }}>
      <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem', marginBottom: '0.6rem' }}>
        WEB SEARCH
      </div>
      <div style={{ marginBottom: '0.85rem', color: 'var(--text-secondary)' }}>Query: {query}</div>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {results.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>No search results were captured for this tool run.</div>
        ) : (
          results.map((entry, index) => {
            const item = entry as SearchEntry;
            return (
              <a
                key={`${item.url || item.title || index}`}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '12px',
                  padding: '0.9rem',
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>
                  [{index + 1}] {item.title || item.url || 'Untitled result'}
                </div>
                {item.url ? (
                  <div className="mono" style={{ fontSize: '0.74rem', color: 'var(--neon-cyan)', marginBottom: '0.35rem' }}>
                    {item.url}
                  </div>
                ) : null}
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>{item.snippet || 'No snippet available.'}</div>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
