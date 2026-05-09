import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AgentProfile, MemoryEvent, ToolResult } from '@rawclaw/shared';
import { MessageCard, ToolResultRenderer, buildFallbackActivityFrame, getErrorMessage, normalizeErrorType, type SessionMessage } from './Chat';

const noop = () => {};

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'research_agent',
    name: 'Research Agent',
    systemPrompt: 'You are a research agent.',
    status: 'idle',
    isDefault: false,
    skills: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    tool_name: 'web_extract',
    input: { url: 'https://example.com/requested' },
    output: {},
    duration_ms: 428,
    sandboxed: false,
    ...overrides,
  };
}

function makeMemoryEvents(): MemoryEvent[] {
  return [
    { layer: 'session', action: 'recalled', summary: 'project brief' },
    { layer: 'operator', action: 'recalled', summary: 'your name' },
    { layer: 'mission', action: 'recalled', summary: 'launch plan' },
    { layer: 'session', action: 'recalled', summary: 'release checklist' },
  ];
}

function renderMessageCard(message: SessionMessage, agents: AgentProfile[] = [makeAgent()]) {
  return render(
    <MessageCard
      message={message}
      agents={agents}
      onEdit={noop}
      onRegenerate={noop}
      onViewDocument={noop}
      onCorrectIntent={noop}
      onUseSecondaryIntent={noop}
      onTryClarificationAgain={noop}
      previousUserQuery="Check this page"
    />,
  );
}

