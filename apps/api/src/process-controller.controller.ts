import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import {
  CompleteHarnessProcessRequest,
  CompleteHarnessRunRequest,
  HarnessRunRecord,
  StartHarnessProcessRequest,
  StartHarnessRunRequest,
} from '@rawclaw/shared';
import { ProcessControllerService } from './process-controller.service';

@UseGuards(JwtAuthGuard)
@Controller('process-controller')
export class ProcessControllerController {
  constructor(private readonly processControllerService: ProcessControllerService) {}

  @Get('runs')
  async listRuns(@Query('limit') limit?: string): Promise<HarnessRunRecord[]> {
    const parsedLimit = limit ? Number(limit) : 20;
    return this.processControllerService.listRuns(Number.isFinite(parsedLimit) ? parsedLimit : 20);
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    return this.processControllerService.getRun(id);
  }

  @Post('runs')
  async startRun(@Body() body: StartHarnessRunRequest) {
    return this.processControllerService.startRun(body);
  }

  @Patch('runs/:id/heartbeat')
  async heartbeatRun(@Param('id') id: string, @Body() body?: { metadata?: Record<string, unknown> }) {
    return this.processControllerService.heartbeatRun(id, body?.metadata);
  }

  @Patch('runs/:id/complete')
  async completeRun(@Param('id') id: string, @Body() body: CompleteHarnessRunRequest) {
    return this.processControllerService.completeRun(id, body);
  }

  @Post('runs/:id/processes')
  async startProcess(@Param('id') id: string, @Body() body: StartHarnessProcessRequest) {
    return this.processControllerService.startProcess(id, body);
  }

  @Patch('processes/:id')
  async updateProcess(
    @Param('id') id: string,
    @Body() body: Partial<CompleteHarnessProcessRequest> & { pid?: number },
  ) {
    return this.processControllerService.updateProcess(id, body);
  }
}
