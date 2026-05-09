import { TasksMaintenanceService } from './tasks-maintenance.service';

describe('TasksMaintenanceService', () => {
  it('applies a startup grace window on the first reaper cycle only', async () => {
    const tasksService = {
      reapStaleRuns: jest.fn().mockResolvedValue({ reaped: 0, runIds: [], cutoff: '2026-05-08T12:00:00.000Z' }),
    };

    const service = new TasksMaintenanceService(tasksService as any);

    await service.reapStaleTaskRuns();
    await service.reapStaleTaskRuns();

    expect(tasksService.reapStaleRuns).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        startupSkipBefore: expect.any(Date),
      }),
    );
    expect(tasksService.reapStaleRuns).toHaveBeenNthCalledWith(2, {
      startupSkipBefore: undefined,
    });
  });
});
