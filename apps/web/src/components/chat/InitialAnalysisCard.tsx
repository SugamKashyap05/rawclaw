import React from 'react';
import { FiActivity, FiSearch, FiCpu, FiCheckCircle } from 'react-icons/fi';
import { ProvenanceTrace as IProvenanceTrace } from '@rawclaw/shared';

interface InitialAnalysisCardProps {
  trace: Partial<IProvenanceTrace> | null | undefined;
  query: string;
}

export const InitialAnalysisCard: React.FC<InitialAnalysisCardProps> = ({ trace, query }) => {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  
  // Find key reasoning artifacts
  const decisionLevel = steps.find(s => s.stepType === 'plan')?.outputSummary || 'Determining Action Level...';
  const contexts = steps.filter(s => s.stepType === 'tool_result').map(s => s.toolName);
  const isComplete = steps.some(s => s.stepType === 'synthesis');

  return (
    <div 
      className="initial-analysis-card"
      style={{
        width: '100%',
        maxWidth: '600px',
        background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.05) 0%, rgba(138, 43, 226, 0.05) 100%)',
        backdropFilter: 'blur(10px)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '1.5rem',
        marginBottom: '1rem',
        animation: 'fadeIn 0.5s ease-out',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Decorative background glow */}
      <div style={{
        position: 'absolute',
        top: '-50%',
        right: '-20%',
        width: '200px',
        height: '200px',
        background: 'var(--neon-cyan)',
        filter: 'blur(100px)',
        opacity: 0.1,
        pointerEvents: 'none'
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1.2rem' }}>
        <div style={{ 
          background: 'rgba(0, 240, 255, 0.15)', 
          padding: '0.6rem', 
          borderRadius: '12px',
          display: 'flex',
          color: 'var(--neon-cyan)',
          boxShadow: '0 0 15px rgba(0, 240, 255, 0.2)'
        }}>
          <FiActivity size={20} className={!isComplete ? "pulse-animation" : ""} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Initial Analysis</h3>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Processing: "{query.length > 40 ? query.slice(0, 40) + '...' : query}"
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Decision Level */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.03)', 
          padding: '1rem', 
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 600 }}>
            <FiCpu size={12} /> DECISION LEVEL
          </div>
          <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>
            {decisionLevel}
          </div>
        </div>

        {/* Context Building */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.03)', 
          padding: '1rem', 
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 600 }}>
            <FiSearch size={12} /> CONTEXT DATA
          </div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {contexts.length > 0 ? contexts.map((c, i) => (
              <span key={i} style={{ 
                fontSize: '0.7rem', 
                background: 'rgba(0, 240, 255, 0.1)', 
                color: 'var(--neon-cyan)', 
                padding: '2px 6px', 
                borderRadius: '4px',
                border: '1px solid rgba(0, 240, 255, 0.2)'
              }}>
                {c}
              </span>
            )) : (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Analyzing memory...
              </span>
            )}
          </div>
        </div>
      </div>

      {isComplete && (
        <div style={{ 
          marginTop: '1rem', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem', 
          color: '#00ffa3', 
          fontSize: '0.8rem',
          fontWeight: 600,
          animation: 'slideUp 0.3s ease-out'
        }}>
          <FiCheckCircle size={14} />
          Synthesis ready
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .pulse-animation {
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}} />
    </div>
  );
};
