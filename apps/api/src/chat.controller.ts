import { Controller, Post, Body, Get, Param, Res, UseGuards, Req, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ChatService, SessionWithMessages } from './chat.service';
import { ChatControlState, ChatNluOverride, ChatRequest, ModelInfo } from '@rawclaw/shared';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { randomUUID } from 'crypto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    private readonly orchestratorService: ChatOrchestratorService,
  ) {}

  @Post('send')
  async send(@Body() request: ChatRequest, @Res() res: Response, @Req() req: Request) {
    try {
      const correlationId = request.correlationId || request.correlation_id || `rc-${Date.now()}-${randomUUID().slice(0, 8)}`;
      request.correlationId = correlationId;
      request.correlation_id = correlationId;
      this.logger.debug(
        `[REQUEST_RECEIVED] accept=${String(req.headers.accept || '')} ` +
        `contentType=${String(req.headers['content-type'] || '')} ` +
        `authorization=${req.headers.authorization ? 'present' : 'missing'} ` +
        `bodyKeys=${Object.keys(request || {}).join(',')} ` +
        `session_id=${request?.session_id || 'missing'} ` +
        `messageCount=${Array.isArray(request?.messages) ? request.messages.length : 0} ` +
        `correlationId=${correlationId}`,
      );
      return await this.orchestratorService.processAndStreamChat(request, res);
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'agent_error',
          message: 'Something went wrong. Please try again.',
          retryable: true,
        });
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
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

  @Post('sessions/:id/preferences')
  async saveSessionPreferences(
    @Param('id') id: string,
    @Body() body: ChatControlState,
  ): Promise<{ success: boolean }> {
    await this.chatService.upsertSessionControls(id, body);
    return { success: true };
  }

  @Post('edit')
  async editAndResend(
    @Body() body: { 
      sessionId: string; 
      messageId: string; 
      content: string;
      model?: string;
      complexity?: string;
      agentId?: string;
      temperature?: number;
      top_p?: number;
    },
    @Res() res: Response
  ) {
    try {
      return await this.orchestratorService.editAndResend(
        body.sessionId, 
        body.messageId, 
        body.content, 
        res,
        { model: body.model, complexity: body.complexity, agentId: body.agentId, temperature: body.temperature, top_p: body.top_p }
      );
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'agent_error',
          message: 'Something went wrong. Please try again.',
          retryable: true,
        });
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Post('regenerate')
  async regenerate(
    @Body() body: { 
      sessionId: string; 
      messageId: string;
      model?: string;
      complexity?: string;
      agentId?: string;
      temperature?: number;
      top_p?: number;
      nluOverride?: ChatNluOverride | null;
    },
    @Res() res: Response
  ) {
    try {
      return await this.orchestratorService.regenerate(
        body.sessionId, 
        body.messageId, 
        res,
        { model: body.model, complexity: body.complexity, agentId: body.agentId, temperature: body.temperature, top_p: body.top_p, nluOverride: body.nluOverride }
      );
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'agent_error',
          message: 'Something went wrong. Please try again.',
          retryable: true,
        });
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Get('docs/:id')
  async getDocument(@Param('id') id: string) {
    return this.chatService.getDocument(id);
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
          { id: 'ollama/gemma4:31b-cloud', name: 'Gemma 4 31B Cloud (Fallback)', provider: 'ollama' },
          { id: 'ollama/gemma4:e4b', name: 'Gemma 4 E4B (Fallback)', provider: 'ollama' }
        ]
      };
    }
  }
}
