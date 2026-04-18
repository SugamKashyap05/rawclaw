import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskRunDto } from './dto/update-task-run.dto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Task, TaskRun } from '@rawclaw/shared';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async createDefinition(dto: CreateTaskDto) {
    return this.prisma.taskDefinition.create({
      data: {
        name: dto.name,
        description: dto.description,
        agentId: dto.agentId,
        toolIds: JSON.stringify(dto.toolIds),
        schedule: dto.schedule,
        workspaceId: dto.workspaceId || 'default',
      },
    });
  }

  async listDefinitions() {
    const definitions = await this.prisma.taskDefinition.findMany({
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return definitions.map((d) => ({
      ...d,
      toolIds: JSON.parse(d.toolIds),
      lastRunStatus: d.runs[0]?.status,
    }));
  }

  async getDefinition(id: string) {
    const def = await this.prisma.taskDefinition.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!def) throw new NotFoundException('Task definition not found');

    return {
      ...def,
      toolIds: JSON.parse(def.toolIds),
    };
  }

  async deleteDefinition(id: string) {
    return this.prisma.taskDefinition.delete({ where: { id } });
  }

  async enqueueRun(definitionId: string) {
    const definition = await this.prisma.taskDefinition.findUnique({
      where: { id: definitionId },
    });
    if (!definition) throw new NotFoundException('Task definition not found');

    const run = await this.prisma.taskRun.create({
      data: {
        definitionId,
        status: 'queued',
      },
    });

    // Fire and forget send to agent
    const agentUrl = this.configService.get<string>('agentUrl');
    firstValueFrom(
      this.httpService.post(`${agentUrl}/execute/task`, {
        run_id: run.id,
        definition: {
          ...definition,
          toolIds: JSON.parse(definition.toolIds),
        },
      })
    ).catch((err) => {
      console.error('Failed to trigger agent task:', err);
      this.updateRun(run.id, { 
        status: 'failed', 
        errorMessage: 'Failed to reach Agent: ' + err.message 
      });
    });

    return run;
  }

  async listRuns(page = 1, limit = 10) {
    return this.prisma.taskRun.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { definition: true },
    });
  }

  async getRunDetail(runId: string) {
    const run = await this.prisma.taskRun.findUnique({
      where: { id: runId },
      include: { 
        definition: true,
        steps: { orderBy: { stepIndex: 'asc' } }
      },
    });

    if (!run) throw new NotFoundException('Task run not found');

    return {
      ...run,
      provenance: run.provenance ? JSON.parse(run.provenance) : null,
    };
  }

  async updateRun(runId: string, dto: UpdateTaskRunDto) {
    const data: any = { status: dto.status };
    
    if (dto.outputPath) data.outputPath = dto.outputPath;
    if (dto.errorMessage) data.errorMessage = dto.errorMessage;
    if (dto.provenance) data.provenance = JSON.stringify(dto.provenance);
    
    if (dto.status === 'running' && !data.startedAt) {
      data.startedAt = new Date();
    }
    if (['done', 'failed', 'cancelled'].includes(dto.status)) {
      data.finishedAt = new Date();
    }

    const run = await this.prisma.taskRun.update({
      where: { id: runId },
      data,
    });

    if (dto.steps && dto.steps.length > 0) {
      // For simplicity, we just sync the steps provided
      // In a real app we might append them
      for (const step of dto.steps) {
        await this.prisma.runStep.upsert({
          where: { id: step.id || 'new-step-' + step.stepIndex },
          update: { ...step, runId },
          create: { ...step, runId, id: undefined },
        });
      }
    }

    return run;
  }

  async deleteRun(runId: string) {
    return this.prisma.taskRun.delete({ where: { id: runId } });
  }

  async resumeRun(runId: string, sessionId?: string) {
    const previousRun = await this.prisma.taskRun.findUnique({
      where: { id: runId },
    });

    if (!previousRun) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    // Per rules: create a new run from the same task definition, do not mutate old run.
    // Link via resumedFromRunId.
    const newRun = await this.prisma.taskRun.create({
      data: {
        definitionId: previousRun.definitionId,
        status: 'queued',
        resumedFromRunId: runId,
        sessionId,
        selectedAgent: previousRun.selectedAgent,
      },
    });

    const definition = await this.getDefinition(previousRun.definitionId);

    // Trigger Agent execution
    const agentUrl = this.configService.get<string>('agentUrl');
    firstValueFrom(
      this.httpService.post(`${agentUrl}/execute/task`, {
        run_id: newRun.id,
        definition: {
          ...definition,
          toolIds: definition.toolIds, // getDefinition already parses toolIds
        },
        context: {
          resumed_from: runId,
          // We could pass more context here if agent supported it, 
          // but for now this satisfies the Slice 2 requirements.
        }
      })
    ).catch((err) => {
      console.error('Failed to trigger resumed agent task:', err);
      this.updateRun(newRun.id, { 
        status: 'failed', 
        errorMessage: 'Failed to reach Agent during resume: ' + err.message 
      });
    });

    return newRun;
  }
}
