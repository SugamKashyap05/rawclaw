import { Controller, Post, Body, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { BootstrapSetupDto, TokenRequestDto } from './auth.dto';
import { SettingsService } from '../settings.service';
import { Get } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get('bootstrap/status')
  getBootstrapStatus() {
    return this.settingsService.getBootstrapStatus();
  }

  @Post('token')
  async generateToken(@Body() dto: TokenRequestDto) {
    const expectedSecret = this.configService.get<string>('authSecret');
    const allowLocalAuth = this.configService.get<string>('allowLocalAuth') !== 'false';

    if (!allowLocalAuth && dto.secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid secret');
    }

    const payload = { sub: 'rawclaw-client', iat: Date.now() };
    const token = this.authService.generateToken(payload);
    
    return { access_token: token };
  }

  @Post('bootstrap/setup')
  async bootstrap(@Body() dto: BootstrapSetupDto) {
    if (!dto.user.trim()) {
      throw new UnauthorizedException('USER.md initialization requires user context');
    }

    const payload = { sub: 'rawclaw-client', iat: Date.now() };
    const token = this.authService.generateToken(payload);
    const settings = await this.settingsService.bootstrapWorkspace({
      user: dto.user,
      soul: dto.soul,
      memory: dto.memory,
      tools: dto.tools,
    });

    return {
      access_token: token,
      initialized: true,
      settings,
    };
  }
}
