import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Provenance from './Provenance';

const mockGet = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock('../components/chat/ProvenanceTrace', () => ({
  ProvenanceTrace: () => <div data-testid="provenance-trace">trace</div>,
}));

describe('Provenance', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('keeps session data visible when one control-room feed fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/chat/sessions') {
        return Promise.resolve({
          data: [
            {
              id: 'session-1',
              title: 'Main session',
              updatedAt: '2026-05-08T10:00:00.000Z',
              messages: [
                {
                  id: 'assistant-1',
                  role: 'assistant',
                  content: 'Draft answer',
                  workflowState: {
                    reviewEnabled: true,
                  },
                  createdAt: '2026-05-08T10:00:00.000Z',
                },
              ],
            },
          ],
        });
      }

      if (url === '/self-improvement/proposals') {
        return Promise.reject(new Error('proposal feed unavailable'));
      }

      if (url === '/tasks/runs/recent') {
        return Promise.resolve({
          data: [],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <MemoryRouter>
        <Provenance />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Some operator control room data is unavailable right now.')).toBeInTheDocument();
    });

    expect(screen.getByText('Main session')).toBeInTheDocument();
  });
});
