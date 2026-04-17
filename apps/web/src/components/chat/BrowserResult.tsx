import { ToolResult } from '@rawclaw/shared';

export function BrowserResult({ result }: { result: ToolResult }) {
  const payload = toRecord(result.output);
  const url = asString(payload.url) || result.source_url || asString(result.input?.url);
  const title = asString(payload.title) || asString(payload.page_title);
  const content = asString(payload.content) || asString(payload.text) || JSON.stringify(result.output, null, 2);
  const screenshot = asString(payload.screenshot) || asString(payload.screenshot_url) || asString(payload.image_url);

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.8rem' }}>
      <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem' }}>
        BROWSER RESULT
      </div>
      {title ? <div style={{ fontSize: '1rem', fontWeight: 700 }}>{title}</div> : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.78rem' }}>
          {url}
        </a>
      ) : null}
      {screenshot ? (
        <img
          src={screenshot}
          alt={title || 'Browser screenshot'}
          style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--border-glass)', maxHeight: '260px', objectFit: 'cover' }}
        />
      ) : null}
      <pre
        className="custom-scrollbar"
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          maxHeight: '260px',
          padding: '0.85rem',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        {content}
      </pre>
    </div>
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
