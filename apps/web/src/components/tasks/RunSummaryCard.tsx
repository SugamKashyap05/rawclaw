import React from 'react';
import { RunStep, TaskRun } from '@rawclaw/shared';
import { deriveRunSummary } from './runSummary';

type RunSummaryCardProps = {
  run: Pick<TaskRun, 'status' | 'errorMessage' | 'selectedAgent' | 'resumedFromRunId'> & {
    steps?: RunStep[];
    task?: { name?: string } | null;
  };
};

export const RunSummaryCard: React.FC<RunSummaryCardProps> = ({ run }) => {
  const summary = deriveRunSummary(run);

  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        background: 'rgba(255,255,255,0.03)',
        padding: '0.9rem',
        display: 'grid',
        gap: '0.7rem',
      }}
    >
      <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        RUN SUMMARY
      </div>

      <div style={{ fontSize: '0.86rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>
        {summary.outcome}
      </div>

      <div style={{ display: 'grid', gap: '0.45rem' }}>
        {summary.steps.map((step) => (
          <div
            key={step}
            style={{
              display: 'flex',
              gap: '0.55rem',
              alignItems: 'flex-start',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ color: 'var(--accent-cyan)', lineHeight: 1.4 }}>•</span>
            <span style={{ lineHeight: 1.45 }}>{step}</span>
          </div>
        ))}
      </div>

      {summary.nextStep ? (
        <div
          style={{
            padding: '0.7rem 0.8rem',
            borderRadius: '10px',
            background: 'rgba(0, 240, 255, 0.05)',
            border: '1px solid rgba(0, 240, 255, 0.12)',
            color: 'var(--text-secondary)',
            fontSize: '0.78rem',
            lineHeight: 1.45,
          }}
        >
          {summary.nextStep}
        </div>
      ) : null}
    </div>
  );
};
