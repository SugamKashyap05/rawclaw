import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  imports: [HttpModule],
  controllers: [ToolsController],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}