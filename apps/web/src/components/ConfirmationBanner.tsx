import { useState, useEffect } from 'react';
import { FiAlertCircle, FiCheck, FiX, FiClock } from 'react-icons/fi';
import axios from 'axios';

export interface ToolConfirmationType {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: string;
  status: string;
  requestedAt: string;
}

interface Props {
  sessionId: string;
  onRefresh?: () => void;
}

const MAX_WAIT_SECONDS = 120;

export function ConfirmationBanner({ sessionId, onRefresh }: Props) {
  const [pending, setPending] = useState<ToolConfirmationType[]>([]);
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});

  useEffect(() => {
    let interval: number;

    const fetchPending = async () => {
      try {
        const res = await axios.get(`/api/tools/confirm?sessionId=${sessionId}`);
        setPending(res.data || []);
      } catch (err) {
        console.error('Failed to fetch pending confirmations', err);
      }
    };

    fetchPending();
    interval = window.setInterval(fetchPending, 3000);

    return () => clearInterval(interval);
  }, [sessionId]);

  // Countdown timer for each confirmation
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdowns(() => {
        const next: Record<string, number> = {};
        for (const conf of pending) {
          const elapsed = Math.floor((Date.now() - new Date(conf.requestedAt).getTime()) / 1000);
          next[conf.id] = Math.max(0, MAX_WAIT_SECONDS - elapsed);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [pending]);

  const handleAction = async (id: string, action: 'approve' | 'deny') => {
    try {
      await axios.post(`/api/tools/confirm/${id}/${action}`);
      setPending(current => current.filter(p => p.id !== id));
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(`Failed to ${action} confirmation ${id}`, err);
    }
  };

  const getActionDescription = (toolName: string): string => {
    if (toolName === 'read_file') {
      return 'This tool wants to read a file from your filesystem';
    }
    if (toolName.includes('search') || toolName.includes('fetch')) {
      return 'This tool wants to access the network';
    }
    return 'This tool requires your permission to proceed';
  };

  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (pending.length === 0) return null;

  return (
    <div className="confirmation-banner-container">
      {pending.map(conf => (
        <div key={conf.id} className="confirmation-banner">
          <div className="confirmation-content">
            <div className="confirmation-title">
              <FiAlertCircle className="warning-icon" />
              <span>
                <strong>{conf.toolName}</strong> is requesting permission
              </span>
            </div>
            <p className="confirmation-description">
              {getActionDescription(conf.toolName)}
            </p>
            <pre className="confirmation-input">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(conf.toolInput), null, 2);
                } catch {
                  return conf.toolInput;
                }
              })()}
            </pre>
          </div>
          <div className="confirmation-actions">
            <div className="confirmation-countdown">
              <FiClock />
              <span>Auto-rejects in {formatCountdown(countdowns[conf.id] || MAX_WAIT_SECONDS)}</span>
            </div>
            <div className="confirmation-buttons">
              <button
                className="btn btn-primary"
                onClick={() => handleAction(conf.id, 'approve')}
              >
                <FiCheck /> Approve
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleAction(conf.id, 'deny')}
              >
                <FiX /> Reject
              </button>
            </div>
          </div>
        </div>
      ))}

      <style>{`
        .confirmation-banner-container {
          margin-bottom: 1rem;
        }
        .confirmation-banner {
          background: linear-gradient(135deg, rgba(255, 165, 0, 0.1), rgba(255, 100, 0, 0.05));
          border: 1px solid rgba(255, 165, 0, 0.3);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        .confirmation-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1rem;
        }
        .warning-icon {
          color: var(--warning-amber);
          font-size: 1.25rem;
        }
        .confirmation-description {
          color: var(--text-muted);
          font-size: 0.875rem;
          margin: 0.25rem 0;
        }
        .confirmation-input {
          background: rgba(0, 0, 0, 0.3);
          padding: 0.75rem;
          border-radius: 8px;
          font-size: 0.75rem;
          max-height: 150px;
          overflow: auto;
          margin: 0;
        }
        .confirmation-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .confirmation-countdown {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--warning-amber);
          font-size: 0.875rem;
        }
        .confirmation-buttons {
          display: flex;
          gap: 0.5rem;
        }
        .btn {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
        }
        .btn-primary {
          background: var(--accent-cyan);
          color: var(--bg-dark);
        }
        .btn-primary:hover {
          background: var(--accent-cyan-dark);
        }
        .btn-danger {
          background: var(--error-red);
          color: white;
        }
        .btn-danger:hover {
          background: #cc4444;
        }
      `}</style>
    </div>
  );
}