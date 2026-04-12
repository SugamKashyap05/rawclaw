import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import parser from 'cron-parser';

@Injectable()
export class ScheduleService implements OnModuleInit {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const tasks = await this.prisma.taskDefinition.findMany({
      where: {
        schedule: { not: null },
      },
    });

    for (const task of tasks) {
      if (task.schedule) {
        this.logger.log(`Scheduled task: ${task.name} with cron: ${task.schedule}`);
        // In Phase 7, we would register this with a real scheduler (e.g. node-cron or Agenda)
      }
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
    });

    return tasks.map((t) => ({
      id: t.id,
      name: t.name,
      schedule: t.schedule,
      nextRun: t.schedule ? this.getNextRun(t.schedule) : null,
      lastRunStatus: 'stub', // Placeholder until real execution is added
    }));
  }
}
