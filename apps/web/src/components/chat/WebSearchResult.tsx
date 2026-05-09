import { ToolResult } from '@rawclaw/shared';
import { ToolActivityCard } from './ToolActivityCard';
import { resolveToolResultStatus } from './toolResultNarratives';

interface SearchEntry {
  title?: string;
  url?: string;
  snippet?: string;
}

export function WebSearchResult({ result, framed = true }: { result: ToolResult; framed?: boolean }) {
  const payload = asObject(result.output);
  const query = asString(payload.query) || asString(result.input?.query) || 'Unknown query';
  const results = Array.isArray(payload.results) ? payload.results.map(asObject) : [];
  const error = result.error || (payload.error as string);
  const resultQuality = asString(payload.result_quality);
  const qualityAssessment = asString(payload.quality_assessment);
  const status = resolveToolResultStatus(result);

  const content = (
    <>
      <div style={{ marginBottom: '0.85rem', color: 'var(--text-secondary)' }}>Query: {query}</div>
      {!error && (resultQuality || qualityAssessment) ? (
        <div style={{
          marginBottom: '0.85rem',
          color: resultQuality === 'strong' ? 'var(--neon-cyan)' : '#f59e0b',
          fontSize: '0.85rem',
        }}>
          {resultQuality ? `Quality: ${resultQuality}. ` : ''}{qualityAssessment || ''}
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {error ? (
          <div style={{
            color: 'var(--error)',
            padding: '0.75rem',
            background: 'rgba(255, 77, 77, 0.08)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 77, 77, 0.2)'
          }}>
            <strong style={{ fontSize: '0.75rem' }}>SEARCH FAILED</strong>
            <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>{error}</div>
          </div>
        ) : results.length === 0 ? (
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
    </>
  );

  if (!framed) {
    return content;
  }

  return (
    <ToolActivityCard sourceLabel="Web Search" status={status} durationMs={result.duration_ms}>
      {content}
    </ToolActivityCard>
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
