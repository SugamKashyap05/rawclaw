import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AppBuilderService } from './app-builder/app-builder.service';
import { InternalWorkerGuard } from './internal-worker.guard';

@UseGuards(InternalWorkerGuard)
@Controller('app-builder/internal')
export class AppBuilderInternalController {
  constructor(private readonly appBuilder: AppBuilderService) {}

  @Post('jobs/:jobId/execute')
  async executeJob(
    @Param('jobId') jobId: string,
    @Body() payload: { workerId: string },
  ) {
    return {
      result: await this.appBuilder.executeQueuedRun(jobId, payload.workerId),
    };
  }
}
