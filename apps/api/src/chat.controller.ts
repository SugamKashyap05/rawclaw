import { Controller, Post, Body, Get, Param, Res } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RedisService } from './redis.service';
import { ChatService, SessionWithMessages } from './chat.service';
import { ChatRequest, ChatResponse, ModelInfo } from '@rawclaw/shared';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService
  ) {}

  @Post('send')
  async send(@Body() request: ChatRequest, @Res() res: Response) {
    const agentUrl = this.configService.get<string>('agentUrl');

    // 1. Get history for context if needed
    const history = await this.chatService.getMessages(request.session_id);
    request.messages = [...history, ...request.messages];

    // 2. Save user message immediately
    const userMsg = request.messages[request.messages.length - 1];
    await this.chatService.createMessage(request.session_id, userMsg.role, userMsg.content);

    // 3. Request streaming from Agent
    const agentStream = await firstValueFrom(
      this.httpService.post(`${agentUrl}/execute`, request, {
        responseType: 'stream'
      })
    );

    let fullAssistantResponse = '';

    // Set headers for SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    return new Promise<void>((resolve) => {
      agentStream.data.on('data', async (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (!line) return;

        try {
          const data = JSON.parse(line);

          if (data.type === 'content') {
            fullAssistantResponse += data.content;
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          } else if (data.type === 'done') {
            // Save assistant message to DB
            await this.chatService.createMessage(
              request.session_id,
              'assistant',
              fullAssistantResponse
            );
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
            resolve();
          } else {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        } catch (e) {
          console.error('SSE Error:', e);
        }
      });

      agentStream.data.on('error', (err: Error) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
        resolve();
      });

      agentStream.data.on('end', () => {
        res.end();
        resolve();
      });
    });
  }

  @Get('sessions')
  async listSessions(): Promise<SessionWithMessages[]> {
    return this.chatService.listSessions();
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string): Promise<SessionWithMessages | null> {
    return this.chatService.getSession(id);
  }

  @Get('models')
  async listModels(): Promise<{ models: ModelInfo[] }> {
    const agentUrl = this.configService.get<string>('agentUrl');
    const res = await firstValueFrom(
      this.httpService.get<{ models: ModelInfo[] }>(`${agentUrl}/api/models`)
    );
    return res.data;
  }
}