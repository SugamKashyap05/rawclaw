import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SandboxJob, WorkerRegistration } from '@rawclaw/shared';
import { GatewayAutomationService } from './gateway-automation.service';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewaySubagentService } from './gateway-subagent.service';
import { InternalWorkerGuard } from './internal-worker.guard';
import { InternalWorkerAuthService } from './internal-worker-auth.service';
import { AppBuilderService } from './app-builder/app-builder.service';

@UseGuards(InternalWorkerGuard)
@Controller('gateway/internal/swarm')
export class GatewayWorkerController {
  constructor(
    private readonly controlPlane: GatewayControlPlaneService,
    private readonly subagentService: GatewaySubagentService,
    private readonly automationService: GatewayAutomationService,
    private readonly internalWorkerAuth: InternalWorkerAuthService,
    private readonly appBuilderService: AppBuilderService,
  ) {}

  @Post('workers/register')
  async registerWorker(@Body() registration: WorkerRegistration) {
    const worker = await this.controlPlane.registerWorker(registration);
    return {
      worker,
      auth: this.internalWorkerAuth.issueToken({
        scope: 'worker',
        workerId: worker.workerId,
      }),
    };
  }

  @Post('service-token')
  async issueInternalServiceToken(@Body() payload?: { serviceId?: string | null }) {
    return {
      auth: this.internalWorkerAuth.issueToken({
        scope: 'service',
        serviceId: payload?.serviceId || 'agent-sandbox',
      }),
    };
  }

  @Post('workers/:workerId/heartbeat')
  async heartbeatWorker(
    @Param('workerId') workerId: string,
    @Body() payload: {
      currentJobId?: string | null;
      currentRunId?: string | null;
      leaseExpiresAt?: string | null;
      status?: 'online' | 'busy' | 'offline';
    },
  ) {
    const auth = this.internalWorkerAuth.issueToken({
      scope: 'worker',
      workerId,
    });
    return {
      worker: await this.controlPlane.heartbeatWorker({
        workerId,
        currentJobId: payload.currentJobId,
        currentRunId: payload.currentRunId,
        leaseExpiresAt: payload.leaseExpiresAt,
        status: payload.status,
      }),
      auth,
    };
  }

  @Post('workers/:workerId/offline')
  async markWorkerOffline(
    @Param('workerId') workerId: string,
    @Body() payload?: { reason?: string | null },
  ) {
    return {
      worker: await this.controlPlane.markWorkerOffline(workerId, payload?.reason ?? null),
    };
  }

  @Get('subagent-jobs/:jobId')
  async getSubagentJob(@Param('jobId') jobId: string) {
    return { job: await this.controlPlane.getSubagentJob(jobId) };
  }

