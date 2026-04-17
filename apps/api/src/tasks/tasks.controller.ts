import {
  Controller,
  Get,
  Post,
  Delete,
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
import { Response } from 'express';
import { TasksService } from './tasks.service';
import { ScheduleService } from './schedule.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskRunDto } from './dto/update-task-run.dto';
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
    if (dto.schedule) {
      await this.scheduleService.registerTask(task.id, task);
    }
    return task;
  }

  @Get()
  list() {
    return this.tasksService.listDefinitions();
  }

  @Get('runs')
  listRuns(@Query('page') page: string, @Query('limit') limit: string) {
    return this.tasksService.listRuns(+page || 1, +limit || 10);
  }

  @Get('runs/recent')
  listRecentRuns() {
    return this.tasksService.listRuns(1, 10);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tasksService.getDefinition(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.scheduleService.unregisterTask(id);
    return this.tasksService.deleteDefinition(id);
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(@Param('id') id: string) {
    return this.tasksService.enqueueRun(id);
  }

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.tasksService.getRunDetail(runId);
  }

  @Delete('runs/:runId')
  deleteRun(@Param('runId') runId: string) {
    return this.tasksService.deleteRun(runId);
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
    if (!fs.existsSync(filePath)) {
      throw new Error('Artifact file not found on disk');
    }

    const fileName = path.basename(filePath);
    res.set({
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    const file = fs.createReadStream(filePath);
    return new StreamableFile(file);
  }
}
