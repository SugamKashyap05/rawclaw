import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  StreamableFile,
  Header,
  Res,
  HttpStatus,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { TasksService } from './tasks.service';
import { ScheduleService } from './schedule.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskRunDto } from './dto/update-task-run.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly scheduleService: ScheduleService,
  ) {}

  @Post()
  async create(@Body() dto: CreateTaskDto) {
    const task = await this.tasksService.createDefinition(dto);
    if (task.schedule && task.enabled) {
      await this.scheduleService.registerTask(task.id, task);
    }
    return {
      ...task,
      nextRun: task.schedule && task.enabled ? this.scheduleService.getNextRun(task.schedule) : null,
    };
  }

  @Get()
  async list() {
    const tasks = await this.tasksService.listDefinitions();
    return tasks.map((task) => ({
      ...task,
      nextRun: task.schedule && task.enabled ? this.scheduleService.getNextRun(task.schedule) : null,
    }));
  }

  @Get('schedule/preview')
  previewSchedule(@Query('expression') expression?: string) {
    return this.scheduleService.preview(expression);
  }

  @Get('scheduled')
  listScheduled() {
    return this.scheduleService.getScheduledTasks();
  }

  @Get('runs')
  listRuns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('agentId') agentId?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.tasksService.listRuns({
      page: +page! || 1,
      limit: +limit! || 25,
      status,
      agentId,
      sessionId,
    });
  }

  @Get('runs/recent')
  listRecentRuns(@Query('sessionId') sessionId?: string) {
    return this.tasksService.listRecentRuns(sessionId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const task = await this.tasksService.getDefinition(id);
    return {
      ...task,
      nextRun: task.schedule && task.enabled ? this.scheduleService.getNextRun(task.schedule) : null,
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    const task = await this.tasksService.updateDefinition(id, dto);
    await this.scheduleService.unregisterTask(id);
    if (task.schedule && task.enabled) {
      await this.scheduleService.registerTask(id, task);
    }
    return {
      ...task,
      nextRun: task.schedule && task.enabled ? this.scheduleService.getNextRun(task.schedule) : null,
    };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.scheduleService.unregisterTask(id);
    return this.tasksService.deleteDefinition(id);
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(@Param('id') id: string) {
    return this.tasksService.enqueueRun(id, { triggeredBy: 'manual' });
  }

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.tasksService.getRunDetail(runId);
  }

  @Delete('runs/:runId')
  deleteRun(@Param('runId') runId: string) {
    return this.tasksService.deleteRun(runId);
  }

  @Post('runs/:runId/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  resumeRun(@Param('runId') runId: string, @Body('sessionId') sessionId: string) {
    return this.tasksService.resumeRun(runId, sessionId, 'manual');
  }

  @Post('runs/:runId/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  cancelRun(@Param('runId') runId: string) {
    return this.tasksService.cancelRun(runId);
  }

  @Post('runs/:runId/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeatRun(@Param('runId') runId: string) {
    return this.tasksService.heartbeatRun(runId);
  }

  @Post('runs/:runId/update')
  @HttpCode(HttpStatus.OK)
  updateRun(@Param('runId') runId: string, @Body() dto: UpdateTaskRunDto) {
    return this.tasksService.updateRun(runId, dto);
  }

  @Get('runs/:runId/artifact')
  @Header('Content-Type', 'application/octet-stream')
  async downloadArtifact(
    @Param('runId') runId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const run = await this.tasksService.getRunDetail(runId);
    if (!run.outputPath) {
      throw new Error('No artifact available for this run');
    }

    const filePath = path.join(process.cwd(), '../..', run.outputPath);
    const fileName = path.basename(filePath);
    res.set({
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    const file = fs.createReadStream(filePath);
    return new StreamableFile(file);
  }
}
