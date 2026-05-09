import { FiAlertTriangle, FiRotateCw } from 'react-icons/fi';

export function InterruptedBanner({
  details,
  onRetry,
  isRetrying = false,
  attempt = 0,
  maxAttempts = 3,
}: {
  details?: string;
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean;
  attempt?: number;
  maxAttempts?: number;
}) {
  const headline = isRetrying
    ? `Connection interrupted. Reconnecting ${attempt}/${maxAttempts}...`
    : "I was cut off - here's what I had. Want me to continue?";

  return (
    <div
      style={{
        display: 'grid',
        gap: '0.55rem',
        marginTop: '0.8rem',
        padding: '0.85rem 1rem',
        borderRadius: '10px',
        border: '1px solid rgba(245,158,11,0.28)',
        background: 'rgba(245,158,11,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#f59e0b', fontWeight: 600 }}>
        {isRetrying ? <FiRotateCw size={14} className="spin" /> : <FiAlertTriangle size={14} />}
        <span>{headline}</span>
      </div>
      {details ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
          {details}
        </div>
      ) : null}
      {onRetry && !isRetrying ? (
        <div>
          <button
            type="button"
            className="btn-ghost"
            onClick={onRetry}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', padding: '0.35rem 0.7rem', borderRadius: 10 }}
          >
            <FiRotateCw size={12} />
            Retry now
          </button>
        </div>
      ) : null}
    </div>
  );
}
