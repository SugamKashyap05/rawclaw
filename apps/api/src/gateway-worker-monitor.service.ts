import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GatewayAutomationService } from './gateway-automation.service';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewaySubagentService } from './gateway-subagent.service';
import { AppBuilderService } from './app-builder/app-builder.service';

const WORKER_STALE_MS = 75_000;

@Injectable()
export class GatewayWorkerMonitorService {
  private readonly logger = new Logger(GatewayWorkerMonitorService.name);

  constructor(
    private readonly controlPlane: GatewayControlPlaneService,
    private readonly subagentService: GatewaySubagentService,
    private readonly automationService: GatewayAutomationService,
    private readonly appBuilderService: AppBuilderService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcileWorkers(): Promise<void> {
    const workers = await this.controlPlane.listWorkers(100);
    const now = Date.now();

    for (const worker of workers) {
      if (worker.status === 'offline') {
        continue;
      }

      const lastHeartbeat = Date.parse(worker.lastHeartbeatAt || '');
      const leaseExpires = worker.leaseExpiresAt ? Date.parse(worker.leaseExpiresAt) : Number.NaN;
      const heartbeatExpired = Number.isFinite(lastHeartbeat) && now - lastHeartbeat > WORKER_STALE_MS;
      const leaseExpired = Number.isFinite(leaseExpires) && leaseExpires < now;

      if (!heartbeatExpired && !leaseExpired) {
        continue;
      }

      const reason = leaseExpired
        ? 'Worker lease expired before completion.'
        : 'Worker heartbeat exceeded the stale threshold.';

      this.logger.warn(`Marking worker ${worker.workerId} offline: ${reason}`);
      await this.controlPlane.markWorkerOffline(worker.workerId, reason);

      if (!worker.currentJobId) {
        continue;
      }

      const lease = await this.controlPlane.getWorkerLease(worker.currentJobId);
      if (!lease || lease.workerId !== worker.workerId) {
        continue;
      }

      try {
        if (lease.queueType === 'subagent') {
          await this.subagentService.failQueuedJob({
            jobId: lease.jobId,
            workerId: worker.workerId,
            error: reason,
            cancelled: false,
          });
        } else if (lease.queueType === 'automation' && lease.runId) {
          await this.automationService.failQueuedRun({
            runId: lease.runId,
            workerId: worker.workerId,
            error: reason,
            cancelled: false,
          });
        } else if (lease.queueType === 'builder') {
          await this.appBuilderService.failQueuedRun({
            jobId: lease.jobId,
            workerId: worker.workerId,
            error: reason,
          });
        } else if (lease.queueType === 'sandbox') {
          await this.controlPlane.markSandboxJobFailed(lease.jobId, worker.workerId, reason);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to reconcile stale job ${lease.jobId} for worker ${worker.workerId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
