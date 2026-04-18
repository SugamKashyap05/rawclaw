import React from 'react';
import { FiAlertTriangle } from 'react-icons/fi';

interface ErrorCardProps {
  type: string;
  message: string;
  details?: string;
  onRetry?: () => void;
}

export const ErrorCard: React.FC<ErrorCardProps> = ({ type, message, details, onRetry }) => {
  return (
    <div style={{
      width: '100%',
      marginTop: '0.8rem',
      padding: '1rem',
      background: 'rgba(255,77,77,0.08)',
      border: '1px solid rgba(255,77,77,0.25)',
      borderRadius: '14px',
      color: 'var(--error)',
      boxShadow: '0 4px 12px rgba(255, 77, 77, 0.05)',
      animation: 'slideIn 0.3s ease-out'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.9rem', letterSpacing: '0.01em' }}>
        <FiAlertTriangle size={16} />
        <span style={{ textTransform: 'uppercase' }}>{type.replace(/_/g, ' ')}</span>
      </div>
      <div style={{ fontSize: '0.92rem', lineHeight: 1.55, opacity: 0.9 }}>
        {message}
        {details && (
          <div style={{ 
            marginTop: '0.6rem', 
            padding: '0.6rem', 
            background: 'rgba(0,0,0,0.2)', 
            borderRadius: '8px', 
            fontSize: '0.8rem', 
            fontFamily: 'monospace',
            opacity: 0.8,
            overflowX: 'auto'
          }}>
            {details}
          </div>
        )}
      </div>
      {onRetry && (
        <button 
          onClick={onRetry}
          style={{
            marginTop: '0.75rem',
            background: 'rgba(255,77,77,0.15)',
            border: '1px solid rgba(255,77,77,0.2)',
            color: 'var(--error)',
            borderRadius: '8px',
            padding: '0.4rem 1rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          className="hover-bright"
        >
          Retry
        </button>
      )}
    </div>
  );
};
