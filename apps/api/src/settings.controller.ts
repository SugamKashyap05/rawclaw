import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsPayload, UpdateSettingsRequest } from '@rawclaw/shared';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings(): Promise<SettingsPayload> {
    return this.settingsService.getPayload();
  }

  @Post()
  updateSettings(@Body() payload: UpdateSettingsRequest): Promise<SettingsPayload> {
    return this.settingsService.update(payload);
  }

  @Post('bots/:bot/start')
  startBot(@Param('bot') bot: 'telegram' | 'discord') {
    return this.settingsService.setBotEnabled(bot, true);
  }

  @Post('bots/:bot/stop')
  stopBot(@Param('bot') bot: 'telegram' | 'discord') {
    return this.settingsService.setBotEnabled(bot, false);
  }

  @Post('integrations/:provider/connect')
  connectIntegration(@Param('provider') provider: 'github' | 'slack') {
    return this.settingsService.setIntegration(provider, true);
  }

  @Post('integrations/:provider/disconnect')
  disconnectIntegration(@Param('provider') provider: 'github' | 'slack') {
    return this.settingsService.setIntegration(provider, false);
  }
}
