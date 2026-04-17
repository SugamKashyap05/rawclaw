import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { SystemService } from './system.service';
import { SystemStatusSnapshot } from '@rawclaw/shared';

@UseGuards(JwtAuthGuard)
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('status')
  getStatus(): Promise<SystemStatusSnapshot> {
    return this.systemService.getStatus();
  }
}