  @Post('subagent-jobs/:jobId/start')
  async markSubagentJobStarted(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string },
  ) {
    await this.subagentService.markQueuedJobStarted(jobId, payload.workerId);
    return { success: true };
  }

  @Post('subagent-jobs/:jobId/heartbeat')
  async markSubagentJobHeartbeat(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string },
  ) {
    await this.subagentService.markQueuedJobHeartbeat(jobId, payload.workerId);
    return { success: true };
  }

  @Post('subagent-jobs/:jobId/complete')
  async completeSubagentJob(
    @Param('jobId') jobId: string,
    @Body()
    payload: {
      workerId: string;
      output: string;
      sources?: string[];
      toolCalls?: Record<string, unknown>[];
      provenanceTrace?: Record<string, unknown> | null;
    },
  ) {
    await this.subagentService.completeQueuedJob({
      jobId,
      workerId: payload.workerId,
      output: payload.output,
      sources: payload.sources,
      toolCalls: payload.toolCalls,
      provenanceTrace: payload.provenanceTrace ?? null,
    });
    return { success: true };
  }

  @Post('subagent-jobs/:jobId/fail')
  async failSubagentJob(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string; error: string; cancelled?: boolean },
  ) {
    await this.subagentService.failQueuedJob({
      jobId,
      workerId: payload.workerId,
      error: payload.error,
      cancelled: payload.cancelled ?? false,
    });
    return { success: true };
  }

  @Get('automation-runs/:runId')
  async getAutomationRun(@Param('runId') runId: string) {
    return { job: await this.controlPlane.getAutomationJob(runId) };
  }

  @Post('automation-runs/:runId/start')
  async markAutomationRunStarted(
    @Param('runId') runId: string,
    @Body() payload: { workerId: string },
  ) {
    await this.automationService.markQueuedRunStarted(runId, payload.workerId);
    return { success: true };
  }

  @Post('automation-runs/:runId/heartbeat')
  async markAutomationRunHeartbeat(
    @Param('runId') runId: string,
    @Body() payload: { workerId: string },
  ) {
    await this.automationService.markQueuedRunHeartbeat(runId, payload.workerId);
    return { success: true };
  }

  @Post('automation-runs/:runId/complete')
  async completeAutomationRun(
    @Param('runId') runId: string,
    @Body()
    payload: {
      workerId: string;
      output: string;
      sources?: string[];
      toolCalls?: Record<string, unknown>[];
      provenanceTrace?: Record<string, unknown> | null;
    },
  ) {
    await this.automationService.completeQueuedRun({
      runId,
      workerId: payload.workerId,
      output: payload.output,
      sources: payload.sources,
      toolCalls: payload.toolCalls,
      provenanceTrace: payload.provenanceTrace ?? null,
    });
    return { success: true };
  }

  @Post('automation-runs/:runId/fail')
  async failAutomationRun(
    @Param('runId') runId: string,
    @Body() payload: { workerId: string; error: string; cancelled?: boolean },
  ) {
    await this.automationService.failQueuedRun({
      runId,
      workerId: payload.workerId,
      error: payload.error,
      cancelled: payload.cancelled ?? false,
    });
    return { success: true };
  }

  @Post('sandbox-jobs')
  async enqueueSandboxJob(
    @Body()
    payload: Omit<SandboxJob, 'id' | 'status' | 'createdAt' | 'startedAt' | 'finishedAt' | 'workerId' | 'result'>,
  ) {
    return { job: await this.controlPlane.enqueueSandboxJob(payload) };
  }

  @Get('sandbox-jobs/:jobId')
  async getSandboxJob(@Param('jobId') jobId: string) {
    return { job: await this.controlPlane.getSandboxJob(jobId) };
  }

  @Post('sandbox-jobs/:jobId/start')
  async markSandboxJobStarted(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string },
  ) {
    return { job: await this.controlPlane.markSandboxJobStarted(jobId, payload.workerId) };
  }

  @Post('sandbox-jobs/:jobId/heartbeat')
  async markSandboxJobHeartbeat(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string },
  ) {
    return { job: await this.controlPlane.markSandboxJobHeartbeat(jobId, payload.workerId) };
  }

  @Post('sandbox-jobs/:jobId/complete')
  async completeSandboxJob(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string; result?: SandboxJob['result'] | null },
  ) {
    return {
      job: await this.controlPlane.markSandboxJobCompleted(jobId, payload.workerId, payload.result ?? null),
    };
  }

  @Post('sandbox-jobs/:jobId/fail')
  async failSandboxJob(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string; error: string; result?: SandboxJob['result'] | null },
  ) {
    return {
      job: await this.controlPlane.markSandboxJobFailed(jobId, payload.workerId, payload.error, payload.result ?? null),
    };
  }

  @Get('builder-jobs/:jobId')
  async getBuilderJob(@Param('jobId') jobId: string) {
    return { job: await this.controlPlane.getBuilderJob(jobId) };
  }

  @Post('builder-jobs/:jobId/start')
  async markBuilderJobStarted(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string },
  ) {
    await this.appBuilderService.markQueuedRunStarted(jobId, payload.workerId);
    return { success: true };
  }

  @Post('builder-jobs/:jobId/heartbeat')
  async markBuilderJobHeartbeat(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string },
  ) {
    await this.appBuilderService.markQueuedRunHeartbeat(jobId, payload.workerId);
    return { success: true };
  }

  @Post('builder-jobs/:jobId/complete')
  async completeBuilderJob(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string; summary: string; output?: Record<string, unknown> | null },
  ) {
    await this.appBuilderService.completeQueuedRun({
      jobId,
      workerId: payload.workerId,
      summary: payload.summary,
      output: payload.output ?? null,
    });
    return { success: true };
  }

  @Post('builder-jobs/:jobId/fail')
  async failBuilderJob(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string; error: string; output?: Record<string, unknown> | null },
  ) {
    await this.appBuilderService.failQueuedRun({
      jobId,
      workerId: payload.workerId,
      error: payload.error,
      output: payload.output ?? null,
    });
    return { success: true };
  }
}
