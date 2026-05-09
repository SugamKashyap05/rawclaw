import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRunPanel } from './TaskRunPanel';

const apiPost = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

describe('TaskRunPanel', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it('requests cancellation for running runs from the chat panel', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    apiPost.mockResolvedValue({ data: { accepted: true } });

    render(
      <TaskRunPanel
        currentSessionId="session-1"
        onRefresh={onRefresh}
        runs={[
          {
            id: 'run-1',
            taskId: 'task-1',
            status: 'running',
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            steps: [],
            task: {
              id: 'task-1',
              name: 'Morning Brief',
              description: 'Summarize release notes',
              toolIds: [],
              enabled: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/tasks/runs/run-1/cancel', {}));
    expect(onRefresh).toHaveBeenCalled();
  });
});
