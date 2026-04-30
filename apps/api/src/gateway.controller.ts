import { Controller, Get, Param, Post, Patch, Delete, Body, Res, UseGuards, Query } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { GatewayRoutingService } from './gateway-routing.service';
import { GatewayEventsService } from './gateway-events.service';
import { GatewaySubagentService } from './gateway-subagent.service';
import { SubagentInvocation } from '@rawclaw/shared';
import { CreateBindingRuleDto } from './gateway/dto/create-binding-rule.dto';
import { UpdateBindingRuleDto } from './gateway/dto/update-binding-rule.dto';
import { GatewayAutomationService } from './gateway-automation.service';
import { CreateAutomationJobDto } from './gateway/dto/create-automation-job.dto';
import { UpdateAutomationJobDto } from './gateway/dto/update-automation-job.dto';

@UseGuards(JwtAuthGuard)
@Controller('gateway')
export class GatewayController {
  constructor(
    private readonly routingService: GatewayRoutingService,
    private readonly gatewayEvents: GatewayEventsService,
    private readonly subagentService: GatewaySubagentService,
    private readonly automationService: GatewayAutomationService,
  ) {}

  @Get('routes')
  async listRoutes() {
    return this.routingService.listBindingsWithSummary();
  }

  @Get('rules')
  async listRules() {
    return { rules: await this.routingService.listRules() };
  }

  @Get('rules/:id')
  async getRule(@Param('id') id: string) {
    return { rule: await this.routingService.getRule(id) };
  }

  @Post('rules')
  async createRule(@Body() payload: CreateBindingRuleDto) {
    return { rule: await this.routingService.createRule(payload) };
  }

  @Patch('rules/:id')
  async updateRule(@Param('id') id: string, @Body() payload: UpdateBindingRuleDto) {
    return { rule: await this.routingService.updateRule(id, payload) };
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string) {
    return this.routingService.deleteRule(id);
  }

  @Get('routes/:id')
  async getRoute(@Param('id') id: string) {
    const recentEvents = await this.gatewayEvents.listRecent(100);
    const detail = await this.routingService.getBindingDetail(id, recentEvents);
    return detail ? { detail } : { detail: null };
  }

  @Get('events/recent')
  async recentEvents(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit || 50);
    return { events: await this.gatewayEvents.listRecent(Number.isFinite(parsedLimit) ? parsedLimit : 50) };
  }

  @Get('events/stream')
  async streamEvents(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const unsubscribe = await this.gatewayEvents.subscribe(async (event) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
      }
    }, 10000);

    res.on('close', () => {
      clearInterval(heartbeat);
      void unsubscribe();
      if (!res.writableEnded) {
        res.end();
      }
    });
  }

  @Post('subagents/spawn')
  async spawnSubagent(@Body() invocation: SubagentInvocation) {
    return this.subagentService.spawn(invocation);
  }

  @Get('automations')
  async listAutomations() {
    return { jobs: await this.automationService.listJobs() };
  }

  @Get('automations/:id')
  async getAutomation(@Param('id') id: string) {
    return { job: await this.automationService.getJob(id) };
  }

  @Get('automation-runs/recent')
  async recentAutomationRuns(@Query('limit') limit?: string, @Query('jobId') jobId?: string) {
    const parsedLimit = Number(limit || 25);
    return { runs: await this.automationService.listRuns(Number.isFinite(parsedLimit) ? parsedLimit : 25, jobId) };
  }

  @Post('automations')
  async createAutomation(@Body() payload: CreateAutomationJobDto) {
    return { job: await this.automationService.createJob(payload) };
  }

  @Patch('automations/:id')
  async updateAutomation(@Param('id') id: string, @Body() payload: UpdateAutomationJobDto) {
    return { job: await this.automationService.updateJob(id, payload) };
  }

  @Delete('automations/:id')
  async deleteAutomation(@Param('id') id: string) {
    return this.automationService.deleteJob(id);
  }
}
