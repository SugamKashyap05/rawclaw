import { Controller, Post, Body, Get, Param, Res, UseGuards } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ChatService, SessionWithMessages } from './chat.service';
import { ChatRequest, ModelInfo } from '@rawclaw/shared';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ChatOrchestratorService } from './chat-orchestrator.service';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly httpService: HttpService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    private readonly orchestratorService: ChatOrchestratorService,
  ) {}

  @Post('send')
  async send(@Body() request: ChatRequest, @Res() res: Response) {
    return this.orchestratorService.processAndStreamChat(request, res);
  }

  @Get('sessions')
  async listSessions(): Promise<SessionWithMessages[]> {
    return this.chatService.listSessions();
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string): Promise<SessionWithMessages | null> {
    return this.chatService.getSession(id);
  }

  @Post('sessions/:id/delete')
  async deleteSession(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.chatService.deleteSession(id);
    return { success: true };
  }

  @Get('models')
  async listModels(): Promise<{ models: ModelInfo[] }> {
    const agentUrl = this.configService.get<string>('agentUrl');
    try {
      const res = await firstValueFrom(
        this.httpService.get<{ models: ModelInfo[] }>(`${agentUrl}/api/models`, {
          timeout: 5000
        })
      );
      return res.data;
    } catch (e: any) {
      console.error('Failed to fetch models from agent:', e.message);
      // Return a basic fallback if agent is down
      return { 
        models: [
          { id: 'ollama/llama3', name: 'Llama 3 (Cached)', provider: 'ollama' },
          { id: 'ollama/mistral', name: 'Mistral (Cached)', provider: 'ollama' }
        ]
      };
    }
  }
}
