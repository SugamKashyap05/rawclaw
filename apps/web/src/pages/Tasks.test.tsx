import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfile, Task, TaskRunListResponse, ToolInfo } from '@rawclaw/shared';
import Tasks from './Tasks';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}));

const TASKS: Task[] = [
  {
    id: 'task-1',
    name: 'Morning Brief',
    description: 'Summarize release notes',
    agentId: 'agent-1',
    toolIds: [],
    enabled: true,
    schedule: '0 9 * * *',
    nextRun: new Date().toISOString(),
    workspaceId: 'default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunStatus: 'done',
  },
];

const RUNS: TaskRunListResponse = {
  items: [
    {
      id: 'run-1',
      taskId: 'task-1',
      status: 'failed',
      createdAt: new Date().toISOString(),
      errorMessage: 'Search provider timed out',
      sessionId: 'session-1',
      steps: [],
      task: TASKS[0],
    },
  ],
  page: 1,
  limit: 25,
  total: 1,
  totalPages: 1,
};

const AGENTS: AgentProfile[] = [
  {
    id: 'agent-1',
    name: 'Research Agent',
    systemPrompt: 'Focus on grounded web research.',
    status: 'idle',
    isDefault: true,
    skills: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const TOOLS: ToolInfo[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information.',
    parameters: {},
    capability_tags: ['web'],
    requires_confirmation: false,
    requires_sandbox: false,
    health_status: { name: 'web_search', status: 'ok' },
  },
];

function installApiMocks() {
  apiGet.mockImplementation((url: string, config?: any) => {
    if (url === '/tasks') {
      return Promise.resolve({ data: TASKS });
    }
    if (url === '/tasks/runs') {
      return Promise.resolve({ data: RUNS });
    }
    if (url === '/agents') {
      return Promise.resolve({ data: AGENTS });
    }
    if (url === '/tools/info') {
      return Promise.resolve({ data: { tools: TOOLS, count: TOOLS.length } });
    }
    if (url === '/tasks/runs/run-1') {
      return Promise.resolve({
        data: {
          ...RUNS.items[0],
          definition: TASKS[0],
          provenance: { steps: [] },
        },
      });
    }
    if (url === '/tasks/schedule/preview') {
      return Promise.resolve({
        data: {
          valid: true,
          expression: config?.params?.expression || '',
          nextRun: new Date().toISOString(),
          error: null,
        },
      });
    }
    throw new Error(`Unhandled GET ${url}`);
  });
  apiPost.mockResolvedValue({ data: {} });
  apiPatch.mockResolvedValue({ data: {} });
  apiDelete.mockResolvedValue({ data: {} });
}

describe('Tasks page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installApiMocks();
  });

  it('loads paginated runs from /tasks/runs instead of the recent-runs endpoint', async () => {
    render(<Tasks />);

    await screen.findByText('Task Matrix');

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/tasks/runs',
        expect.objectContaining({
          params: expect.objectContaining({
            page: 1,
            limit: 25,
          }),
        }),
      ),
    );

    expect(apiGet).not.toHaveBeenCalledWith('/tasks/runs/recent');
  });

  it('saves selected tool ids when creating a scoped task', async () => {
    const user = userEvent.setup();
    render(<Tasks />);

    await screen.findByText('Task Matrix');
    await user.click(screen.getByRole('button', { name: /create_task/i }));

    await user.type(screen.getByPlaceholderText('Daily Workspace Scan'), 'Scoped digest');
    await user.type(screen.getByPlaceholderText('Describe what this task should do.'), 'Collect official release notes');
    await user.click(screen.getByRole('button', { name: /selected tools/i }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /save_task/i }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/tasks',
        expect.objectContaining({
          name: 'Scoped digest',
          description: 'Collect official release notes',
          toolIds: ['web_search'],
          enabled: true,
        }),
      ),
    );
  });
});
