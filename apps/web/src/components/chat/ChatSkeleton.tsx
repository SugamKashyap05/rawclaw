import React from 'react';

export const ChatSkeleton: React.FC = () => {
  return (
    <div className="chat-skeleton-container" style={{ display: 'grid', gap: '1rem', padding: '1rem' }}>
      <div className="skeleton-item" style={{ 
        display: 'grid', 
        gap: '0.65rem', 
        justifyItems: 'start', 
        opacity: 0.6 
      }}>
        <div style={{
          width: '80%',
          maxWidth: '600px',
          borderRadius: '16px',
          padding: '1rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--border-glass)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div className="skeleton-header" style={{
            width: '60px',
            height: '10px',
            background: 'var(--text-muted)',
            borderRadius: '4px',
            marginBottom: '1rem',
            opacity: 0.3
          }} />
          <div className="skeleton-shimmer-bar" style={{ width: '100%', height: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '0.5rem' }} />
          <div className="skeleton-shimmer-bar" style={{ width: '90%', height: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '0.5rem' }} />
          <div className="skeleton-shimmer-bar" style={{ width: '40%', height: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }} />
          
          <div className="shimmer-effect" />
        </div>
      </div>
      
      <style>{`
        .skeleton-shimmer-bar {
          position: relative;
          overflow: hidden;
        }
        .skeleton-shimmer-bar::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.05),
            transparent
          );
          animation: skeleton-shimmer 2s infinite;
        }
        @keyframes skeleton-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};
