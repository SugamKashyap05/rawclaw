import { Body, Controller, Get, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BootstrapAgentDraftRequest,
  BootstrapPreflightResponse,
  BootstrapResetResponse,
  BootstrapSetupRequest,
  BootstrapStatusResponse,
} from '@rawclaw/shared';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { BootstrapService } from './bootstrap.service';

@Controller('bootstrap')
export class BootstrapController {
  constructor(
    private readonly bootstrapService: BootstrapService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('status')
  getStatus(): Promise<BootstrapStatusResponse> {
    return this.bootstrapService.getStatus();
  }

  @Get('preflight')
  getPreflight(): Promise<BootstrapPreflightResponse> {
    return this.bootstrapService.getPreflight();
  }

  @Post('agent-draft')
  createAgentDraft(@Body() payload: BootstrapAgentDraftRequest) {
    return this.bootstrapService.suggestMainAgentDraft(payload);
  }

  @Post('setup')
  async setup(@Body() payload: BootstrapSetupRequest) {
    if (!payload.user?.trim()) {
      throw new UnauthorizedException('Workspace initialization requires user context');
    }

    const token = this.authService.generateToken({ sub: 'rawclaw-client', iat: Date.now() });
    const initialized = await this.bootstrapService.bootstrapSetup(payload);

    return {
      access_token: token,
      initialized: true,
      settings: initialized.settings,
      bootstrap: initialized.bootstrap,
      createdAgents: initialized.createdAgents,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('reset')
  reset(): Promise<BootstrapResetResponse> {
    return this.bootstrapService.factoryReset();
  }
}