describe('Chat message trust rendering', () => {
  it('renders partial assistant content alongside interrupted banner and hides the error card', () => {
    renderMessageCard({
      role: 'assistant',
      id: 'assistant-1',
      content: 'Partial answer that still matters.',
      agentId: 'research_agent',
      sourceChipAgentId: 'research_agent',
      modelId: 'openai/gpt-4o',
      sourceChipModelId: 'openai/gpt-4o',
      error: {
        type: 'stream_interrupted',
        message: 'Socket closed mid-stream.',
      },
      createdAt: new Date().toISOString(),
      toolResults: [],
    });

    expect(screen.getByText('Partial answer that still matters.')).toBeInTheDocument();
    expect(screen.getByText("I was cut off - here's what I had. Want me to continue?")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry now/i })).toBeInTheDocument();
    expect(screen.queryByText('Stream Interrupted')).not.toBeInTheDocument();
  });

  it('renders agent source, compact memory summary, browser trust state, and interrupted banner together', async () => {
    const user = userEvent.setup();
    renderMessageCard({
      role: 'assistant',
      id: 'assistant-2',
      content: 'I checked the page and the result is thin.',
      agentId: 'research_agent',
      sourceChipAgentId: 'research_agent',
      modelId: 'openai/gpt-4o',
      sourceChipModelId: 'openai/gpt-4o',
      createdAt: new Date().toISOString(),
      memoryRecall: true,
      memoryEvents: makeMemoryEvents(),
      error: {
        type: 'stream_interrupted',
        message: 'Socket closed mid-stream.',
      },
      toolResults: [
        makeToolResult({
          output: {
            url: 'https://example.com/requested',
            title: 'Example page',
            content: 'Thin but non-empty result.',
            backendResult: 'garbage',
            evidenceStatus: 'degraded',
            redirectedUrl: 'https://example.com/final',
            isFallback: false,
            fallbackAttempted: true,
          },
        }),
      ],
    });

    expect(screen.getByText('Research Agent')).toBeInTheDocument();
    expect(screen.getByText(/\|\s*gpt-4o/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /used memory: project brief, your name, launch plan \+1 more/i })).toBeInTheDocument();
    expect(screen.getByText('backend:garbage')).toBeInTheDocument();
    expect(screen.getAllByText('evidence:degraded').length).toBeGreaterThan(0);
    expect(screen.getByText(/Final URL:/i)).toBeInTheDocument();
    expect(screen.getByText("I was cut off - here's what I had. Want me to continue?")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /used memory:/i }));
    expect(screen.getByText('MEMORY DETAILS')).toBeInTheDocument();
    expect(screen.getByText('- session: project brief')).toBeInTheDocument();
  });

  it('prefers normalized coworker source labels when the activity frame is present', () => {
    renderMessageCard({
      role: 'assistant',
      id: 'assistant-source-frame',
      content: 'Here is the grounded answer.',
      agentId: 'default-assistant',
      modelId: 'openai/gpt-4o',
      coworkerActivityFrame: {
        visibilityState: 'clean',
        responseMode: 'grounded',
        workStory: 'Checked 2 sources and used Election Commission of India for the answer.',
        source: {
          agentId: 'default-assistant',
          agentLabel: 'RawClaw',
          modelId: 'openai/gpt-4o',
          modelLabel: 'gpt-4o',
          isLocal: false,
        },
      },
      createdAt: new Date().toISOString(),
      toolResults: [],
    });

    expect(screen.getByText('RawClaw')).toBeInTheDocument();
    expect(screen.getByText(/\|\s*gpt-4o/i)).toBeInTheDocument();
  });

  it('shows retry progress for interrupted messages that are auto-recovering', () => {
    renderMessageCard({
      role: 'assistant',
      id: 'assistant-retrying',
      content: 'Partial answer still visible.',
      streamStatus: 'incomplete',
      retryState: {
        mode: 'retrying',
        attempt: 2,
        maxAttempts: 3,
      },
      error: {
        type: 'stream_interrupted',
        message: 'Connection interrupted before completion.',
      },
      toolResults: [],
    });

    expect(screen.getByText('Connection interrupted. Reconnecting 2/3...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry now/i })).not.toBeInTheDocument();
  });

  it('renders skipped browser results as neutral informational state', () => {
    render(
      <ToolResultRenderer
        result={makeToolResult({
          error: 'browser queue full',
          output: {
            url: 'https://example.com/requested',
            content: '',
            backendResult: 'skipped',
            evidenceStatus: 'degraded',
          },
        })}
      />,
    );

    expect(screen.getByText('SKIPPED')).toBeInTheDocument();
    expect(screen.getByText('Not attempted - browser queue was full.')).toBeInTheDocument();
  });

  it('routes web_extract results through BrowserResult and preserves truncation fallback', () => {
    render(
      <ToolResultRenderer
        result={makeToolResult({
          is_truncated: true,
          output: {
            url: 'https://example.com/requested',
            title: 'Example page',
            content: 'Recovered content',
          },
        })}
      />,
    );

    expect(screen.getByText('Browser Result')).toBeInTheDocument();
    expect(screen.queryByText('Web Extract')).not.toBeInTheDocument();
    expect(screen.getByText('content truncated')).toBeInTheDocument();
  });

  it('renders a human-readable work narrative for search results', () => {
    render(
      <ToolResultRenderer
        result={makeToolResult({
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
        })}
      />,
    );

    expect(screen.getByText(/I searched for "OpenAI changelog" and found 1 result/i)).toBeInTheDocument();
    expect(screen.queryByText(/tool_name|isFallback/i)).not.toBeInTheDocument();
  });

  it('labels repeated search attempts so retries read intentionally', () => {
    render(
      <ToolResultRenderer
        result={makeToolResult({
          tool_name: 'web_search',
          input: { query: 'West Bengal election results 2026' },
          output: {
            query: 'West Bengal election results 2026',
            results: [
              {
                title: 'Election Commission of India',
                url: 'https://results.eci.gov.in/',
                snippet: 'Official result dashboard.',
              },
            ],
          },
        })}
        attemptMeta={{ attempt: 2, total: 4 }}
      />,
    );

    expect(screen.getByText('Web Search - Attempt 2/4')).toBeInTheDocument();
  });

  it('renders a generic tool card with the full tool name in the tooltip', () => {
    render(
      <ToolResultRenderer
        result={makeToolResult({
          tool_name: 'custom_analytics_probe_worker',
          output: { status: 'ok' },
        })}
      />,
    );

    const label = screen.getByText('Custom Analytics...');
    expect(label).toHaveAttribute('title', 'custom_analytics_probe_worker');
  });

  it('hides internal helper tool results from the default chat thread surface', () => {
    renderMessageCard({
      role: 'assistant',
      id: 'assistant-4',
      content: 'Here is the visible answer.',
      agentId: 'research_agent',
      sourceChipAgentId: 'research_agent',
      modelId: 'openai/gpt-4o',
      sourceChipModelId: 'openai/gpt-4o',
      createdAt: new Date().toISOString(),
      toolResults: [
        makeToolResult({
          tool_name: 'skill_grounded-web-summary',
          output: { instructions: 'raw helper payload' },
        }),
        makeToolResult({
          tool_name: 'unknown-tool',
          output: { status: 'internal' },
        }),
        makeToolResult({
          tool_name: 'web_search',
          output: {
            query: 'OpenAI changelog',
            results: [{ title: 'OpenAI changelog', url: 'https://developers.openai.com/api/docs/changelog', snippet: 'Latest API updates.' }],
          },
        }),
      ],
    });

    expect(screen.queryByText(/Skill Grounded/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown Tool')).not.toBeInTheDocument();
    expect(screen.getByText('Web Search')).toBeInTheDocument();
  });

  it('preserves executor/runtime error meaning instead of collapsing everything to agent unavailable', () => {
    expect(normalizeErrorType('stream_error')).toBe('stream_failed');
    expect(normalizeErrorType('turn_limit_reached')).toBe('turn_limit_reached');
    expect(normalizeErrorType('sequential_thinking_limit_reached')).toBe('sequential_thinking_limit_reached');
    expect(normalizeErrorType('execution_timeout')).toBe('execution_timeout');
    expect(normalizeErrorType('stream_timeout')).toBe('stream_timeout');
    expect(normalizeErrorType('provider_http_error')).toBe('model_unavailable');
    expect(normalizeErrorType('provider_offline')).toBe('model_unavailable');
    expect(normalizeErrorType('provider_exception')).toBe('model_unavailable');
    expect(normalizeErrorType('some_unknown_error')).toBe('agent_error');
    expect(getErrorMessage('turn_limit_reached')).toBe('Reasoning Limit Reached');
    expect(getErrorMessage('execution_timeout')).toBe('Execution Timed Out');
    expect(getErrorMessage('model_unavailable')).toBe('Model Unavailable');
    expect(getErrorMessage('stream_failed')).toContain('Your message was received');
  });

  it('does not synthesize a fallback activity frame for hard failed turns with no delivered answer', () => {
    const frame = buildFallbackActivityFrame(
      {
        content: '',
        toolResults: [],
        streamStatus: 'failed',
        error: {
          type: 'stream_failed',
          message: 'Something went wrong while sending the response.',
        },
        agentId: 'default-assistant',
        sourceChipAgentId: 'default-assistant',
        modelId: 'openai/gpt-4o',
        sourceChipModelId: 'openai/gpt-4o',
        isLocal: false,
        workflowState: undefined,
      },
      [makeAgent({ id: 'default-assistant', name: 'RawClaw' })],
    );

    expect(frame).toBeUndefined();
  });

  it('absorbs advisory events into the work story instead of rendering a legacy advisory block', async () => {
    const user = userEvent.setup();
    renderMessageCard({
      role: 'assistant',
      id: 'assistant-3',
      content: 'Here is the next move.',
      agentId: 'research_agent',
      sourceChipAgentId: 'research_agent',
      modelId: 'openai/gpt-4o',
      sourceChipModelId: 'openai/gpt-4o',
      createdAt: new Date().toISOString(),
      advisoryEvents: [
        { category: 'next_step', summary: 'Open the live page result', actionState: 'suggested' },
        { category: 'follow_up', summary: 'Narrow the query if evidence stays thin', actionState: 'suggested' },
      ],
      toolResults: [
        makeToolResult({
          output: {
            url: 'https://example.com/requested',
            content: 'Recovered content',
            isFallback: true,
            evidenceStatus: 'degraded',
          },
        }),
      ],
    });

    expect(screen.getByRole('button', { name: /work story/i })).toBeInTheDocument();
    expect(screen.queryByText(/WHY I SUGGESTED THIS/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /work story/i }));
    expect(screen.getByText('Suggested a follow-up')).toBeInTheDocument();
  });
});
