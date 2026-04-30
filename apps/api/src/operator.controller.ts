import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { OperatorService } from './operator.service';

@UseGuards(JwtAuthGuard)
@Controller('operator')
export class OperatorController {
  constructor(private readonly operatorService: OperatorService) {}

  @Get('snapshot')
  snapshot(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit || 60);
    return this.operatorService.getSnapshot(Number.isFinite(parsedLimit) ? parsedLimit : 60);
  }

  @Get('timeline')
  timeline(
    @Query('limit') limit?: string,
    @Query('sessionId') sessionId?: string,
    @Query('agentId') agentId?: string,
    @Query('memoryLayer') memoryLayer?: string,
    @Query('eventType') eventType?: string,
  ) {
    const parsedLimit = Number(limit || 60);
    return this.operatorService.getTimeline({
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 60,
      sessionId,
      agentId,
      memoryLayer,
      eventType,
    });
  }

  @Get('agents')
  agents() {
    return this.operatorService.listActiveAgents();
  }

  @Post('agents/:id/pause')
  pauseAgent(@Param('id') id: string) {
    return this.operatorService.pauseAgent(id);
  }

  @Post('agents/:id/resume')
  resumeAgent(@Param('id') id: string) {
    return this.operatorService.resumeAgent(id);
  }

  @Post('runs/:id/cancel')
  cancelRun(@Param('id') id: string) {
    return this.operatorService.cancelRun(id);
  }

  @Post('runs/:id/retry')
  retryRun(@Param('id') id: string) {
    return this.operatorService.retryRun(id);
  }
}
