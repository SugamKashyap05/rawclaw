import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { DocsService } from './docs.service';
import { AgentsService } from './agents.service';
import { ChatRequest, ChatMessage } from '@rawclaw/shared';
import { Response } from 'express';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    private readonly docsService: DocsService,
    private readonly agentsService: AgentsService,
  ) {}

  async processAndStreamChat(request: ChatRequest, res: Response): Promise<void> {
    const agentUrl = this.configService.get<string>('agentUrl');
    const systemContext = await this.docsService.getSystemContext();
    const selectedAgent = await this.agentsService.getOptional(request.agent_id);

    // 1. Get history for context if needed
    const history = await this.chatService.getMessages(request.session_id);
    // Build message stack with proper system context
    const systemMessages: ChatMessage[] = [
      { role: 'system', content: systemContext }
    ];

    // Add agent system prompt if selected
    if (selectedAgent) {
      systemMessages.push({
        role: 'system',
        content: `Selected agent: ${selectedAgent.name}\n${selectedAgent.systemPrompt}`
      });
    }

    request.messages = [
      ...systemMessages,
      ...history.filter((message) => message.role !== 'system'),
      ...request.messages,
    ];

    // 2. Save user message immediately
    const userMsg = request.messages[request.messages.length - 1];
    await this.chatService.createMessage(request.session_id, userMsg.role, userMsg.content);

    // 3. Request streaming from Agent with retry and timeout
    let agentStream: any;
    let retries = 0;
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 1000;

    const attemptRequest = async (): Promise<any> => {
      try {
        return await firstValueFrom(
          this.httpService.post(`${agentUrl}/execute`, request, {
            responseType: 'stream',
            timeout: 30000,
          }),
        );
      } catch (err) {
        if (retries < MAX_RETRIES) {
          retries++;
          const delay = RETRY_DELAY * Math.pow(2, retries - 1);
          this.logger.warn(`Agent request failed, retrying in ${delay}ms... (Attempt ${retries}/${MAX_RETRIES})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return attemptRequest();
        }
        throw err;
      }
    };

    try {
      agentStream = await attemptRequest();
    } catch (err: any) {
      this.logger.error('Agent connection failed after retries:', err.message);
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: 'Agent Connection Failed',
        message: 'The RawClaw agent is currently unreachable or timed out. Please check if the agent service is running.'
      })}\n\n`);
      res.end();
      return;
    }

    let fullAssistantResponse = '';
    const toolCalls: any[] = [];
    const toolResults: any[] = [];
    let provenance: any = null;
    const sources: string[] = [];

    let streamBuffer = '';
    let streamClosed = false;

    // Set headers for SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    return new Promise<void>((resolve) => {
      const finalize = async (payload?: Record<string, unknown>) => {
        if (streamClosed) return;
        streamClosed = true;

        // Always persist an assistant message, even for failed turns
        const citations = sources.length > 0 ? sources.map(url => ({ url, title: url })) : undefined;
        await this.chatService.createMessage(
          request.session_id,
          'assistant',
          fullAssistantResponse || 'Request failed',
          toolCalls.length > 0 ? toolCalls : undefined,
          toolResults.length > 0 ? toolResults : undefined,
          provenance,
          citations
        );

        if (payload) {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
        res.end();
        resolve();
      };

      const processLine = async (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const data = JSON.parse(trimmed);

          if (data.type === 'content') {
            fullAssistantResponse += data.content || '';
          } else if (data.type === 'tool_call') {
            toolCalls.push(data.tool_call || data);
          } else if (data.type === 'tool_result') {
            toolResults.push(data.tool_result || data);
          } else if (data.type === 'provenance') {
            provenance = data.provenance || data;
          } else if (data.type === 'sources') {
            if (Array.isArray(data.sources)) {
              sources.push(...data.sources);
            }
          }

          if (data.type === 'done') {
            await finalize({ type: 'done' });
            return;
          }

          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (e) {
          this.logger.error('SSE parse error:', e, trimmed);
        }
      };

      agentStream.data.on('data', (chunk: Buffer) => {
        streamBuffer += chunk.toString('utf8');
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';

        void (async () => {
          for (const line of lines) {
            await processLine(line);
            if (streamClosed) break;
          }
        })();
      });

      agentStream.data.on('error', (err: Error) => {
        void finalize({ type: 'error', error: err.message });
      });

      agentStream.data.on('end', () => {
        void (async () => {
          if (streamBuffer.trim()) {
            await processLine(streamBuffer);
          }
          await finalize({ type: 'done' });
        })();
      });
    });
  }
}
