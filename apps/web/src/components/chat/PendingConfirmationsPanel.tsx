import { useState, useEffect, useCallback } from 'react';
import { FiShield, FiCheck, FiX, FiClock, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { api } from '../../lib/api';
import { ToolConfirmation } from '@rawclaw/shared';

const MAX_WAIT_SECONDS = 120;

interface Props {
  /** Pre-fetched confirmations from the centralized poller */
  confirmations: ToolConfirmation[];
  /** Called after an approve/deny action so the poller can refresh */
  onAction?: () => void;
}

/**
 * Multi-item pending confirmations queue.
 * Displays all queued tool confirmation requests with countdown timers,
 * approve/reject actions, and expandable input inspection.
 *
 * Designed to replace the inline ConfirmationBanner within the Chat view
 * while keeping ConfirmationBanner available as a fallback elsewhere.
 */
export function PendingConfirmationsPanel({ confirmations, onAction }: Props) {
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  const [expandedInputs, setExpandedInputs] = useState<Record<string, boolean>>({});

  // 1-second countdown tick
  useEffect(() => {
    if (confirmations.length === 0) return;

    const tick = setInterval(() => {
      setCountdowns(() => {
        const next: Record<string, number> = {};
        for (const conf of confirmations) {
          const elapsed = Math.floor((Date.now() - new Date(conf.requestedAt).getTime()) / 1000);
          next[conf.id] = Math.max(0, MAX_WAIT_SECONDS - elapsed);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [confirmations]);

  const handleAction = useCallback(async (id: string, action: 'approve' | 'deny') => {
    try {
      await api.post(`/tools/confirm/${id}/${action}`);
      onAction?.();
    } catch (err) {
      console.error(`Failed to ${action} confirmation ${id}`, err);
    }
  }, [onAction]);

  const toggleInput = useCallback((id: string) => {
    setExpandedInputs(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getToolDescription = (toolName: string): string => {
    if (toolName === 'read_file') return 'Read a file from your filesystem';
    if (toolName === 'write_file' || toolName === 'create_file') return 'Write or create a file';
    if (toolName === 'execute_command' || toolName === 'run_terminal') return 'Execute a shell command';
    if (toolName.includes('search') || toolName.includes('fetch') || toolName.includes('browse'))
      return 'Access the network';
    if (toolName.includes('delete')) return 'Delete a resource';
    return 'Execute an operation requiring approval';
  };

  if (confirmations.length === 0) return null;

  return (
    <div 
      id="pending-confirmations-list"
      style={{
        display: 'grid',
        gap: '0.5rem',
        marginBottom: '0.75rem',
      }}
    >
      {/* Queue header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.78rem',
        color: 'var(--warning)',
        fontWeight: 600,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
      }}>
        <FiShield />
        <span>Pending Approvals ({confirmations.length})</span>
      </div>

      {confirmations.map(conf => {
        const remaining = countdowns[conf.id] ?? MAX_WAIT_SECONDS;
        const isUrgent = remaining <= 20;

        return (
          <div
            key={conf.id}
            style={{
              display: 'grid',
              gap: '0.6rem',
              padding: '0.75rem 1rem',
              borderRadius: '10px',
              border: `1px solid ${isUrgent ? 'rgba(255, 77, 77, 0.4)' : 'rgba(255, 165, 0, 0.3)'}`,
              background: isUrgent ? 'rgba(255, 77, 77, 0.06)' : 'rgba(255, 165, 0, 0.05)',
              transition: 'border-color 0.3s ease, background 0.3s ease',
            }}
          >
            {/* Row 1: tool name + countdown */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                  {conf.toolName}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  — {getToolDescription(conf.toolName)}
                </span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.78rem',
                color: isUrgent ? 'var(--error)' : 'var(--text-secondary)',
                fontWeight: isUrgent ? 600 : 400,
              }}>
                <FiClock size={13} />
                <span className="mono">{formatCountdown(remaining)}</span>
              </div>
            </div>

            {/* Row 2: expandable input */}
            <div>
              <button
                onClick={() => toggleInput(conf.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--neon-cyan)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: 0,
                }}
              >
                {expandedInputs[conf.id] ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
                {expandedInputs[conf.id] ? 'Hide input' : 'Inspect input'}
              </button>
              {expandedInputs[conf.id] && (
                <pre
                  className="custom-scrollbar"
                  style={{
                    margin: '0.4rem 0 0 0',
                    padding: '0.7rem',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.03)',
                    fontSize: '0.78rem',
                    maxHeight: '140px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {(() => {
                    try { return JSON.stringify(JSON.parse(conf.toolInput), null, 2); }
                    catch { return conf.toolInput; }
                  })()}
                </pre>
              )}
            </div>

            {/* Row 3: action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                className="btn-secondary"
                onClick={() => void handleAction(conf.id, 'deny')}
                style={{
                  fontSize: '0.82rem',
                  padding: '0.4rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  color: 'var(--error)',
                  borderColor: 'rgba(255, 77, 77, 0.3)',
                }}
              >
                <FiX size={14} /> Reject
              </button>
              <button
                className="btn-primary"
                onClick={() => void handleAction(conf.id, 'approve')}
                style={{
                  fontSize: '0.82rem',
                  padding: '0.4rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <FiCheck size={14} /> Approve
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
