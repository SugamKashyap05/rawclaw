import { Controller, Get, Post, Body, Delete, Param, UseGuards } from '@nestjs/common';
import { ModelsService, ModelWithPreference } from './models.service';
import { ModelsHealthResponse, UpdateModelsConfigRequest } from '@rawclaw/shared';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  async list(): Promise<ModelWithPreference[]> {
    return this.modelsService.getModels();
  }

  @Get('health')
  async health(): Promise<ModelsHealthResponse> {
    return this.modelsService.getHealth();
  }

  @Post('preferences')
  async updatePreference(
    @Body() data: { modelId: string; customName?: string; isFavorite?: boolean; provider?: string }
  ) {
    return this.modelsService.updatePreference(data.modelId, data);
  }

  @Delete('preferences/:id')
  async deletePreference(@Param('id') id: string) {
    return this.modelsService.deletePreference(id);
  }

  @Post('config')
  async updateConfig(@Body() payload: UpdateModelsConfigRequest): Promise<ModelsHealthResponse> {
    return this.modelsService.updateConfig(payload);
  }
}
