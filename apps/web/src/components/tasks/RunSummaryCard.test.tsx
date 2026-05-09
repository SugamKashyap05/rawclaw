import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunSummaryCard } from './RunSummaryCard';

describe('RunSummaryCard', () => {
  it('renders retry-first failure guidance in plain language', () => {
    render(
      <RunSummaryCard
        run={{
          status: 'failed',
          selectedAgent: 'research_agent',
          task: { name: 'Morning Brief' },
          steps: [
            {
              id: 'step-1',
              runId: 'run-1',
              stepIndex: 0,
              stepType: 'plan',
              inputSummary: 'Gather official release notes',
              outputSummary: undefined,
              sandboxed: false,
              durationMs: 0,
              timestamp: new Date().toISOString(),
            },
            {
              id: 'step-2',
              runId: 'run-1',
              stepIndex: 1,
              stepType: 'error',
              inputSummary: undefined,
              outputSummary: 'Search provider timed out',
              sandboxed: false,
              durationMs: 0,
              timestamp: new Date().toISOString(),
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(/The task ran for Morning Brief using research_agent but couldn't complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Resume this run to continue from the last completed step/i)).toBeInTheDocument();
    expect(screen.getByText(/Stopped: Search provider timed out/i)).toBeInTheDocument();
  });

  it('renders cancelled guidance without dumping raw provenance language', () => {
    render(
      <RunSummaryCard
        run={{
          status: 'cancelled',
          task: { name: 'Daily Sync' },
          steps: [],
        }}
      />,
    );

    expect(screen.getByText(/This run was cancelled before finishing for Daily Sync/i)).toBeInTheDocument();
    expect(screen.getByText(/Resume to continue from the last completed step/i)).toBeInTheDocument();
  });
});
