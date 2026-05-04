import { Controller, Get, Param, Post, Patch, Delete, Body, Res, UseGuards, Query } from '@nestjs/common';
import type { Response } from 'express';
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
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { ReflectionService } from './reflection.service';

@UseGuards(JwtAuthGuard)
@Controller('gateway')
export class GatewayController {
  constructor(
    private readonly routingService: GatewayRoutingService,
    private readonly gatewayEvents: GatewayEventsService,
    private readonly subagentService: GatewaySubagentService,
    private readonly automationService: GatewayAutomationService,
    private readonly controlPlane: GatewayControlPlaneService,
    private readonly knowledgeGraph: KnowledgeGraphService,
    private readonly reflection: ReflectionService,
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

  @Get('runs/recent')
  async recentRuns(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit || 50);
    return { runs: await this.controlPlane.listRecentRuns(Number.isFinite(parsedLimit) ? parsedLimit : 50) };
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    return { run: await this.controlPlane.getRun(id) };
  }

  @Get('workers/recent')
  async recentWorkers(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit || 50);
    return {
      workers: await this.controlPlane.listWorkers(Number.isFinite(parsedLimit) ? parsedLimit : 50),
    };
  }

  @Get('queues/recent')
  async recentQueueJobs(
    @Query('queueType') queueType: 'subagent' | 'automation' | 'sandbox' | 'builder',
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit || 50);
    return {
      jobs: queueType
        ? await this.controlPlane.listRecentQueueJobs(queueType, Number.isFinite(parsedLimit) ? parsedLimit : 50)
        : [],
    };
  }

  @Get('role-traces/latest')
  async getLatestRoleTrace(
    @Query('sessionId') sessionId?: string,
    @Query('runId') runId?: string,
  ) {
    if (runId) {
      return { roleTrace: await this.controlPlane.getRoleTraceByRun(runId) };
    }
    if (sessionId) {
      return { roleTrace: await this.controlPlane.getLatestRoleTraceForSession(sessionId) };
    }
    return { roleTrace: null };
  }

  @Get('short-term-memory')
  async getShortTermMemory(
    @Query('sessionId') sessionId: string,
    @Query('runId') runId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit || 50);
    return {
      memory: sessionId
        ? await this.controlPlane.listShortTermMemory(
            sessionId,
            runId,
            Number.isFinite(parsedLimit) ? parsedLimit : 50,
          )
        : [],
    };
  }

  @Get('knowledge-graph/ingestions/recent')
  async recentGraphIngestions(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit || 25);
    return {
      ingestions: await this.knowledgeGraph.listRecentIngestions(Number.isFinite(parsedLimit) ? parsedLimit : 25),
    };
  }

  @Get('knowledge-graph')
  async getKnowledgeGraph(
    @Query('runId') runId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('entity') entity?: string,
    @Query('url') url?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit || 25);
    return {
      graph: await this.knowledgeGraph.search({
        runId,
        sessionId,
        entity,
        url,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 25,
      }),
    };
  }

  @Get('reflection/proposals')
  async listReflectionProposals(
    @Query('status') status?: 'proposed' | 'approved' | 'published' | 'rejected',
    @Query('runId') runId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit || 50);
    return {
      proposals: await this.reflection.listProposalViews({
        status,
        runId,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      }),
    };
  }

  @Get('reflection/proposals/:id')
  async getReflectionProposal(@Param('id') id: string) {
    return { proposal: await this.reflection.getProposalView(id) };
  }

  @Post('reflection/proposals/:id/approve')
  async approveReflectionProposal(@Param('id') id: string, @Body() body?: { notes?: string | null }) {
    await this.reflection.approveProposal(id, body?.notes ?? null);
    return { proposal: await this.reflection.getProposalView(id) };
  }

  @Post('reflection/proposals/:id/publish')
  async publishReflectionProposal(@Param('id') id: string, @Body() body?: { notes?: string | null }) {
    await this.reflection.publishProposal(id, body?.notes ?? null);
    return { proposal: await this.reflection.getProposalView(id) };
  }

  @Post('reflection/proposals/:id/reject')
  async rejectReflectionProposal(@Param('id') id: string, @Body() body?: { notes?: string | null }) {
    await this.reflection.rejectProposal(id, body?.notes ?? null);
    return { proposal: await this.reflection.getProposalView(id) };
  }

  @Get('simulations')
  async listSimulations(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit || 50);
    return { runs: await this.reflection.listSimulations(Number.isFinite(parsedLimit) ? parsedLimit : 50) };
  }

  @Get('simulations/:id')
  async getSimulation(@Param('id') id: string) {
    return { run: await this.reflection.getSimulation(id) };
  }

  @Post('simulations')
  async queueSimulation(@Body() body: { runId?: string | null; proposalId?: string | null; inputEnvelope?: Record<string, unknown> }) {
    return {
      run: await this.reflection.queueSimulation({
        runId: body.runId ?? null,
        proposalId: body.proposalId ?? null,
        inputEnvelope: body.inputEnvelope,
      }),
    };
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
