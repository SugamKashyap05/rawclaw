import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { ScheduleService } from './schedule.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [HttpModule],
  controllers: [TasksController],
  providers: [TasksService, ScheduleService, PrismaService],
  exports: [TasksService],
})
export class TasksModule {}
