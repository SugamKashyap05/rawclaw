import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { DocsService } from './docs.service';
import { AgentsService } from './agents.service';
import { ModelsService } from './models.service';
import { ChatRequest, ChatMessage } from '@rawclaw/shared';
import { response, Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { DocumentProcessorService } from './document-processor.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    private readonly docsService: DocsService,
    private readonly agentsService: AgentsService,
    private readonly modelsService: ModelsService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly MAX_TOTAL_PROMPT_CHARS = 180000;
  private readonly MAX_ATTACHMENT_INLINE_CHARS = 50000;
  private readonly MAX_TOOL_RESULT_CHARS = 20000;

  async processAndStreamChat(request: ChatRequest, res: Response, options: { skipPromptPersistence?: boolean } = {}): Promise<void> {
    const agentUrl = this.configService.get<string>('agentUrl');
    const systemContext = await this.docsService.getSystemContext();
    const selectedAgent = await this.agentsService.getOptional(request.agent_id);

    // Resolve complexity to a specific model mapping if model ID is not provided
    if (!request.model && request.complexity) {
      const config = await (this.modelsService as any).getConfig();
      const resolvedModel = config.routing[request.complexity];
      if (resolvedModel) {
        request.model = resolvedModel;
        this.logger.log(`Resolved complexity '${request.complexity}' to model '${resolvedModel}'`);
      }
    }

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
        content: `You are now operating as the ${selectedAgent.name} agent.\n${selectedAgent.systemPrompt}`
      });
    }

    // Add edit request system prompt if present
    if (request.editRequest) {
      systemMessages.push({
        role: 'system',
        content: `You are an expert document editor. The user has requested to perform an edit action on a specific selection of text.
Action requested: ${request.editRequest.action}
${request.editRequest.instruction ? `Additional instructions: ${request.editRequest.instruction}\n` : ''}
Original text selection: "${request.editRequest.selectedText}"
Context before: "...${request.editRequest.contextBefore.slice(-200)}"
Context after: "${request.editRequest.contextAfter.slice(0, 200)}..."

Output ONLY your proposed replacement text wrapped in <edit_suggestion>...</edit_suggestion> tags. Do not include original text, conversational filler, or markdown fences outside the tags.`
      });
    }

    // Filter out ANY previous system messages from history or request to prevent injection overrides
    const cleanHistory = history.filter((m) => m.role !== 'system');
    const cleanRequestMessages = request.messages.filter((m) => m.role !== 'system');

    let allMessages: ChatMessage[] = [
      ...systemMessages,
      ...cleanHistory,
      ...cleanRequestMessages,
    ];

    // 1.5 Process Document Ingestion and Selection Context
    for (const msg of allMessages) {
      // Handle Selection Context Injection
      if (msg.selection) {
        // Limit context to ~200 chars as requested
        const selectionBlock = `\n\n[Context: User selected text from document]\nSelection: "${msg.selection.text}"\nContext Before: "...${msg.selection.contextBefore.slice(-200)}"\nContext After: "${msg.selection.contextAfter.slice(0, 200)}..."\n\nPlease focus your response on this specific selection.\n`;
        msg.content = msg.content + selectionBlock;
      }

      // Handle Document Extraction/Persistence
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          const isDoc = att.type === 'application/pdf' || att.type?.startsWith('image/');
          if (isDoc && !att.documentId) {
            try {
              const buffer = Buffer.from(att.content, 'base64');
              const result = await this.documentProcessor.extractText(buffer, att.type!);

              if (result.text) {
                // Successful extraction - persist document
                const doc = await this.prisma.document.create({
                  data: {
                    filename: att.filename,
                    mimeType: att.type!,
                    extractedText: result.text,
                    extractionMethod: result.method,
                  }
                });
                att.documentId = doc.id;
                // Important: Replace base64 content with extracted text for the prompt
                // and store it so budgeting uses the real text length.
                if (result.text && result.text.length > 0) {
                  att.extractedText = result.text;
                  att.content = result.text; // For prompt loop
                  this.logger.log(`Extracted ${result.text.length} chars from ${att.filename} using ${result.method}`);
                } else {
                  // Extraction failed - log but do NOT crash chat
                  att.extractionError = result.error || `Extraction failed: ${result.method}`;
                  att.extractionFailed = true;
                  this.logger.error(`Document extraction failed for ${att.filename}: ${att.extractionError}`);
                }
              } else {
                // Extraction failed - log but do NOT crash chat
                att.extractionError = result.error || `Extraction failed: ${result.method}`;
                att.extractionFailed = true;
                this.logger.warn(`Document extraction failed for ${att.filename}: ${att.extractionError}`);
              }
            } catch (e: any) {
              // Safety net: extraction failure must NEVER break chat
              att.extractionError = e?.message || 'Document ingestion threw';
              att.extractionFailed = true;
              this.logger.error(`Document ingestion threw for ${att.filename}: ${att.extractionError}`);
            }
          } else if (att.documentId && !att.content) {
            // Already ingested document, fetch text if content is missing (for older history messages)
            const doc = await this.prisma.document.findUnique({ where: { id: att.documentId } });
            if (doc) {
              att.content = doc.extractedText;
            }
          }
        }
      }
    }

    // 2. Save NEW user messages from request immediately (canonical, unbudgeted)
    if (!options.skipPromptPersistence) {
      for (const m of cleanRequestMessages) {
        if (m.role === 'user') {
          // Persistence: extractionError will be in the JSON stored in DB
          await this.chatService.createMessage(request.session_id, m.role, m.content, {
            attachments: m.attachments,
            agentId: request.agent_id,
          });
        }
      }
    }

    // 3. Apply budgeting heuristic for the PROMPT only
    allMessages = this.budgetContext(allMessages);

    // Finalize attachments for the prompt (inline them)
    request.messages = allMessages.map(m => {
      if (m.attachments && m.attachments.length > 0) {
        let attachmentText = '\n\n--- Attachments ---\n';
        for (const att of m.attachments) {
          // Use att.content which now contains extracted text for documents
          const isDoc = att.documentId || att.type === 'application/pdf' || att.type?.startsWith('image/');
          const contentToInline = isDoc ? (att.extractedText || att.content) : att.content;
          
          if (att.extractionFailed) {
            attachmentText += `\n[File: ${att.filename}] (Extraction Failed: ${att.extractionError})\n`;
          } else {
            attachmentText += `\n[File: ${att.filename}]${att.isTruncated ? ' (Truncated)' : ''}\n\`\`\`\n${contentToInline}\n\`\`\`\n`;
          }
        }
        return {
          ...m,
          content: m.content + attachmentText,
          attachments: undefined
        };
      }
      return m;
    });

    // 3. Request streaming from Agent with AbortController for cancellation
    const abortController = new AbortController();
    
    // Detect client disconnect and abort upstream
    res.on('close', () => {
      this.logger.log(`Client disconnected for session ${request.session_id}, aborting agent request.`);
      abortController.abort();
    });

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
            signal: abortController.signal,
          }),
        );
      } catch (err: any) {
        if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
          throw err;
        }
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
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        this.logger.log('Agent request aborted by client disconnect.');
        return;
      }
      
      const isConnectionError = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.status >= 500;
      const errorType = isConnectionError ? 'agent_unavailable' : 'agent_error';

      this.logger.error(`Agent connection failed (${err.code}):`, err.message);
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: errorType,
        message: isConnectionError 
          ? 'The RawClaw agent is currently unreachable. Please check if the agent service is running.'
          : `Agent error: ${err.message}`
      })}\n\n`);
      res.end();
      return;
    }

    let fullAssistantResponse = '';
    let toolCalls: any[] = [];
    let toolResults: any[] = [];
    let provenance: any = null;
    let lastMetadata: any = null;
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

        // Ensure we persist whatever we have
        const citations = sources.length > 0 ? sources.map(url => ({ url, title: url })) : undefined;
        
        try {
          // If we had an error but also some content, prioritize content but mark it
          let persistContent = fullAssistantResponse;
          // If no content but we have an error, keep content empty so UI only shows Error Card
          if (!persistContent && payload?.type !== 'error') {
            persistContent = 'Request failed';
          }

          await this.chatService.createMessage(
            request.session_id,
            'assistant',
            persistContent,
            {
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              toolResults: toolResults.length > 0 ? toolResults : undefined,
              provenance,
              citations,
              ...lastMetadata,
              agentId: request.agent_id,
              ...(payload?.type === 'error' ? { error: { type: payload.error as string, message: payload.message as string } } : {})
            }
          );
        } catch (dbErr) {
          this.logger.error('Failed to persist assistant response:', dbErr);
        }

        if (payload && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
        if (!res.writableEnded) {
          res.end();
        }
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
            provenance = data.provenance_trace || data.provenance || data;
          } else if (data.type === 'metadata') {
            lastMetadata = data.metadata;
          } else if (data.type === 'sources') {
            if (Array.isArray(data.sources)) {
              sources.push(...data.sources);
            }
          }

          if (data.type === 'done') {
            await finalize({ type: 'done' });
            return;
          }

          if (data.type === 'error') {
            await finalize(data);
            return;
          }

          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        } catch (e) {
          this.logger.error('SSE parse error:', e, trimmed);
        }
      };

      let processingPromise = Promise.resolve();

      agentStream.data.on('data', (chunk: Buffer) => {
        streamBuffer += chunk.toString('utf8');
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';

        // Chain the processing to ensure sequential order across data events
        processingPromise = processingPromise.then(async () => {
          for (const line of lines) {
            if (streamClosed) break;
            await processLine(line);
          }
        });
      });

      agentStream.data.on('error', (err: Error) => {
        // If it's a standard abort because of client disconnect, ignore
        if (err.message === 'aborted' || abortController.signal.aborted) return;
        
        this.logger.error(`Agent stream error: ${err.message}`);
        void finalize({ type: 'error', error: 'stream_interrupted', message: err.message });
      });

      agentStream.data.on('end', () => {
        processingPromise = processingPromise.then(async () => {
          if (streamBuffer.trim()) {
            await processLine(streamBuffer);
          }
          await finalize({ type: 'done' });
        });
      });
      
      // Handle AbortSignal from either res 'close' or eventual manual trigger
      abortController.signal.addEventListener('abort', () => {
        void finalize({ type: 'error', error: 'Aborted', message: 'The request was cancelled.' });
      });
    });

  }

  async editAndResend(
    sessionId: string, 
    messageId: string, 
    content: string, 
    res: Response, 
    options: { model?: string; complexity?: string; agentId?: string; temperature?: number; top_p?: number } = {}
  ): Promise<void> {
    // 1. Truncate history after this message (including any old assistant responses)
    await this.chatService.deleteMessagesAfter(sessionId, messageId, false);
    
    // 2. Update the user message content in database
    await (this.chatService as any).prisma.message.update({
      where: { id: messageId },
      data: { content }
    });

    // 3. Trigger new generation using skipPromptPersistence since we just updated it
    const request: ChatRequest = {
      session_id: sessionId,
      messages: [{ role: 'user' as const, content }], 
      model: options.model || 'default',
      complexity: options.complexity as any,
      agent_id: options.agentId,
      temperature: options.temperature,
      top_p: options.top_p
    };

    return this.processAndStreamChat(request, res, { skipPromptPersistence: true });
  }

  async regenerate(
    sessionId: string, 
    messageId: string, 
    res: Response,
    options: { model?: string; complexity?: string; agentId?: string; temperature?: number; top_p?: number } = {}
  ): Promise<void> {
    // 1. Truncate history starting from this assistant message (include target)
    await this.chatService.deleteMessagesAfter(sessionId, messageId, true);

    // 2. Re-trigger generation based on the message that remained last (the user prompt)
    const messages = await this.chatService.getMessages(sessionId);
    const lastUserMsg = messages[messages.length - 1];
    
    if (!lastUserMsg || lastUserMsg.role !== 'user') {
      if (!res.writableEnded) {
        res.status(400).json({ error: 'No user message found to regenerate from' });
      }
      return;
    }

    const request: ChatRequest = {
      session_id: sessionId,
      messages: [lastUserMsg],
      model: options.model || 'default',
      complexity: options.complexity as any,
      agent_id: options.agentId,
      temperature: options.temperature,
      top_p: options.top_p
    };

    return this.processAndStreamChat(request, res, { skipPromptPersistence: true });
  }

  private budgetContext(messages: ChatMessage[]): ChatMessage[] {
    // Stage 0: Deep copy to avoid mutating canonical objects (which might be used by UI or saved later)
    let budgetMessages = messages.map(m => ({
      ...m,
      attachments: m.attachments ? m.attachments.map(a => ({ ...a })) : undefined,
      toolResults: m.toolResults ? m.toolResults.map(tr => ({ ...tr })) : undefined,
    }));

    let totalChars = budgetMessages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0);
    
    // Add attachment and tool result length to total
    budgetMessages.forEach(m => {
      if (m.attachments) {
        m.attachments.forEach(a => totalChars += (a.content?.length || 0));
      }
      if (m.toolResults) {
        m.toolResults.forEach(tr => {
          if (typeof tr.output === 'string') totalChars += tr.output.length;
        });
      }
    });

    if (totalChars <= this.MAX_TOTAL_PROMPT_CHARS) {
      return budgetMessages;
    }

    this.logger.warn(`Prompt context (${totalChars} chars) exceeds budgeting heuristic (${this.MAX_TOTAL_PROMPT_CHARS}). Applying prioritized reduction.`);

    // 1. Drop Memory Recall messages first (priority 1 reduction)
    for (let i = 0; i < budgetMessages.length; i++) {
        if (budgetMessages[i].memoryRecall) {
            totalChars -= (budgetMessages[i].content?.length || 0);
            budgetMessages.splice(i, 1);
            i--;
            if (totalChars <= this.MAX_TOTAL_PROMPT_CHARS) return budgetMessages;
        }
    }

    // 2. Truncate Older History (priority 2 reduction)
    let historyIndices: number[] = [];
    budgetMessages.forEach((m, idx) => {
        if (m.role !== 'system' && idx < budgetMessages.length - 1) {
            historyIndices.push(idx);
        }
    });

    while (historyIndices.length > 0 && totalChars > this.MAX_TOTAL_PROMPT_CHARS) {
        const dropIdx = historyIndices.shift()!;
        const msg = budgetMessages[dropIdx];
        totalChars -= (msg.content?.length || 0);
        budgetMessages[dropIdx] = { ...msg, content: '[... History Truncated ...]' };
        totalChars += budgetMessages[dropIdx].content.length;
        if (totalChars <= this.MAX_TOTAL_PROMPT_CHARS) return budgetMessages;
    }

    // 3. Truncate Massive Tool Results (priority 3 reduction)
    budgetMessages.forEach(m => {
      if (m.toolResults && totalChars > this.MAX_TOTAL_PROMPT_CHARS) {
        for (const tr of m.toolResults) {
          if (typeof tr.output === 'string' && tr.output.length > this.MAX_TOOL_RESULT_CHARS) {
            const originalLen = tr.output.length;
            tr.output = tr.output.slice(0, this.MAX_TOOL_RESULT_CHARS) + '\n[... Tool Result Truncated for Prompt Budget ...]';
            totalChars -= (originalLen - (tr.output as string).length);
            if (totalChars <= this.MAX_TOTAL_PROMPT_CHARS) return;
          }
        }
      }
    });

    // 4. Truncate Attachments (priority 4 reduction)
    budgetMessages.forEach(m => {
        if (m.attachments && totalChars > this.MAX_TOTAL_PROMPT_CHARS) {
            for (const att of m.attachments) {
                if (att.content.length > this.MAX_ATTACHMENT_INLINE_CHARS) {
                    const originalLen = att.content.length;
                    att.content = att.content.slice(0, this.MAX_ATTACHMENT_INLINE_CHARS) + '\n[... File Truncated to stay within context limit ...]';
                    att.isTruncated = true;
                    totalChars -= (originalLen - att.content.length);
                    if (totalChars <= this.MAX_TOTAL_PROMPT_CHARS) return;
                }
            }
        }
    });

    return budgetMessages;
  }
}
