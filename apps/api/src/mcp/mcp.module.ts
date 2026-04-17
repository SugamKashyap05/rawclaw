import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MCPController } from './mcp.controller';
import { MCPService } from './mcp.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [HttpModule],
  controllers: [MCPController],
  providers: [MCPService, PrismaService],
  exports: [MCPService],
})
export class MCPModule {}
