import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MemoryService } from './memory.service';

@Injectable()
export class MemoryMaintenanceService {
  private readonly logger = new Logger(MemoryMaintenanceService.name);

  constructor(private readonly memoryService: MemoryService) {}

  @Cron('0 17 3 * * *')
  async pruneSessionRecallIndex() {
    try {
      const result = await this.memoryService.pruneSessionIndex({
        ttlDays: 14,
        maxEntriesPerSession: 100,
        dryRun: false,
      });
      this.logger.log(
        `Session recall prune completed: deleted=${result.deletedEntries} remaining=${result.remainingEntries} sessions=${result.sessionsTouched}`,
      );
    } catch (error: any) {
      this.logger.warn(`Session recall prune failed: ${error?.message || error}`);
    }
  }
}
