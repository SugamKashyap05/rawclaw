import React from 'react';
import { 
  FiActivity, FiCheckCircle, FiXCircle, FiClock, FiAlertCircle, 
  FiRefreshCw, FiExternalLink, FiMoreHorizontal 
} from 'react-icons/fi';
import { TaskRun } from '@rawclaw/shared';

interface TaskRunPanelProps {
  runs: TaskRun[];
  onRefresh?: () => void;
  currentSessionId?: string;
}

export const TaskRunPanel: React.FC<TaskRunPanelProps> = ({ 
  runs, 
  onRefresh,
  currentSessionId 
}) => {
  const filteredRuns = runs
    .filter((run: TaskRun) =>
      // Only show runs from THIS session for now as background tasks
      run.sessionId === currentSessionId
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (filteredRuns.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <FiClock size={32} style={{ marginBottom: '1rem', opacity: 0.2 }} />
        <p style={{ fontSize: '0.9rem' }}>No active background tasks for this session.</p>
      </div>
    );
  }

  return (
    <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {filteredRuns.map((run) => (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {getStatusIcon(run.status)}
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {run.task?.name || 'Background Task'}
                  {run.resumedFromRunId && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                      (resumed)
                    </span>
                  )}
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {new Date(run.createdAt).toLocaleTimeString()}
              </div>
            </div>

            {run.errorMessage && (
              <div style={{ 
                color: 'var(--error)', 
                fontSize: '0.8rem', 
                marginBottom: '0.6rem',
                padding: '6px 10px',
                background: 'rgba(255, 77, 77, 0.1)',
                borderRadius: '6px'
              }}>
                {run.errorMessage}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {run.status === 'running' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--neon-cyan)', fontSize: '0.75rem' }}>
                    <FiRefreshCw className="spin" size={12} />
                    <span>Processing...</span>
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
                 <button 
                  className="btn-tiny"
                  onClick={() => onRefresh?.()}
                  style={{ padding: '4px' }}
                >
                  <FiRefreshCw size={12} />
                </button>
              </div>
            </div>

            {/* Progress Bar for running tasks */}
            {run.status === 'running' && (
              <div style={{ 
                height: '3px', 
                width: '100%', 
                background: 'rgba(255,255,255,0.1)', 
                borderRadius: '2px',
                marginTop: '0.75rem',
                overflow: 'hidden'
              }}>
                <div style={{ 
                  height: '100%', 
                  width: '60%',
                  background: 'var(--neon-cyan)',
                  boxShadow: '0 0 8px var(--neon-cyan)'
                }} className="loading-bar" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

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

function getStatusIcon(status: string) {
  switch (status) {
    case 'queued': return <FiClock size={14} style={{ color: 'var(--text-muted)' }} />;
    case 'running': return <FiActivity size={14} style={{ color: 'var(--neon-cyan)' }} className="pulse" />;
    case 'done': return <FiCheckCircle size={14} style={{ color: 'var(--neon-green)' }} />;
    case 'failed': return <FiXCircle size={14} style={{ color: 'var(--error)' }} />;
    case 'cancelled': return <FiAlertCircle size={14} style={{ color: 'var(--text-muted)' }} />;
    default: return <FiMoreHorizontal size={14} />;
  }
}
