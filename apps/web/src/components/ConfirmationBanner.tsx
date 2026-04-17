import { useState, useEffect } from 'react';
import { FiAlertCircle, FiCheck, FiX, FiClock } from 'react-icons/fi';
import { api } from '../lib/api';

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
  const [showInput, setShowInput] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let interval: number;

    const fetchPending = async () => {
      try {
        const res = await api.get(`/tools/confirm?sessionId=${sessionId}`);
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
      await api.post(`/tools/confirm/${id}/${action}`);
      setPending(current => current.filter(p => p.id !== id));
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(`Failed to ${action} confirmation ${id}`, err);
    }
  };

  const toggleInput = (id: string) => {
    setShowInput(prev => ({ ...prev, [id]: !prev[id] }));
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
            
            <div className="confirmation-input-section">
              <button 
                className="view-input-btn"
                onClick={() => toggleInput(conf.id)}
              >
                {showInput[conf.id] ? 'Hide Input' : 'View Input Parameters'}
              </button>
              
              {showInput[conf.id] && (
                <pre className="confirmation-input animate-in">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(conf.toolInput), null, 2);
                    } catch {
                      return conf.toolInput;
                    }
                  })()}
                </pre>
              )}
            </div>
          </div>
          <div className="confirmation-actions">
            <div className="confirmation-countdown">
              <FiClock />
              <span>Auto-rejects in {formatCountdown(countdowns[conf.id] || MAX_WAIT_SECONDS)}</span>
            </div>
            <div className="confirmation-buttons">
              <button
                className="btn-confirm btn-confirm-approve"
                onClick={() => handleAction(conf.id, 'approve')}
              >
                <FiCheck /> Approve
              </button>
              <button
                className="btn-confirm btn-confirm-reject"
                onClick={() => handleAction(conf.id, 'deny')}
              >
                <FiX /> Reject
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
