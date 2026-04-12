import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MCPController } from './mcp.controller';
import { ToolsService } from '../tools/tools.service';

@Module({
  imports: [HttpModule],
  controllers: [MCPController],
  providers: [ToolsService],
})
export class MCPModule {}