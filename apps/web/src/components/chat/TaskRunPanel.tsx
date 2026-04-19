import React, { useState, useCallback } from 'react';
import { 
  FiActivity, FiCheckCircle, FiXCircle, FiClock, FiAlertCircle, 
  FiRefreshCw, FiExternalLink, FiPlay, FiHash, FiArrowRight
} from 'react-icons/fi';
import { TaskRun } from '@rawclaw/shared';
import { api } from '../../lib/api';

interface TaskRunPanelProps {
  runs: TaskRun[];
  onRefresh?: () => void;
  currentSessionId?: string;
}

type ResumeState = { status: 'idle' } | { status: 'loading'; runId: string } | { status: 'error'; runId: string; message: string };

export const TaskRunPanel: React.FC<TaskRunPanelProps> = ({ 
  runs, 
  onRefresh,
  currentSessionId 
}) => {
  const [resumeState, setResumeState] = useState<ResumeState>({ status: 'idle' });

  // Since the API now filters by sessionId, runs are already session-scoped.
  // We sort by most recent first.
  const sortedRuns = [...runs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handleResume = useCallback(async (runId: string) => {
    if (!currentSessionId) return;
    setResumeState({ status: 'loading', runId });
    try {
      await api.post(`/tasks/runs/${runId}/resume`, { sessionId: currentSessionId });
      setResumeState({ status: 'idle' });
      // Refresh panel to show the new run
      onRefresh?.();
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Resume failed';
      setResumeState({ status: 'error', runId, message });
    }
  }, [currentSessionId, onRefresh]);

  const isResumable = (status: string) => status === 'failed' || status === 'cancelled';

  if (sortedRuns.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <FiClock size={32} style={{ marginBottom: '1rem', opacity: 0.2 }} />
        <p style={{ fontSize: '0.9rem' }}>No background tasks for this session.</p>
      </div>
    );
  }

  return (
    <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {sortedRuns.map((run) => {
          const isResuming = resumeState.status === 'loading' && resumeState.runId === run.id;
          const resumeError = resumeState.status === 'error' && resumeState.runId === run.id ? resumeState.message : null;
          const duration = computeDuration(run);

          return (
            <div 
              key={run.id}
              className="glass-card"
              style={{ 
                padding: '0.85rem',
                border: `1px solid ${getStatusColor(run.status, 0.2)}`,
                background: getStatusColor(run.status, 0.05),
                opacity: run.status === 'cancelled' ? 0.6 : 1
              }}
            >
              {/* Row 1: Task name + status badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {getStatusIcon(run.status)}
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {run.task?.name || (run as any).definition?.name || 'Background Task'}
                  </span>
                  <StatusBadge status={run.status} />
                  {run.resumedFromRunId && (
                    <span style={{ 
                      fontSize: '0.65rem', 
                      color: 'var(--neon-cyan)', 
                      background: 'rgba(0, 240, 255, 0.1)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      padding: '1px 6px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontWeight: 600
                    }}>
                      <FiArrowRight size={9} /> resumed
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: Metadata - run ID, times, duration */}
              <div style={{ 
                display: 'flex', 
                gap: '1rem', 
                fontSize: '0.72rem', 
                color: 'var(--text-muted)',
                marginBottom: '0.5rem',
                flexWrap: 'wrap'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <FiHash size={10} />
                  {run.id.slice(0, 8)}
                </span>
                <span>
                  Created: {new Date(run.createdAt).toLocaleTimeString()}
                </span>
                {run.startedAt && (
                  <span>
                    Started: {new Date(run.startedAt).toLocaleTimeString()}
                  </span>
                )}
                {duration && (
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {duration}
                  </span>
                )}
              </div>

              {/* Error message - prominent display for failures */}
              {run.errorMessage && (
                <div style={{ 
                  color: 'var(--error)', 
                  fontSize: '0.8rem', 
                  marginBottom: '0.5rem',
                  padding: '8px 10px',
                  background: 'rgba(255, 77, 77, 0.08)',
                  border: '1px solid rgba(255, 77, 77, 0.2)',
                  borderRadius: '6px',
                  lineHeight: 1.4
                }}>
                  <strong style={{ fontSize: '0.7rem', letterSpacing: '0.5px', display: 'block', marginBottom: '2px' }}>
                    ERROR
                  </strong>
                  {run.errorMessage}
                </div>
              )}

              {/* Resume error inline */}
              {resumeError && (
                <div style={{
                  color: 'var(--error)',
                  fontSize: '0.78rem',
                  padding: '6px 10px',
                  background: 'rgba(255, 77, 77, 0.08)',
                  borderRadius: '6px',
                  marginBottom: '0.5rem'
                }}>
                  Resume failed: {resumeError}
                </div>
              )}

              {/* Row 3: Action bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {/* Running indicator - honest indeterminate, no fake percentage */}
                  {run.status === 'running' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--neon-cyan)', fontSize: '0.75rem' }}>
                      <FiRefreshCw className="spin" size={12} />
                      <span>Processing</span>
                    </div>
                  )}
                  {run.status === 'queued' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <FiClock size={12} />
                      <span>Queued</span>
                    </div>
                  )}
                  {run.status === 'done' && run.outputPath && (
                    <a 
                      href={run.outputPath} 
                      target="_blank" 
                      rel="noreferrer"
                      style={{ 
                        fontSize: '0.75rem', 
                        color: 'var(--neon-green)', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.3rem',
                        textDecoration: 'none'
                      }}
                    >
                      <FiExternalLink size={12} /> View Output
                    </a>
                  )}
                </div>
                
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {/* Resume button - only for failed/cancelled */}
                  {isResumable(run.status) && (
                    <button
                      className="btn-tiny"
                      onClick={() => void handleResume(run.id)}
                      disabled={isResuming}
                      title="Resume this run"
                      style={{ 
                        padding: '4px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.72rem',
                        color: 'var(--neon-cyan)',
                        border: '1px solid rgba(0, 240, 255, 0.3)',
                        background: 'rgba(0, 240, 255, 0.05)',
                        borderRadius: '6px',
                        cursor: isResuming ? 'wait' : 'pointer',
                        opacity: isResuming ? 0.6 : 1
                      }}
                    >
                      {isResuming ? (
                        <FiRefreshCw className="spin" size={11} />
                      ) : (
                        <FiPlay size={11} />
                      )}
                      {isResuming ? 'Resuming...' : 'Resume'}
                    </button>
                  )}
                  <button 
                    className="btn-tiny"
                    onClick={() => onRefresh?.()}
                    title="Refresh runs"
                    style={{ padding: '4px' }}
                  >
                    <FiRefreshCw size={12} />
                  </button>
                </div>
              </div>

              {/* Indeterminate running bar - honest: no fake progress width */}
              {run.status === 'running' && (
                <div style={{ 
                  height: '2px', 
                  width: '100%', 
                  background: 'rgba(255,255,255,0.06)', 
                  borderRadius: '2px',
                  marginTop: '0.6rem',
                  overflow: 'hidden'
                }}>
                  <div 
                    className="loading-bar" 
                    style={{ 
                      height: '100%', 
                      width: '40%',
                      background: 'var(--neon-cyan)',
                      boxShadow: '0 0 6px var(--neon-cyan)',
                      animation: 'indeterminate 1.5s ease-in-out infinite'
                    }} 
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- Helpers ---------------------------------------

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: '0.62rem',
        fontWeight: 700,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        padding: '1px 6px',
        borderRadius: '4px',
        color: getStatusTextColor(status),
        background: getStatusColor(status, 0.12),
      }}
    >
      {status}
    </span>
  );
}

function computeDuration(run: TaskRun): string | null {
  if (run.startedAt && run.finishedAt) {
    const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }
  if (run.startedAt && run.status === 'running') {
    const ms = Date.now() - new Date(run.startedAt).getTime();
    if (ms < 1000) return `${ms}ms elapsed`;
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s elapsed`;
    return `${Math.floor(ms / 60000)}m elapsed`;
  }
  return null;
}

function getStatusColor(status: string, opacity = 1) {
  switch (status) {
    case 'queued': return `rgba(180, 180, 180, ${opacity})`;
    case 'running': return `rgba(0, 240, 255, ${opacity})`;
    case 'done': return `rgba(0, 255, 150, ${opacity})`;
    case 'failed': return `rgba(255, 77, 77, ${opacity})`;
    case 'cancelled': return `rgba(255, 255, 255, ${opacity * 0.3})`;
    default: return `rgba(255, 255, 255, ${opacity})`;
  }
}

function getStatusTextColor(status: string) {
  switch (status) {
    case 'queued': return 'var(--text-muted)';
    case 'running': return 'var(--neon-cyan)';
    case 'done': return 'var(--neon-green, #00ff96)';
    case 'failed': return 'var(--error, #ef4444)';
    case 'cancelled': return 'var(--text-muted)';
    default: return 'var(--text-primary)';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'queued': return <FiClock size={14} style={{ color: 'var(--text-muted)' }} />;
    case 'running': return <FiActivity size={14} style={{ color: 'var(--neon-cyan)' }} className="pulse" />;
    case 'done': return <FiCheckCircle size={14} style={{ color: 'var(--neon-green)' }} />;
    case 'failed': return <FiXCircle size={14} style={{ color: 'var(--error)' }} />;
    case 'cancelled': return <FiAlertCircle size={14} style={{ color: 'var(--text-muted)' }} />;
    default: return <FiClock size={14} />;
  }
}
