import { useState } from 'react';
import { ToolResult } from '@rawclaw/shared';
import { ToolActivityCard, ToolActivityStatus } from './ToolActivityCard';
import { toRecord, asString, CollapsiblePre } from './toolResultUtils';
import { isPayloadLikeText } from './tracePresentation';

function resolveBrowserStatus(result: ToolResult, payload: Record<string, unknown>): ToolActivityStatus {
  const backendResult = asString(payload.backendResult);
  const evidenceStatus = asString(payload.evidenceStatus);
  const isFallback = Boolean(payload.isFallback);

  if (backendResult === 'skipped') return 'skipped';
  if (backendResult === 'failed' || result.error) return 'failed';
  if (backendResult === 'garbage' || evidenceStatus === 'degraded' || isFallback) return 'degraded';
  return 'success';
}

function renderStatePill(label: string, tone: 'info' | 'warning' | 'neutral' = 'info') {
  const toneStyles = {
    info: {
      color: 'var(--neon-cyan)',
      background: 'rgba(0,240,255,0.08)',
      border: '1px solid rgba(0,240,255,0.2)',
    },
    warning: {
      color: '#f59e0b',
      background: 'rgba(245,158,11,0.12)',
      border: '1px solid rgba(245,158,11,0.2)',
    },
    neutral: {
      color: '#c084fc',
      background: 'rgba(192,132,252,0.12)',
      border: '1px solid rgba(192,132,252,0.2)',
    },
  } as const;
  const style = toneStyles[tone];

  return (
    <span
      key={label}
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontSize: '0.68rem',
        color: style.color,
        background: style.background,
        padding: '2px 8px',
        borderRadius: '10px',
        border: style.border,
      }}
    >
      {label}
    </span>
  );
}

function hasRenderableExtractedContent(
  extractedContent: string,
  payload: Record<string, unknown>,
  status: ToolActivityStatus,
): boolean {
  const normalized = extractedContent.trim();
  if (!normalized) return false;

  const wordCount = Number(payload.wordCount || 0);
  const evidenceStatus = asString(payload.evidenceStatus);

  // Successful or trusted page reads can legitimately contain rich markdown,
  // links, and punctuation that look "payload-like" to generic trace heuristics.
  // Treat those as real content when the page-read metadata says we recovered text.
  if ((Number.isFinite(wordCount) && wordCount > 0) || status === 'success' || evidenceStatus === 'strong' || evidenceStatus === 'medium') {
    return true;
  }

  return !isPayloadLikeText(normalized);
}

export function BrowserResult({ result, framed = true }: { result: ToolResult; framed?: boolean }) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const payload = toRecord(result.output);
  const url = asString(payload.url) || result.source_url || asString(result.input?.url);
  const title = asString(payload.title) || asString(payload.page_title);
  const extractedContent = asString(payload.content) || asString(payload.text) || '';
  const screenshot = asString(payload.screenshot) || asString(payload.screenshot_url) || asString(payload.image_url);
  const backendResult = asString(payload.backendResult);
  const evidenceStatus = asString(payload.evidenceStatus);
  const redirectedUrl = asString(payload.redirectedUrl);
  const isFallback = Boolean(payload.isFallback);
  const fallbackAttempted = Boolean(payload.fallbackAttempted);
  // v15.3 sends payload.contentTruncated when available; until rollout is uniform,
  // keep result.is_truncated as the legacy fallback signal for the truncation note.
  const contentTruncated = Boolean(payload.contentTruncated || result.is_truncated);
  const status = resolveBrowserStatus(result, payload);
  const statusPills = [
    backendResult ? renderStatePill(`backend:${backendResult}`, backendResult === 'skipped' ? 'neutral' : backendResult === 'success' ? 'info' : 'warning') : null,
    evidenceStatus ? renderStatePill(`evidence:${evidenceStatus}`, evidenceStatus === 'strong' || evidenceStatus === 'medium' ? 'info' : 'warning') : null,
    isFallback ? renderStatePill('fallback response', 'warning') : null,
    !isFallback && fallbackAttempted ? renderStatePill('fallback attempted', 'warning') : null,
    contentTruncated ? renderStatePill('content truncated', 'warning') : null,
  ].filter(Boolean);
  const queueFullNote = backendResult === 'skipped' && (result.error || '').toLowerCase().includes('browser queue full');
  const showRedirect = Boolean(redirectedUrl) && redirectedUrl !== url;
  const hasMeaningfulContent = hasRenderableExtractedContent(extractedContent, payload, status);
  const technicalPayload = JSON.stringify(result.output, null, 2);
  const hasTechnicalDetails = Boolean(technicalPayload && technicalPayload !== '{}' && (!hasMeaningfulContent || status !== 'success'));

  const content = (
    <>
      {statusPills.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
          {statusPills}
        </div>
      ) : null}
      {queueFullNote ? (
        <div
          style={{
            color: '#c084fc',
            background: 'rgba(192,132,252,0.08)',
            border: '1px solid rgba(192,132,252,0.18)',
            borderRadius: '10px',
            padding: '0.7rem 0.85rem',
            fontSize: '0.84rem',
          }}
        >
          Not attempted - browser queue was full.
        </div>
      ) : null}
      {title ? <div style={{ fontSize: '1rem', fontWeight: 700 }}>{title}</div> : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.78rem' }}>
          {url}
        </a>
      ) : null}
      {showRedirect ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Final URL: <span className="mono" style={{ color: 'var(--text-primary)' }}>{redirectedUrl}</span>
        </div>
      ) : null}
      {screenshot ? (
        <img
          src={screenshot}
          alt={title || 'Browser screenshot'}
          style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--border-glass)', maxHeight: '260px', objectFit: 'cover' }}
        />
      ) : null}
      {result.error && !queueFullNote ? (
        <div
          style={{
            color: 'var(--error)',
            padding: '0.75rem',
            background: 'rgba(255, 77, 77, 0.08)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 77, 77, 0.2)',
            fontSize: '0.84rem',
          }}
        >
          No usable page content was extracted from this page.
        </div>
      ) : null}
      {!result.error && !queueFullNote && !hasMeaningfulContent ? (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '0.75rem',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '8px',
            border: '1px solid var(--border-glass)',
            fontSize: '0.84rem',
          }}
        >
          No usable page content was extracted from this page.
        </div>
      ) : null}
      {hasMeaningfulContent ? <CollapsiblePre>{extractedContent!}</CollapsiblePre> : null}
      {hasTechnicalDetails ? (
        <div style={{ border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '0.35rem 0.4rem', background: 'rgba(255,255,255,0.02)' }}>
          <button
            type="button"
            onClick={() => setShowTechnicalDetails((current) => !current)}
            style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.8rem', background: 'transparent', border: 'none', padding: 0 }}
          >
            Technical details
          </button>
          {showTechnicalDetails ? (
            <div style={{ marginTop: '0.5rem' }}>
              <CollapsiblePre>{technicalPayload}</CollapsiblePre>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (!framed) {
    return content;
  }

  return (
    <ToolActivityCard sourceLabel="Browser Result" status={status} durationMs={result.duration_ms}>
      {content}
    </ToolActivityCard>
  );
}
