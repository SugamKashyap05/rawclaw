import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildWorkStory, WorkStoryCard } from './WorkStoryCard';

describe('WorkStoryCard', () => {
  it('does not render for pure conversational turns', () => {
    const { container } = render(<WorkStoryCard message={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('builds a compact visible work story from memory, tool, and advisory signals', async () => {
    const user = userEvent.setup();
    render(
      <WorkStoryCard
        message={{
          memoryEvents: [{ layer: 'session', action: 'recalled', summary: 'project brief' }],
          toolResults: [
            {
              tool_name: 'web_extract',
              input: { url: 'https://example.com' },
              output: { isFallback: true, evidenceStatus: 'degraded' },
              duration_ms: 200,
              sandboxed: false,
            },
          ],
          advisoryEvents: [{ category: 'follow_up', summary: 'Open the live result', actionState: 'suggested' }],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /work story/i }));
    expect(screen.getByText('Remembered project brief')).toBeInTheDocument();
    expect(screen.getByText('Read the page with browser fallback')).toBeInTheDocument();
    expect(screen.getByText('Returned degraded evidence')).toBeInTheDocument();
    expect(screen.getByText('Suggested a follow-up')).toBeInTheDocument();
  });

  it('prefers the normalized coworker activity frame work story when present', async () => {
    const user = userEvent.setup();
    render(
      <WorkStoryCard
        message={{
          coworkerActivityFrame: {
            visibilityState: 'degraded',
            responseMode: 'partial',
            workStory: 'I found a promising lead in Election Commission of India, but I could not fully verify it yet.',
            source: {
              agentId: 'research-agent',
              agentLabel: 'Research Agent',
            },
          },
          toolResults: [
            {
              tool_name: 'web_search',
              input: {},
              output: {},
              duration_ms: 10,
              sandboxed: false,
            },
          ],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /work story/i }));
    expect(screen.getByText('I found a promising lead in Election Commission of India, but I could not fully verify it yet.')).toBeInTheDocument();
    expect(screen.queryByText('Searched the web')).not.toBeInTheDocument();
  });

  it('caps derived steps at five items', () => {
    const steps = buildWorkStory({
      memoryEvents: [
        { layer: 'session', action: 'recalled', summary: 'project brief' },
        { layer: 'session', action: 'captured', summary: 'release checklist' },
      ],
      toolResults: [
        { tool_name: 'web_search', input: {}, output: {}, duration_ms: 10, sandboxed: false },
        { tool_name: 'shell_execute', input: {}, output: {}, duration_ms: 10, sandboxed: false },
      ],
      advisoryEvents: [
        { category: 'next_step', summary: 'Open the result', actionState: 'suggested' },
        { category: 'follow_up', summary: 'Refine the question', actionState: 'suggested' },
      ],
      workflowState: { assistantLane: 'research' },
      provenanceTrace: {
        runId: 'trace-1',
        steps: [{ stepIndex: 0, stepType: 'review', outputSummary: 'REJECTED for weak evidence', durationMs: 0, sandboxed: false, timestamp: new Date().toISOString() }],
      },
    });

    expect(steps.length).toBeLessThanOrEqual(5);
  });

  it('ignores internal helper tools and payload-like provenance summaries', async () => {
    const user = userEvent.setup();
    render(
      <WorkStoryCard
        message={{
          toolResults: [
            {
              tool_name: 'skill_grounded-web-summary',
              input: {},
              output: { instructions: 'internal helper' },
              duration_ms: 10,
              sandboxed: false,
            },
            {
              tool_name: 'web_search',
              input: {},
              output: {},
              duration_ms: 12,
              sandboxed: false,
            },
          ],
          provenanceTrace: {
            runId: 'trace-2',
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
            ],
          },
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /work story/i }));
    expect(screen.getByText('Searched the web')).toBeInTheDocument();
    expect(screen.queryByText(/Grounded Web Summary/i)).not.toBeInTheDocument();
  });

  it('treats generic trace errors as tool failures instead of execution limits', async () => {
    const user = userEvent.setup();
    render(
      <WorkStoryCard
        message={{
          provenanceTrace: {
            runId: 'trace-3',
            steps: [
              {
                stepIndex: 0,
                stepType: 'error',
                outputSummary: 'No extraction backend produced usable content.',
                durationMs: 0,
                sandboxed: false,
                timestamp: new Date().toISOString(),
              },
            ],
          },
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /work story/i }));
    expect(screen.getByText('Reported a tool failure')).toBeInTheDocument();
    expect(screen.queryByText('Reported an execution limit')).not.toBeInTheDocument();
  });
});
