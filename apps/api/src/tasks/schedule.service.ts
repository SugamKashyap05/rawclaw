import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { TasksService } from './tasks.service';

interface CronParser {
  parseExpression(expression: string, options?: { currentDate?: Date | string }): { prev(): { toDate(): Date } };
  parse(expression: string): { next(): { toDate(): Date } };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const parser = require('cron-parser') as CronParser;

interface ScheduledTask {
  taskId: string;
  definition: any;
}

@Injectable()
export class ScheduleService implements OnModuleInit {
  private readonly logger = new Logger(ScheduleService.name);
  private scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
  ) {}

  async onModuleInit() {
    await this.loadScheduledTasks();
  }

  private async loadScheduledTasks() {
    const tasks = await this.prisma.taskDefinition.findMany({
      where: {
        schedule: { not: null },
      },
    });

    for (const task of tasks) {
      if (task.schedule) {
        this.scheduledTasks.set(task.id, {
          taskId: task.id,
          definition: task,
        });
        this.logger.log(`Registered cron job: ${task.name} (${task.schedule})`);
      }
    }

    this.logger.log(`Loaded ${this.scheduledTasks.size} scheduled tasks`);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    const now = new Date();
    this.logger.debug(`Running cron check at ${now.toISOString()}`);

    for (const [taskId, scheduled] of this.scheduledTasks) {
      try {
        const definition = await this.prisma.taskDefinition.findUnique({
          where: { id: taskId },
        });

        if (!definition || !definition.schedule) continue;

        const nextRun = this.getNextRun(definition.schedule);
        if (!nextRun) continue;

        if (this.shouldRun(definition.schedule, now)) {
          this.logger.log(`Triggering scheduled task: ${definition.name}`);
          
          try {
            await this.tasksService.enqueueRun(taskId);
            this.logger.log(`Task ${definition.name} enqueued successfully`);
          } catch (error: any) {
            this.logger.error(`Failed to enqueue task ${definition.name}: ${error.message}`);
          }
        }
      } catch (error: any) {
        this.logger.error(`Error processing scheduled task ${taskId}: ${error.message}`);
      }
    }
  }

  private shouldRun(cronExpression: string, now: Date): boolean {
    try {
      const interval = parser.parseExpression(cronExpression, {
        currentDate: now,
      });
      const prev = interval.prev().toDate();
      const diff = now.getTime() - prev.getTime();
      return diff < 60000;
    } catch {
      return false;
    }
  }

  async registerTask(taskId: string, definition: any) {
    if (definition.schedule) {
      this.scheduledTasks.set(taskId, {
        taskId,
        definition,
      });
      this.logger.log(`Registered new scheduled task: ${definition.name}`);
    }
  }

  async unregisterTask(taskId: string) {
    const scheduled = this.scheduledTasks.get(taskId);
    if (scheduled) {
      this.scheduledTasks.delete(taskId);
      this.logger.log(`Unregistered scheduled task: ${scheduled.definition.name}`);
    }
  }

  getNextRun(cronExpression: string): Date | null {
    try {
      const interval = parser.parse(cronExpression);
      return interval.next().toDate();
    } catch (err) {
      return null;
    }
  }

  async getScheduledTasks() {
    const tasks = await this.prisma.taskDefinition.findMany({
      where: {
        schedule: { not: null },
      },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return tasks.map((t) => ({
      id: t.id,
      name: t.name,
      schedule: t.schedule,
      nextRun: t.schedule ? this.getNextRun(t.schedule) : null,
      lastRunStatus: t.runs[0]?.status || 'never_run',
    }));
  }
}