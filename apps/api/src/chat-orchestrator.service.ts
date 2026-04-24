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
import { ProvenanceSanitizer } from './common/provenance-sanitizer';
import { SettingsService } from './settings.service';
import { TasksService } from './tasks/tasks.service';

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
    private readonly settingsService: SettingsService,
    private readonly tasksService: TasksService,
  ) {}

  private readonly MAX_TOTAL_PROMPT_CHARS = 180000;
  private readonly MAX_ATTACHMENT_INLINE_CHARS = 50000;
  private readonly MAX_TOOL_RESULT_CHARS = 20000;

  private shouldEnableOutputReview(request: ChatRequest, latestUserContent: string): boolean {
    if (request.output_reviewer_id) {
      return true;
    }

    const query = (latestUserContent || '').toLowerCase();
    const reviewSignals = [
      'search the web',
      'search web',
      'latest',
      'current',
      'news',
      'open http',
      'https://',
      'http://',
      'summarize the page',
      'official page',
      'points table',
      'standings',
      'fetch a webpage',
    ];

    return reviewSignals.some((signal) => query.includes(signal));
  }

  private tryExtractQuotedName(text: string, entity: 'agent' | 'task'): string | null {
    const patterns = [
      new RegExp(`(?:create|make)\\s+(?:an?\\s+)?${entity}\\s+(?:called|named)\\s+['"]([^'"]+)['"]`, 'i'),
      new RegExp(`switch\\s+to\\s+(?:the\\s+)?${entity}\\s+['"]([^'"]+)['"]`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  }

  private buildAgentPrompt(name: string, requestText: string): string {
    const focusMatch = requestText.match(/focuses?\s+on\s+(.+?)(?:\.|$)/i);
    const focus = focusMatch?.[1]?.trim() || 'reliable, grounded task execution';
    return [
      `You are ${name}, a specialized RawClaw agent.`,
      `Primary focus: ${focus}.`,
      `Operating rules:`,
      `- Prefer tool-backed, grounded answers over unsupported memory.`,
      `- Be concise, accurate, and explicit about uncertainty.`,
      `- Use web or fetch tools when current information is required.`,
    ].join('\n');
  }

  private async fetchInstalledSkills(): Promise<Array<{ name: string; description: string; capabilityTags: string[] }>> {
    const agentUrl = this.configService.get<string>('agentUrl');
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ skills: Array<{ name: string; description: string; capabilityTags: string[] }> }>(`${agentUrl}/api/skills`),
      );
      return response.data.skills || [];
    } catch (error) {
      this.logger.warn(`Failed to fetch installed skills for agent inference: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private inferRelevantSkills(requestText: string, skills: Array<{ name: string; description: string; capabilityTags: string[] }>): string[] {
    const lower = requestText.toLowerCase();
    const chosen = new Set<string>();

    if (
      skills.some((skill) => skill.name === 'grounded-web-summary') &&
      ['web', 'search', 'fetch', 'latest', 'summar', 'ground', 'official page'].some((needle) => lower.includes(needle))
    ) {
      chosen.add('grounded-web-summary');
    }

    if (
      skills.some((skill) => skill.name === 'repo-explainer') &&
      ['repo', 'repository', 'codebase', 'workspace', 'module', 'file', 'implementation', 'walkthrough', 'structure'].some((needle) => lower.includes(needle))
    ) {
      chosen.add('repo-explainer');
    }

    const tokens = (lower.match(/[a-z0-9-]+/g) || []).filter((token) => token.length > 2);
    for (const skill of skills) {
      const haystack = `${skill.name} ${skill.description} ${(skill.capabilityTags || []).join(' ')}`.toLowerCase();
      const overlap = tokens.filter((token) => haystack.includes(token)).length;
      if (overlap >= 2) {
        chosen.add(skill.name);
      }
    }

    return [...chosen];
  }

  private tryExtractTaskDescription(text: string): { name: string; description: string; schedule?: string } | null {
    const namedMatch = text.match(/create\s+a\s+task\s+named\s+['"]([^'"]+)['"]\s+to\s+(.+?)(?:\.|$)/i);
    if (namedMatch?.[1] && namedMatch?.[2]) {
      const rawDescription = namedMatch[2].trim();
      const schedule = /\btomorrow\b/i.test(rawDescription) ? 'tomorrow' : undefined;
      const description = rawDescription.replace(/\btomorrow\b/i, '').replace(/\s+/g, ' ').trim().replace(/\s+$/, '');
      return {
        name: namedMatch[1].trim(),
        description: description || rawDescription,
        schedule,
      };
    }
    return null;
  }

  private async maybeResolveAgentFromPrompt(latestUserContent: string) {
    const requestedName = this.tryExtractQuotedName(latestUserContent, 'agent');
    if (!requestedName || !/switch\s+to/i.test(latestUserContent)) return null;
    const agents = await this.agentsService.list();
    return agents.find((agent) => agent.name === requestedName) || null;
  }

  private async handleDirectActionIfApplicable(request: ChatRequest, res: Response, latestUserContent: string): Promise<boolean> {
    const lower = (latestUserContent || '').toLowerCase();

    if (lower.startsWith('create a task')) {
      const parsed = this.tryExtractTaskDescription(latestUserContent);
      if (!parsed) {
        return false;
      }

      const task = await this.tasksService.createDefinition({
        name: parsed.name,
        description: parsed.description,
        schedule: parsed.schedule,
        workspaceId: 'default',
        toolIds: [],
      });

      await this.chatService.createMessage(request.session_id, 'assistant', `I created the task '${task.name}' to ${parsed.description}${parsed.schedule ? ` (${parsed.schedule})` : ''}.`, {
        agentId: request.agent_id,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'content', content: `I created the task '${task.name}' to ${parsed.description}${parsed.schedule ? ` (${parsed.schedule})` : ''}.` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return true;
    }

    if (lower.startsWith('create an agent') || lower.startsWith('create a agent') || lower.startsWith('create agent')) {
      const name = this.tryExtractQuotedName(latestUserContent, 'agent');
      if (!name) {
        return false;
      }

      const existingAgents = await this.agentsService.list();
      const existing = existingAgents.find((agent) => agent.name === name);
      const installedSkills = await this.fetchInstalledSkills();
      const inferredSkills = this.inferRelevantSkills(latestUserContent, installedSkills);
      const agent = existing || await this.agentsService.create({
        name,
        description: `Agent created from chat for ${name}`,
        systemPrompt: this.buildAgentPrompt(name, latestUserContent),
        isDefault: false,
        skills: inferredSkills,
      });

      const content = existing
        ? `The agent '${agent.name}' already exists and is available to use.`
        : `I created the agent '${agent.name}' and saved it to the agent registry${inferredSkills.length ? ` with skills: ${inferredSkills.join(', ')}` : ''}.`;

      await this.chatService.createMessage(request.session_id, 'assistant', content, {
        agentId: request.agent_id,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return true;
    }

    return false;
  }

  async processAndStreamChat(request: ChatRequest, res: Response, options: { skipPromptPersistence?: boolean } = {}): Promise<void> {
    const agentUrl = this.configService.get<string>('agentUrl');
    const systemContext = await this.docsService.getSystemContext();
    const latestUserContent = (request.messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    const promptedAgent = !request.agent_id ? await this.maybeResolveAgentFromPrompt(latestUserContent) : null;
    if (promptedAgent && !request.agent_id) {
      request.agent_id = promptedAgent.id;
      this.logger.log(`Resolved agent switch from prompt to '${promptedAgent.name}' (${promptedAgent.id})`);
    }
    const selectedAgent = promptedAgent || await this.agentsService.getOptional(request.agent_id);

    // Respect the selected agent's preferred model when the request itself
    // did not explicitly choose one. Without this, agent-bound modelIds are
    // silently ignored and the request falls back to default routing.
    if (!request.model && selectedAgent?.modelId) {
      request.model = selectedAgent.modelId;
      this.logger.log(`Resolved selected agent '${selectedAgent.name}' to model '${selectedAgent.modelId}'`);
    }

    // Resolve complexity to a specific model mapping ONLY if model ID is not provided
    // Explicit model selection takes precedence over complexity routing
    if (!request.model && request.complexity) {
      const config = await (this.modelsService as any).getConfig();
      const resolvedModel = config.routing[request.complexity];
      if (resolvedModel) {
        request.model = resolvedModel;
        this.logger.log(`Resolved complexity '${request.complexity}' to model '${resolvedModel}'`);
      }
    } else if (request.model) {
      this.logger.log(`Using explicitly selected model: '${request.model}'`);
    }

    // Resolve output reviewer from config only for prompts that benefit from truthfulness review.
    if (!request.output_reviewer_id && this.shouldEnableOutputReview(request, latestUserContent)) {
      const config = await this.modelsService.getConfig();
      if (config.routing.outputReviewer) {
        request.output_reviewer_id = config.routing.outputReviewer;
        this.logger.log(`Resolved output reviewer to '${request.output_reviewer_id}' from config`);
      }
    }

    // Validate model parameters
    if (request.temperature !== undefined) {
      request.temperature = Math.max(0, Math.min(1, request.temperature));
    }
    if (request.top_p !== undefined) {
      request.top_p = Math.max(0, Math.min(1, request.top_p));
    }

    // 1. Get history for context if needed
    const history = await this.chatService.getMessages(request.session_id);
    // Build message stack with proper system context
    const systemMessages: ChatMessage[] = [
      { role: 'system', content: systemContext }
    ];

    // Inject workspace context (SOUL, USER, MEMORY) from SettingsService
    const { workspaceFiles } = await this.settingsService.getPayload();
    if (workspaceFiles.soul || workspaceFiles.user) {
      let identityBlock = '\n\n### IDENTITY & SOUL\n';
      if (workspaceFiles.user) identityBlock += `User Context: ${workspaceFiles.user}\n`;
      if (workspaceFiles.soul) identityBlock += `Soul/Guidelines: ${workspaceFiles.soul}\n`;
      systemMessages.push({ role: 'system', content: identityBlock });
    }

    if (workspaceFiles.memory) {
      systemMessages.push({
        role: 'system',
        content: `\n\n### PERSISTENT MEMORY\n${workspaceFiles.memory}`
      });
    }

    if (workspaceFiles.tools) {
      systemMessages.push({
        role: 'system',
        content: `\n\n### TOOL GUIDELINES\n${workspaceFiles.tools}`
      });
    }

    // Fetch available tools from agent and pass them to the model
    let toolsSchema: any[] | undefined;
    let availableSkills: Array<{ name: string; description: string; capabilityTags: string[] }> = [];
    try {
      const toolsRes = await firstValueFrom(
        this.httpService.get(`${agentUrl}/api/tools`)
      );
      // Agent returns { tools: [...], count: N }
      const tools = toolsRes.data.tools || [];
      this.logger.log(`[TOOL_TRACE] Fetched ${tools.length} tools from agent: ${tools.map((t: any) => t.name || 'unnamed').join(', ')}`);
      // Convert ToolSchema[] to OpenAI function format
      toolsSchema = tools.map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }
      }));
      availableSkills = tools
        .filter((t: any) => typeof t.name === 'string' && t.name.startsWith('skill_'))
        .map((t: any) => ({
          name: String(t.name).replace(/^skill_/, ''),
          description: t.description || '',
          capabilityTags: Array.isArray(t.capability_tags) ? t.capability_tags : [],
        }));
      this.logger.log(`[TOOL_TRACE] Converted to OpenAI format, passing ${tools?.length || 0} tools to agent`);
    } catch (e: any) {
      this.logger.warn('[TOOL_TRACE] Could not fetch tools from agent:', e?.message || String(e));
      toolsSchema = undefined;
      availableSkills = [];
    }

    // Add tool-selection guidance when tools are available
    // This helps the model understand when to invoke tools vs answer directly
    const toolGuidance = this.buildToolGuidance(toolsSchema);
    if (toolGuidance) {
      systemMessages.push({
        role: 'system',
        content: toolGuidance
      });
    }

    const skillGuidance = this.buildSkillGuidance(availableSkills, selectedAgent);
    if (skillGuidance) {
      systemMessages.push({
        role: 'system',
        content: skillGuidance,
      });
    }

    // Add agent system prompt if selected
    if (selectedAgent) {
      systemMessages.push({
        role: 'system',
        content: `You are now operating as the ${selectedAgent.name} agent.\n${selectedAgent.systemPrompt}`
      });

      if (selectedAgent.skills?.length) {
        const installedSelectedSkills = selectedAgent.skills
          .map((skillName) => {
            const matched = availableSkills.find((skill) => skill.name === skillName);
            if (!matched) return null;
            const tags = matched.capabilityTags?.length ? ` [${matched.capabilityTags.join(', ')}]` : '';
            return `- skill_${matched.name}: ${matched.description}${tags}`;
          })
          .filter(Boolean);

        if (installedSelectedSkills.length) {
          systemMessages.push({
            role: 'system',
            content:
              `ACTIVE AGENT SKILLS\n` +
              `This agent has the following installed skills assigned. Prefer these skill tools when they are relevant before falling back to generic tool usage.\n` +
              `${installedSelectedSkills.join('\n')}`,
          });
        } else {
          systemMessages.push({
            role: 'system',
            content:
              `ACTIVE AGENT SKILLS\n` +
              `This agent was assigned skills (${selectedAgent.skills.join(', ')}), but those skills are not currently installed in the agent runtime. Do not invent them.`,
          });
        }
      }
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
    const safeHistory = (history || []);
    const cleanHistory = safeHistory.filter((m) => m.role !== 'system');
    
    const requestMessages = request.messages || [];
    const cleanRequestMessages = requestMessages.filter((m) => m.role !== 'system');

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

    if (await this.handleDirectActionIfApplicable(request, res, latestUserContent)) {
      return;
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

    // Include tools in the request to the agent
    const agentRequest = {
      ...request,
      tools: toolsSchema,
    };
    
    this.logger.log(`[AGENT_REQ] Forwarding prompt to agent at ${agentUrl}/execute (${allMessages.length} msgs, session=${request.session_id})`);
    this.logger.log(`[TOOL_TRACE] Sending request to agent with model=${agentRequest.model}, complexity=${agentRequest.complexity}, toolsCount=${toolsSchema?.length || 0}, explicitModelSelection=${!!request.model}`);

    const attemptRequest = async (): Promise<any> => {
      try {
        return await firstValueFrom(
          this.httpService.post(`${agentUrl}/execute`, agentRequest, {
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
    let provenanceTrace: any = null;
    let processedProvenance: any = null;
    let lastMetadata: any = null;
    const sources: string[] = [];

    let streamBuffer = '';
    let streamClosed = false;

    // Set headers for SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    return new Promise<void>((resolve) => {
      // Stream inactivity timeout: if the agent goes silent for this long,
      // force-close the stream so the frontend doesn't hang forever.
      const STREAM_INACTIVITY_TIMEOUT_MS = 150_000; // 150s (> executor's 120s deadline)
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

      const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          if (!streamClosed) {
            this.logger.error(`[STREAM_TIMEOUT] No data received for ${STREAM_INACTIVITY_TIMEOUT_MS / 1000}s. Force-closing stream.`);
            void finalize({
              type: 'error',
              error: 'stream_timeout',
              message: 'The agent stopped responding. Please try again.',
            });
          }
        }, STREAM_INACTIVITY_TIMEOUT_MS);
      };

      // Start the initial timer
      resetInactivityTimer();

      const finalize = async (payload?: Record<string, unknown>) => {
        if (streamClosed) {
          this.logger.debug(`[STREAM_FINAL] Finalize called but stream already closed.`);
          return;
        }
        this.logger.log(`[STREAM_FINAL] Finalizing stream for session ${request.session_id} (payload type: ${payload?.type || 'none'})`);
        streamClosed = true;

        // Clear inactivity timer
        if (inactivityTimer) {
          clearTimeout(inactivityTimer);
          inactivityTimer = null;
        }

        // Ensure we persist whatever we have
        const citations = sources.length > 0 ? sources.map(url => ({ url, title: url })) : undefined;
        
        try {
          // If we had an error but also some content, prioritize content but mark it
          let persistContent = fullAssistantResponse;
          // If no content but we have an error, keep content empty so UI only shows Error Card
          if (!persistContent && payload?.type !== 'error') {
            persistContent = 'Request failed';
          }

          // Finalize provenance if we have it
          if (provenanceTrace && !processedProvenance) {
            processedProvenance = ProvenanceSanitizer.processTrace(provenanceTrace);
          }

          await this.chatService.createMessage(
            request.session_id,
            'assistant',
            persistContent,
            {
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              toolResults: toolResults.length > 0 ? toolResults : undefined,
              provenance: processedProvenance || undefined,
              runIds: processedProvenance?.runIds || undefined,
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
        if (!trimmed) {
          this.logger.log(`[STREAM_LOG] Skipping empty line`);
          return;
        }

        this.logger.log(`[STREAM_LOG] Received raw line: ${trimmed.substring(0, 100)}${trimmed.length > 100 ? '...' : ''}`);

        try {
          // Attempt to parse the line as JSON. 
          // If it fails, it might be a log line or an incomplete chunk.
          let data: any;
          try {
            data = JSON.parse(trimmed);
          } catch (pe) {
            // If it's not valid JSON, it might be a log line from the agent
            this.logger.debug(`[STREAM_LOG] ${trimmed}`);
            return;
          }

          if (data.type === 'content') {
            fullAssistantResponse += data.content || '';
          } else if (data.type === 'tool_call') {
            this.logger.log(`[TOOL_TRACE] Received tool_call from agent: ${JSON.stringify(data.tool_call || data)}`);
            toolCalls.push(data.tool_call || data);
          } else if (data.type === 'tool_result') {
            this.logger.log(`[TOOL_TRACE] Received tool_result from agent: ${data.tool_result?.tool_name || 'unknown'}`);
            toolResults.push(data.tool_result || data);
          } else if (data.type === 'provenance') {
            const rawTrace = data.provenance_trace || data.provenance || data;
            // Process once and store
            provenanceTrace = rawTrace;
            processedProvenance = ProvenanceSanitizer.processTrace(rawTrace);
            // Replace with sanitized version for client
            data.provenanceTrace = processedProvenance;
            delete (data as any).provenance_trace;
            delete (data as any).provenance;
          } else if (data.type === 'metadata') {
            lastMetadata = data.metadata;
          } else if (data.type === 'sources') {
            if (Array.isArray(data.sources)) {
              sources.push(...data.sources);
            }
          } else if (data.type === 'harness') {
            this.logger.log(`[HARNESS] Tool prep: ${data.harness_log?.tool} (${data.harness_log?.step})`);
          } else if (data.type === 'approval_required') {
            this.logger.warn(`[ORCHESTRATOR] Approval required: ${data.reason}`);
          } else if (data.type === 'review_result') {
            this.logger.log(`[REVIEW] Output review result: ${data.review?.status}`);
          }

          // Real-time runId synchronization: if we found new runIds in provenance, inject into metadata
          if (processedProvenance?.runIds?.length && (data as any).metadata) {
            (data as any).metadata.runIds = Array.from(new Set([
              ...((data as any).metadata.runIds || []),
              ...processedProvenance.runIds
            ]));
          }

          if (data.type === 'done') {
            this.logger.log(`[TOOL_TRACE] Stream complete: toolCalls=${toolCalls.length}, toolResults=${toolResults.length}, contentLength=${fullAssistantResponse.length}`);
            await finalize({ type: 'done' });
            return;
          }

          if (data.type === 'error') {
            await finalize(data);
            return;
          }

          if (!res.writableEnded) {
            this.logger.log(`[STREAM_EVENT] Sending '${data.type}' event to client`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        } catch (e) {
          this.logger.error('SSE processing error:', e);
        }
      };

      let processingPromise = Promise.resolve();

      agentStream.data.on('data', (chunk: Buffer) => {
        // Reset inactivity timer on every data chunk
        resetInactivityTimer();

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
          if (tr.output && typeof tr.output === 'string' && tr.output.length > this.MAX_TOOL_RESULT_CHARS) {
            const originalLen = tr.output.length;
            tr.output = tr.output.slice(0, this.MAX_TOOL_RESULT_CHARS) + '\n[... Tool Result Truncated for Prompt Budget ...]';
            tr.is_truncated = true;
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

  /**
   * Build tool-selection guidance for the system prompt.
   * This helps the model understand when to invoke tools vs answer directly.
   * Returns null if no tools are configured.
   */
  private buildToolGuidance(toolsSchema?: any[]): string | null {
    if (!toolsSchema || toolsSchema.length === 0) {
      return null;
    }

    // Build tool descriptions from actual schemas
    const toolDescriptions = toolsSchema
      .filter(t => t?.function?.name)
      .map(t => {
        const name = t.function.name;
        const desc = t.function.description || '';
        return `- \`${name}\`: ${desc}`;
      })
      .join('\n');

    // Build parameter details for each tool
    const toolParameterDetails = toolsSchema
      .filter(t => t?.function?.name)
      .map(t => {
        const name = t.function.name;
        const params = t.function.parameters?.properties || {};
        const required = t.function.parameters?.required || [];
        const paramDesc = Object.entries(params)
          .map(([key, val]: [string, any]) => {
            const isRequired = required.includes(key) ? ' (required)' : '';
            return `    - ${key}: ${val.description || 'No description'}${isRequired}`;
          })
          .join('\n');
        return `\`${name}\` parameters:\n${paramDesc || '    (no parameters)'}`;
      })
      .join('\n\n');

    // Tool capability hints - guide the model on when to use tools
    const toolGuidance = `=== AVAILABLE TOOLS ===
You have access to the following tools that can fetch real-time data and perform actions:

${toolDescriptions}

${toolParameterDetails}

=== WHEN TO USE TOOLS (CRITICAL) ===
You MUST use a tool when the user explicitly asks for:
- "Search" / "look up" / "find" / "check" + any topic → Use \`web_search\`
- "Browse" / "open site" / "get page" / "summarize URL" / "visit" → Use \`web_fetch\`
- "What's the weather" / "current weather" → Use \`web_search\` or \`web_fetch\`
- "Latest news" / "recent updates" / "what happened" + time period → Use \`web_search\`
- Reading local files or documents → Use \`read_file\`
- Current date/time questions → Use \`datetime\`

=== WHEN NOT TO USE TOOLS ===
- General conversation, explanations, or reasoning tasks
- Historical facts or established knowledge (e.g., "Who was the first president?")
- Coding help, math problems, or creative writing

=== TOOL CALLING FORMAT ===
When you need to use a tool, you MUST output ONLY a tool call in one of these formats:

Format 1 (Native tool_call):
{"name": "web_search", "arguments": {"query": "your search query"}}

Format 2 (XML-style):
<tool_code>{ tool => "web_search", args => "{ 'query' => 'your search query' }" }</tool_code>

DO NOT provide explanatory text before or after a tool call. Output ONLY the tool call, then wait for the result.

=== IMPORTANT RULES ===
- If a tool is available for the task, use it instead of making up an answer
- If no tools are available for web/network tasks, truthfully state "I don't have access to browse the web"
- Never claim to have performed an action if the tool was not actually invoked`;

    return toolGuidance;
  }

  private buildSkillGuidance(
    availableSkills: Array<{ name: string; description: string; capabilityTags: string[] }>,
    selectedAgent?: { skills?: string[]; name?: string } | null,
  ): string | null {
    if (!availableSkills.length) {
      return null;
    }

    const skillLines = availableSkills
      .map((skill) => {
        const tags = skill.capabilityTags?.length ? ` [${skill.capabilityTags.join(', ')}]` : '';
        return `- \`skill_${skill.name}\`: ${skill.description}${tags}`;
      })
      .join('\n');

    const assigned = selectedAgent?.skills?.length
      ? `Assigned to current agent: ${selectedAgent.skills.map((skill) => `skill_${skill}`).join(', ')}.\n`
      : '';

    return (
      `=== INSTALLED SKILLS ===\n` +
      `Treat installed skills as best-practice playbooks. Before answering, check whether one of these skills directly matches the user request.\n` +
      `If a skill is relevant, invoke the corresponding \`skill_<name>\` tool before falling back to generic reasoning.\n` +
      `${assigned}` +
      `${skillLines}\n\n` +
      `Use skill tools especially for repository walkthroughs, grounded web summaries, structured debugging, planning, and any workflow that clearly matches an installed skill.`
    );
  }
}
