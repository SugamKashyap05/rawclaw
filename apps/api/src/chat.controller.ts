import { Controller, Post, Body, Get, Param, Sse, MessageEvent } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RedisService } from './redis.service';
import { ChatService } from './chat.service';
import { ChatRequest, ChatResponse, ModelInfo } from '@rawclaw/shared';
import { firstValueFrom, Observable } from 'rxjs';
import { IncomingMessage } from 'http';
import { ConfigService } from '@nestjs/config';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService
  ) {}

  @Sse('send')
  async send(@Body() request: ChatRequest): Promise<Observable<MessageEvent>> {
    const agentUrl = this.configService.get<string>('agentUrl');
    
    // 1. Get history for context if needed
    const history = await this.chatService.getMessages(request.session_id);
    request.messages = [...history, ...request.messages];

    // 2. Save user message immediately
    const userMsg = request.messages[request.messages.length - 1];
    await this.chatService.createMessage(request.session_id, userMsg.role, userMsg.content);

    // 3. Request streaming from Agent
    const agentStream = await firstValueFrom(
      this.httpService.post<IncomingMessage>(`${agentUrl}/execute`, request, {
        responseType: 'stream'
      })
    );

    let fullAssistantResponse = '';

    return new Observable<MessageEvent>((subscriber) => {
      agentStream.data.on('data', async (chunk) => {
        const line = chunk.toString().trim();
        if (!line) return;

        try {
          const data = JSON.parse(line);
          
          if (data.type === 'content') {
            fullAssistantResponse += data.content;
            subscriber.next({ data: JSON.stringify(data) });
          } else if (data.type === 'done') {
            // Save assistant message to DB
            await this.chatService.createMessage(
              request.session_id, 
              'assistant', 
              fullAssistantResponse
            );
            subscriber.next({ data: JSON.stringify({ type: 'done' }) });
            subscriber.complete();
          } else {
            subscriber.next({ data: JSON.stringify(data) });
          }
        } catch (e) {
          console.error('SSE Error:', e);
        }
      });

      agentStream.data.on('error', (err) => subscriber.error(err));
      agentStream.data.on('end', () => subscriber.complete());
    });
  }

  @Get('sessions')
  async listSessions() {
    return this.chatService.listSessions();
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
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
