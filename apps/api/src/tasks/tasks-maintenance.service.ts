import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TasksService } from './tasks.service';

@Injectable()
export class TasksMaintenanceService {
  private readonly logger = new Logger(TasksMaintenanceService.name);
  private readonly apiStartedAt = new Date();
  private isFirstReaperCycle = true;

  constructor(private readonly tasksService: TasksService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reapStaleTaskRuns() {
    try {
      const startupSkipBefore = this.isFirstReaperCycle ? this.apiStartedAt : undefined;
      if (startupSkipBefore) {
        this.logger.log(
          `Applying first-cycle stale-run grace window for runs older than API start time ${startupSkipBefore.toISOString()}.`,
        );
      }
      const result = await this.tasksService.reapStaleRuns({ startupSkipBefore });
      this.isFirstReaperCycle = false;
      if (result.reaped > 0) {
        this.logger.warn(`Reaped ${result.reaped} stale task run(s).`);
      }
    } catch (error: any) {
      this.logger.warn(`Task stale-run reaper failed: ${error?.message || error}`);
    }
  }
}
