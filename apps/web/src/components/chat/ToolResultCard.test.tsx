import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ToolResult } from '@rawclaw/shared';
import { ToolResultCard } from './ToolResultCard';

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    tool_name: 'web_search',
    input: { query: 'OpenAI changelog' },
    output: {
      query: 'OpenAI changelog',
      results: [
        {
          title: 'OpenAI changelog',
          url: 'https://developers.openai.com/changelog',
          snippet: 'Latest updates.',
        },
      ],
    },
    duration_ms: 428,
    sandboxed: false,
    ...overrides,
  };
}

describe('ToolResultCard', () => {
  it('renders a narrative for common tool result families without exposing raw field names', () => {
    const fixtures: ToolResult[] = [
      makeToolResult(),
      makeToolResult({
        tool_name: 'browser_navigate',
        input: { url: 'https://example.com/requested' },
        output: {
          url: 'https://example.com/final',
          redirectedUrl: 'https://example.com/final',
          title: 'Example page',
          content: 'Page loaded successfully.',
        },
      }),
      makeToolResult({
        tool_name: 'read_file',
        input: { path: '/workspace/notes.txt' },
        output: {
          path: '/workspace/notes.txt',
          content: 'Release checklist loaded.',
        },
      }),
      makeToolResult({
        tool_name: 'terminal',
        input: { command: 'npm test' },
        output: {
          exitCode: 0,
          stdout: 'Tests passed.',
        },
      }),
      makeToolResult({
        tool_name: 'custom_probe',
        output: { status: 'ok' },
      }),
    ];

    for (const fixture of fixtures) {
      const { unmount } = render(
        <ToolResultCard result={fixture}>
          <div>detail block</div>
        </ToolResultCard>,
      );

      const narrative = screen.getByText(/^I /i);

      expect(narrative.textContent).not.toMatch(/tool_name|evidenceStatus|isFallback/i);
      unmount();
    }
  });

  it('keeps technical details collapsed for successful results and expanded for degraded ones', async () => {
    const user = userEvent.setup();

    const successResult = makeToolResult();
    const { rerender } = render(
      <ToolResultCard result={successResult}>
        <div>success detail block</div>
      </ToolResultCard>,
    );

    expect(screen.queryByText('success detail block')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /technical details/i }));
    expect(screen.getByText('success detail block')).toBeInTheDocument();

    const degradedResult = makeToolResult({
      tool_name: 'web_extract',
      output: {
        url: 'https://example.com/requested',
        title: 'Example page',
        content: 'Thin result.',
        evidenceStatus: 'degraded',
        isFallback: true,
      },
    });

    rerender(
      <ToolResultCard result={degradedResult}>
        <div>degraded detail block</div>
      </ToolResultCard>,
    );

    expect(screen.getByText('degraded detail block')).toBeInTheDocument();
  });

  it('renders trust signals in the shared footer for fallback and source-aware results', () => {
    render(
      <ToolResultCard
        result={makeToolResult({
          tool_name: 'web_extract',
          input: { url: 'https://example.com/requested' },
          output: {
            url: 'https://example.com/final',
            redirectedUrl: 'https://example.com/final',
            title: 'Example page',
            content: 'Thin but usable result.',
            evidenceStatus: 'degraded',
            isFallback: true,
          },
        })}
      >
        <div>detail block</div>
      </ToolResultCard>,
    );

    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(screen.getByText('evidence:degraded')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('treats weak search evidence as degraded and surfaces quality signals', () => {
    render(
      <ToolResultCard
        result={makeToolResult({
          output: {
            query: 'West Bengal election results 2026',
            result_quality: 'weak',
            quality_assessment: 'Results may be incomplete or placeholder-like.',
            results: [
              {
                title: 'Election Commission of India',
                url: 'https://results.eci.gov.in/',
                snippet: 'Official result dashboard.',
              },
            ],
          },
        })}
      >
        <div>detail block</div>
      </ToolResultCard>,
    );

    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('quality:weak')).toBeInTheDocument();
    expect(screen.getByText('quality warning')).toBeInTheDocument();
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });
});
