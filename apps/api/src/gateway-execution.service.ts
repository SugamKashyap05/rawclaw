import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRequest } from '@rawclaw/shared';
import { firstValueFrom } from 'rxjs';

export type GatewayExecutionResult = {
  content: string;
  sources: string[];
  toolCalls: Record<string, unknown>[];
  provenanceTrace: Record<string, unknown> | null;
};

@Injectable()
export class GatewayExecutionService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async fetchToolSchemas(allowedTools?: string[]): Promise<any[]> {
    const agentUrl = this.configService.get<string>('agentUrl');
    const toolsResponse = await firstValueFrom(
      this.httpService.get(`${agentUrl}/api/tools`, { timeout: 15000 }),
    );

    const allTools = toolsResponse.data.tools || [];
    const allowedSet = allowedTools?.length ? new Set(allowedTools) : null;
    return allTools
      .filter((tool: any) => !allowedSet || allowedSet.has(tool?.name))
      .map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
  }

  async executeChatRun(
    request: ChatRequest,
    timeoutMs = 60000,
    onHeartbeat?: () => Promise<void> | void,
    shouldCancel?: () => Promise<boolean> | boolean,
  ): Promise<GatewayExecutionResult> {
    const agentUrl = this.configService.get<string>('agentUrl');
    const abortController = new AbortController();
    const response = await firstValueFrom(
      this.httpService.post(`${agentUrl}/execute`, request, {
        responseType: 'stream',
        timeout: timeoutMs,
        signal: abortController.signal,
      }),
    );

    let content = '';
    let provenanceTrace: Record<string, unknown> | null = null;
    const sources: string[] = [];
    const toolCalls: Record<string, unknown>[] = [];
    let buffer = '';
    let heartbeatTimer: NodeJS.Timeout | null = null;

    if (onHeartbeat) {
      heartbeatTimer = setInterval(() => {
        void (async () => {
          await onHeartbeat();
          if (shouldCancel && (await shouldCancel())) {
            abortController.abort();
          }
        })();
      }, 15000);
    } else if (shouldCancel) {
      heartbeatTimer = setInterval(() => {
        void (async () => {
          if (await shouldCancel()) {
            abortController.abort();
          }
        })();
      }, 15000);
    }

    try {
      const data = response.data;
      await new Promise<void>((resolvePromise, rejectPromise) => {
        data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed);
              if (event.type === 'content') {
                content += String(event.content || '');
              } else if (event.type === 'sources' && Array.isArray(event.sources)) {
                sources.push(...event.sources.map((item: unknown) => String(item)));
              } else if (event.type === 'tool_call' && event.tool_call) {
                toolCalls.push(event.tool_call);
              } else if (event.type === 'provenance') {
                provenanceTrace = event.provenance_trace || event.provenanceTrace || null;
              } else if (event.type === 'error') {
                rejectPromise(new Error(String(event.message || event.error || 'Execution failed')));
                return;
              }
            } catch {
              continue;
            }
          }
        });

        data.on('end', () => resolvePromise());
        data.on('error', (error: Error) => {
          if (abortController.signal.aborted) {
            rejectPromise(new Error('Cancelled by operator'));
            return;
          }
          rejectPromise(error);
        });
      });

      return {
        content,
        sources,
        toolCalls,
        provenanceTrace,
      };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  }
}
