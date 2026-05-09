import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProvenanceTrace } from './ProvenanceTrace';

describe('ProvenanceTrace', () => {
  it('sanitizes payload-like summaries in the inline trace view', async () => {
    const user = userEvent.setup();
    render(
      <ProvenanceTrace
        trace={{
          runId: 'trace-1',
          steps: [
            {
              stepIndex: 0,
              stepType: 'tool_result',
              toolName: 'skill_grounded-web-summary',
              outputSummary: 'instructions=# Grounded Web Summary Use this skill when the task involves current web information...',
              durationMs: 0,
              sandboxed: false,
              timestamp: new Date().toISOString(),
            },
            {
              stepIndex: 1,
              stepType: 'review',
              outputSummary: 'Result: APPROVED. Feedback:',
              durationMs: 0,
              sandboxed: false,
              timestamp: new Date().toISOString(),
            },
          ],
        }}
      />,
    );

    await user.click(screen.getByText('TRACE'));
    expect(screen.getByText('Structured tool output captured')).toBeInTheDocument();
    expect(screen.getByText('Reviewer approved the draft')).toBeInTheDocument();
    expect(screen.queryByText(/Grounded Web Summary/i)).not.toBeInTheDocument();
  });
});
