jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

import { of } from 'rxjs';
import { execSync } from 'child_process';
import { SystemService } from './system.service';

describe('SystemService', () => {
  const createService = () => {
    const httpService = {
      get: jest.fn((url: string) => {
        if (url.includes('/api/v2/heartbeat')) {
          return of({ status: 200, data: {} });
        }
        if (url.endsWith('/health')) {
          return of({ data: { status: 'ok' } });
        }
        throw new Error(`Unhandled GET ${url}`);
      }),
    };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('http://agent'),
      get: jest.fn(),
    };
    const redisService = {
      ping: jest.fn().mockResolvedValue(true),
    };
    const toolsService = {
      getMCPHealth: jest.fn().mockResolvedValue({ connected: true, servers: ['duckduckgo'], connected_count: 1 }),
    };
    const tasksService = {
      countActiveRuns: jest.fn().mockResolvedValue(2),
      listRuns: jest.fn(),
    };
    const agentsService = {
      countRunning: jest.fn().mockResolvedValue(4),
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
    };

    const service = new SystemService(
      httpService as any,
      configService as any,
      redisService as any,
      toolsService as any,
      tasksService as any,
      agentsService as any,
      prisma as any,
    );

    return {
      service,
      httpService,
      configService,
      redisService,
      toolsService,
      tasksService,
      agentsService,
      prisma,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a valid status snapshot and counts pending tasks through countActiveRuns', async () => {
    const { service, tasksService } = createService();
    (execSync as jest.Mock).mockImplementation((command: string) =>
      Buffer.from(command.includes('branch') ? 'main\n' : 'abc123 fix system status\n'),
    );

    const result = await service.getStatus();

    expect(result.services.api).toBe('ok');
    expect(result.counts.pendingTasks).toBe(2);
    expect(result.counts.agents).toBe(4);
    expect(result.counts.mcpServers).toBe(1);
    expect(result.git.branch).toBe('main');
    expect(result.git.lastCommit).toBe('abc123 fix system status');
    expect(tasksService.countActiveRuns).toHaveBeenCalledTimes(1);
    expect(tasksService.listRuns).not.toHaveBeenCalled();
  });

  it('degrades secondary metrics to safe defaults instead of throwing', async () => {
    const { service, toolsService, tasksService, agentsService } = createService();
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('git unavailable');
    });

    toolsService.getMCPHealth.mockImplementation(() => Promise.reject(new Error('mcp unavailable')));
    tasksService.countActiveRuns.mockImplementation(() => Promise.reject(new Error('count failed')));
    agentsService.countRunning.mockImplementation(() => Promise.reject(new Error('agents failed')));

    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        git: {
          branch: 'unknown',
          lastCommit: null,
        },
        counts: {
          agents: 0,
          mcpServers: 0,
          pendingTasks: 0,
        },
      }),
    );
  });
});
