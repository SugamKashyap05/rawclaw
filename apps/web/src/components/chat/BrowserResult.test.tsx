import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrowserResult } from './BrowserResult';

describe('BrowserResult', () => {
  it('shows concise failure copy and hides raw payload from the default visible body when extraction fails', () => {
    render(
      <BrowserResult
        result={{
          tool_name: 'web_extract',
          input: { url: 'https://developers.openai.com/api/docs/changelog' },
          output: {
            url: 'https://developers.openai.com/api/docs/changelog',
            backendResult: 'failed',
            extractionMethod: 'none',
            wordCount: 0,
            debug: { instructions: 'raw payload should stay hidden by default' },
          },
          error: 'No extraction backend produced usable content.',
          duration_ms: 3,
          sandboxed: false,
        }}
      />,
    );

    expect(screen.getByText('No usable page content was extracted from this page.')).toBeInTheDocument();
    expect(screen.queryByText(/raw payload should stay hidden by default/i)).not.toBeInTheDocument();
    expect(screen.getByText('Technical details')).toBeInTheDocument();
  });

  it('renders rich extracted page text when the backend reports a successful strong read', () => {
    render(
      <BrowserResult
        result={{
          tool_name: 'web_extract',
          input: { url: 'https://developers.openai.com/api/docs/changelog' },
          output: {
            url: 'https://developers.openai.com/api/docs/changelog',
            backendResult: 'success',
            evidenceStatus: 'strong',
            wordCount: 5366,
            content: '### OpenAI Developer Changelog Summary\n- Updated the [Responses API](https://platform.openai.com/docs/api-reference/responses).\n- Added gpt-realtime and gpt-audio-mini.',
          },
          duration_ms: 5100,
          sandboxed: false,
        }}
      />,
    );

    expect(screen.queryByText('No usable page content was extracted from this page.')).not.toBeInTheDocument();
    expect(screen.getByText(/OpenAI Developer Changelog Summary/i)).toBeInTheDocument();
  });
});
