import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InitialAnalysisCard } from './InitialAnalysisCard';

describe('InitialAnalysisCard', () => {
  it('groups repeated search attempts and humanizes grounded research workflow labels', () => {
    render(
      <InitialAnalysisCard
        query="hello ji search for who won begal election 2026"
        trace={{
          runId: 'trace-1',
          steps: [
            {
              stepIndex: 0,
              stepType: 'plan',
              outputSummary: '',
              durationMs: 0,
              sandboxed: false,
              timestamp: new Date().toISOString(),
            },
            {
              stepIndex: 1,
              stepType: 'tool_result',
              toolName: 'skill_grounded-web-summary',
              outputSummary: 'skill used',
              durationMs: 0,
              sandboxed: false,
              timestamp: new Date().toISOString(),
            },
            {
              stepIndex: 2,
              stepType: 'tool_result',
              toolName: 'web_search',
              outputSummary: 'attempt one',
              durationMs: 0,
              sandboxed: false,
              timestamp: new Date().toISOString(),
            },
            {
              stepIndex: 3,
              stepType: 'tool_result',
              toolName: 'web_search',
              outputSummary: 'attempt two',
              durationMs: 0,
              sandboxed: false,
              timestamp: new Date().toISOString(),
            },
            {
              stepIndex: 4,
              stepType: 'review',
              outputSummary: 'Evidence looked weak, so the agent stayed cautious.',
              durationMs: 0,
              sandboxed: false,
              timestamp: new Date().toISOString(),
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Evidence looked weak, so the agent stayed cautious.')).toBeInTheDocument();
    expect(screen.getByText('Grounded web summary')).toBeInTheDocument();
    expect(screen.getByText('Web search x2')).toBeInTheDocument();
    expect(screen.queryByText('Determining Action Level...')).not.toBeInTheDocument();
  });
});
