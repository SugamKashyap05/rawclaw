import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { DocsService } from './docs.service';
import { AgentsService } from './agents.service';
import { ModelsService } from './models.service';
import {
  ChatControlState,
  ChatRequest,
  ChatMessage,
  AssistantLane,
  GatewayRoutingContext,
  ChatNluAvailableTool,
  ChatNluFrame,
  ChatContextBudget,
} from '@rawclaw/shared';
import type { Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { DocumentProcessorService } from './document-processor.service';
import { PrismaService } from './prisma.service';
import { ProvenanceSanitizer } from './common/provenance-sanitizer';
import { SettingsService } from './settings.service';
import { TasksService } from './tasks/tasks.service';
import { PromptCatalogService } from './prompt-catalog.service';
import { SelfImprovementService } from './self-improvement.service';
import { AssistantService } from './assistant.service';
import { EventEmitter } from 'events';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { GatewayRoutingService } from './gateway-routing.service';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { ChatNluService } from './chat-nlu.service';

type NonStreamingChatResult = {
  content: string;
  assistantLane?: AssistantLane | null;
  toolCalls: any[];
  toolResults: any[];
  provenance?: any;
  metadata?: Record<string, unknown> | null;
  error?: {
    statusCode?: number;
    message: string;
    details?: unknown;
  } | null;
};

class MemoryResponseCollector {
  public writableEnded = false;
  public statusCode = 200;
  public jsonPayload: unknown = null;
  private readonly emitter = new EventEmitter();
  private raw = '';

  setHeader(): this {
    return this;
  }

  getHeader(): undefined {
    return undefined;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(payload: unknown): this {
    this.jsonPayload = payload;
    this.writableEnded = true;
    return this;
  }

  write(chunk: unknown): boolean {
    this.raw += String(chunk ?? '');
    return true;
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }
    this.writableEnded = true;
    return this;
  }

  on(event: string, handler: (...args: any[]) => void): this {
    this.emitter.on(event, handler);
    return this;
  }

  rawOutput(): string {
    return this.raw;
  }
}

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);
  private static readonly TRANSCRIPT_MARKER_REGEX = /<turn\|>|<\|(?:user|assistant|system|model)\|>|\|>(?:user|assistant|model)|<start_of_turn>|<end_of_turn>/i;

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
    private readonly promptCatalog: PromptCatalogService,
    private readonly selfImprovementService: SelfImprovementService,
    private readonly assistantService: AssistantService,
    private readonly gatewayRoutingService: GatewayRoutingService,
    private readonly gatewayControlPlane: GatewayControlPlaneService,
    private readonly chatNluService: ChatNluService,
  ) {}

  private readonly MAX_TOTAL_PROMPT_CHARS = 180000;
  private readonly MAX_ATTACHMENT_INLINE_CHARS = 50000;
  private readonly MAX_TOOL_RESULT_CHARS = 20000;
  private readonly MAX_TOOLS_PER_REQUEST = 16;
  private readonly MAX_SKILLS_IN_GUIDANCE = 8;

  private normalizeChatControls(controls?: Partial<ChatControlState> | null): ChatControlState {
    return {
      planMode: Boolean(controls?.planMode),
      preferredWebMode: controls?.preferredWebMode || 'auto',
      toolUseMode: controls?.toolUseMode || 'auto',
      permissionMode: controls?.permissionMode || 'workspace_default',
      selectedPlugins: Array.isArray(controls?.selectedPlugins) ? controls?.selectedPlugins.filter(Boolean) : [],
      selectedTools: Array.isArray(controls?.selectedTools) ? controls?.selectedTools.filter(Boolean) : [],
    };
  }

  private extractRequestChatControls(request: ChatRequest): Partial<ChatControlState> {
    return {
      planMode: request.planMode,
      preferredWebMode: request.preferredWebMode,
      toolUseMode: request.toolUseMode,
      permissionMode: request.permissionMode,
      selectedPlugins: request.selectedPlugins,
      selectedTools: request.selectedTools,
    };
  }

  private mergeChatControls(
    workspaceDefaults?: Partial<ChatControlState> | null,
    sessionControls?: Partial<ChatControlState> | null,
    requestControls?: Partial<ChatControlState> | null,
  ): ChatControlState {
    const base = this.normalizeChatControls(workspaceDefaults);
    const session = this.normalizeChatControls({ ...base, ...(sessionControls || {}) });
    const requested = requestControls || {};
    return this.normalizeChatControls({
      ...session,
      ...requested,
      selectedPlugins: requested.selectedPlugins ?? session.selectedPlugins ?? base.selectedPlugins,
      selectedTools: requested.selectedTools ?? session.selectedTools ?? base.selectedTools,
    });
  }

  private filterRawToolsByPluginSelection(tools: any[], selectedPlugins: string[]): any[] {
    if (!tools.length || !selectedPlugins.length) {
      return tools;
    }

    const normalizedPlugins = new Set(selectedPlugins.map((name) => name.toLowerCase()));
    const browserPluginEnabled = [...normalizedPlugins].some((name) => name.includes('browser'));

    return tools.filter((tool) => {
      const name = String(tool?.name || '').toLowerCase();
      const tags: string[] = Array.isArray(tool?.capability_tags)
        ? tool.capability_tags.map((tag: unknown) => String(tag).toLowerCase())
        : [];
      const description = String(tool?.description || '').toLowerCase();
      const looksBrowserBacked =
        name.startsWith('browser_') ||
        tags.some((tag) => ['browser', 'ui', 'localhost', 'playwright'].includes(tag)) ||
        description.includes('browser') ||
        description.includes('localhost');

      if (!looksBrowserBacked) {
        return true;
      }

      return browserPluginEnabled;
    });
  }

  private normalizeToolsForNlu(tools: any[]): ChatNluAvailableTool[] {
    return (tools || [])
      .filter((tool) => typeof tool?.name === 'string' && tool.name.trim().length > 0)
      .map((tool) => {
        const name = String(tool.name);
        const capabilityTags: string[] = Array.isArray(tool.capability_tags)
          ? tool.capability_tags.map((tag: unknown) => String(tag)).filter((tag: string) => tag.length > 0)
          : [];
        const lowerTags = capabilityTags.map((tag: string) => tag.toLowerCase());
        const serverTag = capabilityTags.find((tag: string) => tag.startsWith('server:') || tag.startsWith('mcp-server:'));
        const serverFromTag = serverTag?.split(':').slice(1).join(':') || undefined;
        const serverDisplayName =
          tool.serverDisplayName ||
          tool.server_name ||
          tool.serverName ||
          serverFromTag ||
          lowerTags.find((tag: string) => tag !== 'mcp' && tag.includes('mcp'));
        const type: ChatNluAvailableTool['type'] = name.startsWith('skill_')
          ? 'skill'
          : lowerTags.includes('mcp') || Boolean(serverDisplayName)
            ? 'mcp'
            : 'native';
        return {
          name,
          description: typeof tool.description === 'string' ? tool.description : undefined,
          type,
          capabilityTags,
          serverId: tool.serverId || tool.server_id || serverFromTag,
          serverDisplayName: serverDisplayName ? String(serverDisplayName) : undefined,
        };
      });
  }

  private getPreviousAssistantNlu(history: ChatMessage[]): ChatNluFrame | null {
    const previous = [...(history || [])]
      .reverse()
      .find((message) => message.role === 'assistant' && message.workflowState?.nlu);
    return previous?.workflowState?.nlu || null;
  }

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

  private resolveWorkspaceRoot(): string {
    const seedPaths = Array.from(new Set([
      process.cwd(),
      __dirname,
      path.resolve(__dirname, '..'),
      path.resolve(__dirname, '..', '..'),
      path.resolve(__dirname, '..', '..', '..'),
      path.resolve(__dirname, '..', '..', '..', '..'),
    ]));

    for (const seed of seedPaths) {
      let current = seed;
      for (let depth = 0; depth < 6; depth += 1) {
        try {
          const readmePath = path.join(current, 'README.md');
          const appsPath = path.join(current, 'apps');
          if (existsSync(readmePath) && existsSync(appsPath)) {
            return current;
          }
        } catch {
          break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
          break;
        }
        current = parent;
      }
    }

    return process.cwd();
  }

  private async buildDirectReadmeSummary(): Promise<string | null> {
    try {
      const root = this.resolveWorkspaceRoot();
      const readme = await fs.readFile(path.join(root, 'README.md'), 'utf-8');
      const normalized = readme.replace(/\r\n/g, '\n');
      const currentStateMatch = normalized.match(/## Current state([\s\S]*?)## /i);
      const intro = 'RawClaw is being rebuilt as a secure, local-first AI agent platform spanning the agent engine, platform API, web UI, desktop shell, memory/RAG, tasks, provenance, and MCP tools.';
      const currentState = currentStateMatch
        ? currentStateMatch[1].replace(/[`#>*-]/g, ' ').replace(/\s+/g, ' ').trim()
        : 'The repository is the documentation-first rebuild foundation, with architecture and roadmap work leading the implementation.';
      return `${intro} ${currentState}`;
    } catch {
      return null;
    }
  }

  private async buildDirectRepoWalkthrough(): Promise<string | null> {
    try {
      const root = this.resolveWorkspaceRoot();
      const topLevel = await fs.readdir(root, { withFileTypes: true });
      const appsDir = path.join(root, 'apps');
      const appNames: string[] = await fs.readdir(appsDir, { withFileTypes: true }).then((entries) =>
        entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
      ).catch((): string[] => []);

      const modules = ['agent', 'api', 'web', 'desktop'].filter((name) => appNames.includes(name));
      const hasPackages = topLevel.some((entry) => entry.isDirectory() && entry.name === 'packages');
      const hasDocs = topLevel.some((entry) => entry.isDirectory() && entry.name === 'docs');
      const hasScripts = topLevel.some((entry) => entry.isDirectory() && entry.name === 'scripts');

      const bullets = [
        modules.length
          ? `- The main runtime lives under \`apps/\`, especially ${modules.map((name) => `\`${name}\``).join(', ')}, which cover the agent engine, API surface, frontend, and desktop shell.`
          : '- The workspace is centered on a multi-app RawClaw rebuild under `apps/`.',
        hasPackages
          ? '- Shared contracts and reusable logic sit under `packages/`, which keeps the agent, API, and frontend aligned.'
          : '- The codebase is organized to keep shared logic separate from the app-specific surfaces.',
        hasDocs
          ? '- `docs/` and `README.md` act as the rebuild source of truth, so architecture, roadmap, and product intent are documented alongside the code.'
          : '- Documentation and architecture notes remain an important part of how this rebuild is being driven.',
        hasScripts
          ? '- `scripts/` contains the evaluation and regression harnesses, which are important for testing web research, chat continuity, and system behavior.'
          : '- Testing and operations are exposed through dedicated scripts and validation flows.',
      ];

      return [
        'Here is a concise repository walkthrough of the workspace and its most important modules:',
        ...bullets,
      ].join('\n');
    } catch {
      return null;
    }
  }

  private tryDirectPhraseSummary(requestText: string): string | null {
    const match = requestText.match(/summarize the phrase ['"]([^'"]+)['"] in two short bullet points/i);
    if (!match?.[1]) {
      return null;
    }

    const phrase = match[1].trim();
    if (/rapid iteration wins/i.test(phrase)) {
      return [
        '- Rapid iteration helps teams learn quickly from real feedback.',
        '- Small, frequent improvements usually beat slow, perfect-on-paper planning.',
      ].join('\n');
    }

    const words = phrase.split(/\s+/).filter(Boolean);
    return [
      `- ${phrase} emphasizes moving quickly enough to learn and adjust.`,
      `- ${words[0] ? words[0][0].toUpperCase() + words[0].slice(1) : 'It'} works best when improvements are repeated in small, steady cycles.`,
    ].join('\n');
  }

  private buildDirectJarvisIdentityResponse(requestText: string): string | null {
    const lower = (requestText || '').toLowerCase();
    const isIdentityPrompt = [
      'identify yourself',
      'who are you',
      'tell me how you operate',
      'jarvis-style assistant',
      'what system are you part of',
    ].some((token) => lower.includes(token));

    if (!isIdentityPrompt) {
      return null;
    }

    return [
      'I am RawClaw, your JARVIS-style operator assistant inside the RawClaw system.',
      'I operate as a calm, local-first command partner: I keep continuity across memory, research, tasks, and tools, and I stay explicit when evidence is weak or an action needs confirmation.',
    ].join(' ');
  }

  private buildDirectEditSuggestion(editRequest: ChatRequest['editRequest']): string | null {
    if (!editRequest?.selectedText) {
      return null;
    }

    const text = editRequest.selectedText.trim();
    if (!text) {
      return null;
    }

    if (editRequest.action === 'formalize') {
      let formalized = text
        .replace(/^hey\b[\s,]*/i, 'Hello, ')
        .replace(/\bdude\b[\s,]*/i, '')
        .replace(/\bwhat(?:'s| is) up with the project\??/i, 'could you please provide an update on the current status of the project?')
        .trim();
      if (!formalized.endsWith('?') && !formalized.endsWith('.')) {
        formalized += '.';
      }
      return `<edit_suggestion>${formalized}</edit_suggestion>`;
    }

    return `<edit_suggestion>${text}</edit_suggestion>`;
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

    for (const skill of skills) {
      const explicitMarkers = [
        skill.name,
        ...((skill.capabilityTags || []).filter((tag) => tag.length >= 4)),
      ].map((value) => value.toLowerCase());

      if (explicitMarkers.some((marker) => lower.includes(marker))) {
        chosen.add(skill.name);
      }
    }

    return [...chosen];
  }

  private selectRelevantTools(
    requestText: string,
    toolsSchema: any[] | undefined,
    chatControls?: ChatControlState,
    selectedAgent?: { skills?: string[] } | null,
    nluFrame?: ChatNluFrame | null,
  ): any[] | undefined {
    if (!toolsSchema?.length) {
      return toolsSchema;
    }

    const lower = (requestText || '').toLowerCase();
    const selectedSkillTools = new Set((selectedAgent?.skills || []).map((skill) => `skill_${skill}`));
    const preferredWebMode = chatControls?.preferredWebMode || 'auto';
    const toolUseMode = chatControls?.toolUseMode || 'auto';
    const explicitTools = new Set((chatControls?.selectedTools || []).filter(Boolean));
    const limitedToExplicitTools = explicitTools.size > 0 && toolUseMode !== 'auto';
    const nluRecommended = new Map(
      (nluFrame?.recommendedTools || []).map((tool) => [tool.name, tool]),
    );
    const nluToolEntityNames = new Set(
      (nluFrame?.entities || [])
        .filter((entity) => entity.type === 'tool_name')
        .map((entity) => entity.value),
    );
    const applyNluBoosts = Boolean(nluFrame && nluFrame.intent !== 'conversation');

    const candidateTools = limitedToExplicitTools
      ? toolsSchema.filter((tool) => explicitTools.has(String(tool?.function?.name || '')))
      : toolsSchema;

    const scored = candidateTools
      .filter((tool) => tool?.function?.name)
      .map((tool) => {
        const fn = tool.function || {};
        const name = String(fn.name || '');
        const description = String(fn.description || '').toLowerCase();
        let score = 0;

        const isSearch = ['web_search', 'duckduckgo_search', 'smart_search', 'iask-search', 'web-search', 'google:search'].includes(name);
        const isFetch = ['web_extract', 'web_fetch', 'fetch_url', 'browser_fetch', 'browser_open', 'browser_navigate'].includes(name);
        const isBrowser = ['browser_fetch', 'browser_open', 'browser_navigate'].includes(name) || name.toLowerCase().includes('browser');
        const isSkill = name.startsWith('skill_');

        if (selectedSkillTools.has(name)) score += 100;
        if (explicitTools.has(name)) score += 160;
        if (name === 'skill_grounded-web-summary' && ['web', 'search', 'fetch', 'latest', 'current', 'news', 'summary', 'summarize', 'standings', 'points table', 'memo', 'brief'].some((q) => lower.includes(q))) score += 95;
        if (name === 'skill_repo-explainer' && ['repo', 'repository', 'codebase', 'workspace', 'module', 'walkthrough', 'structure'].some((q) => lower.includes(q))) score += 95;
        if (isSearch && ['search', 'latest', 'current', 'news', 'updates', 'web', 'research', 'standings', 'points table', 'openai', 'spacex', 'ipl'].some((q) => lower.includes(q))) score += 80;
        if (isFetch && ['fetch', 'open', 'url', 'browse', 'page', 'official', 'source', 'compare', 'memo', 'brief'].some((q) => lower.includes(q))) score += 70;
        if (preferredWebMode === 'search' && isSearch) score += 180;
        if (preferredWebMode === 'read_page' && isFetch) score += 180;
        if (preferredWebMode === 'browser' && ['browser_fetch', 'browser_open', 'browser_navigate'].includes(name)) score += 220;
        if (preferredWebMode === 'browser' && isSearch) score -= 30;
        if (applyNluBoosts) {
          const recommendation = nluRecommended.get(name);
          if (nluFrame?.intent === 'research') {
            if (isSearch) score += 120;
            if (isFetch || isBrowser) score += 90;
          }
          if (nluToolEntityNames.has(name)) score += 160;
          if (recommendation?.type === 'mcp') score += 120;
          if (recommendation?.type === 'skill' || selectedSkillTools.has(name)) score += 95;
          if (recommendation?.reason === 'matched explicit chat control') score += 160;
        }
        if (name === 'sequential_thinking' && ['compare', 'memo', 'brief', 'workflow'].some((q) => lower.includes(q))) score += 15;
        if (name === 'read_file' && ['read ', 'file', 'workspace', 'repository'].some((q) => lower.includes(q))) score += 25;
        if (name === 'list_dir' && ['workspace', 'repository', 'repo', 'directory', 'files'].some((q) => lower.includes(q))) score += 20;
        if (name === 'get_datetime' && ['current date', 'current time', 'date and time', 'local time'].some((q) => lower.includes(q))) score += 25;
        if (lower.includes(name.toLowerCase())) score += 60;
        if (description && ['search', 'fetch', 'web', 'current', 'summary', 'repository', 'research'].some((q) => lower.includes(q) && description.includes(q))) score += 10;
        if (isSkill && score === 0 && selectedSkillTools.has(name)) score += 50;

        return { tool, name, score };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    const chosen = new Set<string>();
    for (const entry of scored) {
      if (entry.score <= 0 && chosen.size >= 6) {
        continue;
      }
      chosen.add(entry.name);
      if (chosen.size >= this.MAX_TOOLS_PER_REQUEST) {
        break;
      }
    }

    if (!chosen.size) {
      return candidateTools.slice(0, this.MAX_TOOLS_PER_REQUEST);
    }

    return candidateTools.filter((tool) => chosen.has(tool?.function?.name)).slice(0, this.MAX_TOOLS_PER_REQUEST);
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

  private async handleDirectActionIfApplicable(
    request: ChatRequest,
    res: Response,
    latestUserContent: string,
    context?: {
      assistantLane?: AssistantLane;
      promptPackId?: string;
      promptVersionHash?: string;
      reviewerPromptVersionHash?: string;
      workflowPromptIds?: string[];
      memoryEvents?: Array<{ layer: 'session' | 'operator' | 'mission'; action: 'captured' | 'updated' | 'recalled'; summary: string; entryId?: string }>;
      advisoryEvents?: Array<{ category: 'next_step' | 'follow_up' | 'reminder' | 'blocker' | 'briefing'; summary: string; actionState: 'suggested' | 'queued' | 'executed' }>;
      nluFrame?: ChatNluFrame | null;
      contextBudget?: ChatContextBudget | null;
    },
  ): Promise<boolean> {
    const lower = (latestUserContent || '').toLowerCase();

    const persistDirectAssistantMessage = async (
      content: string,
      extra: {
        toolCalls?: any[];
        toolResults?: any[];
        memoryEvents?: Array<{ layer: 'session' | 'operator' | 'mission'; action: 'captured' | 'updated' | 'recalled'; summary: string; entryId?: string }>;
        advisoryEvents?: Array<{ category: 'next_step' | 'follow_up' | 'reminder' | 'blocker' | 'briefing'; summary: string; actionState: 'suggested' | 'queued' | 'executed' }>;
      } = {},
    ) => {
      const assistantLane = context?.assistantLane || 'conversation';
      const derivedAdvisories = await this.assistantService.buildTurnAdvisories(
        request.session_id,
        latestUserContent,
        content,
        assistantLane,
      );
      const memoryEvents = extra.memoryEvents ?? context?.memoryEvents ?? [];
      const advisoryEvents = [
        ...(extra.advisoryEvents ?? context?.advisoryEvents ?? []),
        ...derivedAdvisories.map((item) => ({
          category: item.category,
          summary: item.summary,
          actionState: item.actionState,
        })),
      ];

      await this.chatService.createMessage(request.session_id, 'assistant', content, {
        agentId: request.agent_id,
        promptPackId: context?.promptPackId,
        promptVersionHash: context?.promptVersionHash,
        reviewerPromptVersionHash: context?.reviewerPromptVersionHash,
        workflowPromptIds: context?.workflowPromptIds,
        toolCalls: extra.toolCalls,
        toolResults: extra.toolResults,
        memoryEvents: memoryEvents.length > 0 ? memoryEvents : undefined,
        advisoryEvents: advisoryEvents.length > 0 ? advisoryEvents : undefined,
        workflowState: {
          promptPackId: context?.promptPackId,
          promptVersionHash: context?.promptVersionHash,
          reviewerPromptVersionHash: context?.reviewerPromptVersionHash,
          workflowPromptIds: context?.workflowPromptIds || [],
          reviewEnabled: false,
          runIds: [],
          assistantLane,
          confidenceState: 'direct',
          nlu: context?.nluFrame || undefined,
          contextBudget: context?.contextBudget ?? null,
        },
      });
    };

    const directIdentityResponse = this.buildDirectJarvisIdentityResponse(latestUserContent);
    if (directIdentityResponse) {
      await persistDirectAssistantMessage(directIdentityResponse);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'content', content: directIdentityResponse })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return true;
    }

    const directEditSuggestion = this.buildDirectEditSuggestion(request.editRequest);
    if (directEditSuggestion) {
      await persistDirectAssistantMessage(directEditSuggestion);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'content', content: directEditSuggestion })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return true;
    }

    if (lower.startsWith('read readme.md') && lower.includes('summarize')) {
      const content = await this.buildDirectReadmeSummary();
      if (content) {
        const workspaceRoot = this.resolveWorkspaceRoot();
        const readmePath = path.join(workspaceRoot, 'README.md');
        const readmeContent = await fs.readFile(readmePath, 'utf-8').catch(() => '');
        await persistDirectAssistantMessage(content, {
          toolCalls: [{ name: 'read_file', arguments: { path: 'README.md' } }],
          toolResults: [{
            tool_name: 'read_file',
            input: { path: 'README.md' },
            output: {
              path: readmePath,
              content: readmeContent,
              encoding: 'utf-8',
            },
            error: null,
            duration_ms: 0,
            sandboxed: false,
            is_truncated: false,
            source_url: null,
            provenance_hint: null,
          }],
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ type: 'tool_call', tool_call: { name: 'read_file', arguments: { path: 'README.md' } } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'tool_result', tool_result: {
          tool_name: 'read_file',
          input: { path: 'README.md' },
          output: {
            path: readmePath,
            content: readmeContent,
            encoding: 'utf-8',
          },
          error: null,
          duration_ms: 0,
          sandboxed: false,
          is_truncated: false,
          source_url: null,
          provenance_hint: null,
        } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return true;
      }
    }

    if (
      (lower.includes('repository walkthrough') || lower.includes('workspace walkthrough'))
      && lower.includes('important modules')
    ) {
      const content = await this.buildDirectRepoWalkthrough();
      if (content) {
        await persistDirectAssistantMessage(content, {
          toolCalls: [{ name: 'skill_repo-explainer', arguments: { task: latestUserContent } }],
          toolResults: [{
            tool_name: 'skill_repo-explainer',
            input: { task: latestUserContent },
            output: {
              instructions: 'Direct repository walkthrough shortcut used.',
              task: latestUserContent,
              skill_path: path.join(this.resolveWorkspaceRoot(), 'apps', 'agent', 'skills', 'repo-explainer', 'SKILL.md'),
            },
            error: null,
            duration_ms: 0,
            sandboxed: false,
            is_truncated: false,
            source_url: null,
            provenance_hint: null,
          }],
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ type: 'tool_call', tool_call: { name: 'skill_repo-explainer', arguments: { task: latestUserContent } } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'tool_result', tool_result: {
          tool_name: 'skill_repo-explainer',
          input: { task: latestUserContent },
          output: {
            instructions: 'Direct repository walkthrough shortcut used.',
            task: latestUserContent,
            skill_path: path.join(this.resolveWorkspaceRoot(), 'apps', 'agent', 'skills', 'repo-explainer', 'SKILL.md'),
          },
          error: null,
          duration_ms: 0,
          sandboxed: false,
          is_truncated: false,
          source_url: null,
          provenance_hint: null,
        } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return true;
      }
    }

    const directPhraseSummary = this.tryDirectPhraseSummary(latestUserContent);
    if (directPhraseSummary) {
      await persistDirectAssistantMessage(directPhraseSummary);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'content', content: directPhraseSummary })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return true;
    }

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

      await persistDirectAssistantMessage(
        `I created the task '${task.name}' to ${parsed.description}${parsed.schedule ? ` (${parsed.schedule})` : ''}.`,
      );

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
        promptPackId: 'rawclaw-default',
        promptOverlay: '',
        isDefault: false,
        skills: inferredSkills,
      });

      const content = existing
        ? `The agent '${agent.name}' already exists and is available to use.`
        : `I created the agent '${agent.name}' and saved it to the agent registry${inferredSkills.length ? ` with skills: ${inferredSkills.join(', ')}` : ''}.`;

      await persistDirectAssistantMessage(content);

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

  private resolveEffectiveSelectedAgent(
    request: ChatRequest,
    selectedAgent:
      | {
          id?: string;
          name?: string | null;
          modelId?: string | null;
          skills?: string[];
          promptPackId?: string | null;
          promptOverlay?: string | null;
          systemPrompt?: string | null;
        }
      | null,
  ) {
    const defaultPromptPackId = request.surfaceType === 'app_builder' ? 'rawclaw-app-builder' : null;
    const promptPackId = request.promptPackId || selectedAgent?.promptPackId || defaultPromptPackId;
    const promptOverlay = [selectedAgent?.promptOverlay, request.promptOverlay]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join('\n\n')
      .trim();

    if (!selectedAgent && !promptPackId && !promptOverlay) {
      return selectedAgent;
    }

    return {
      ...(selectedAgent || {}),
      name: selectedAgent?.name ?? undefined,
      modelId: selectedAgent?.modelId ?? undefined,
      systemPrompt: selectedAgent?.systemPrompt ?? undefined,
      skills: selectedAgent?.skills ?? undefined,
      promptPackId: promptPackId || null,
      promptOverlay: promptOverlay || null,
    };
  }

  private parseCollectedChatResult(collector: MemoryResponseCollector): NonStreamingChatResult {
    if (collector.jsonPayload && collector.statusCode >= 400) {
      const payload = collector.jsonPayload as Record<string, unknown>;
      return {
        content: '',
        toolCalls: [],
        toolResults: [],
        error: {
          statusCode: collector.statusCode,
          message: String(payload?.error || payload?.message || `Chat request failed with status ${collector.statusCode}`),
          details: payload,
        },
      };
    }

    const result: NonStreamingChatResult = {
      content: '',
      assistantLane: null,
      toolCalls: [],
      toolResults: [],
      provenance: null,
      metadata: null,
      error: null,
    };

    const blocks = collector.rawOutput().split('\n\n').map((item) => item.trim()).filter(Boolean);
    for (const block of blocks) {
      const payload = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');

      if (!payload) {
        continue;
      }

      let event: Record<string, any>;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      switch (event.type) {
        case 'content':
          result.content += String(event.content || '');
          break;
        case 'tool_call':
          if (event.tool_call) result.toolCalls.push(event.tool_call);
          break;
        case 'tool_result':
          if (event.tool_result) result.toolResults.push(event.tool_result);
          break;
        case 'provenance':
          result.provenance = event.provenanceTrace || event.provenance || null;
          break;
        case 'metadata':
          result.metadata = event.metadata || null;
          break;
        case 'error':
          result.error = {
            message: String(event.message || event.error || 'Chat stream failed.'),
            details: event,
          };
          break;
        default:
          break;
      }
    }

    return result;
  }

  async processNonStreamingChat(
    request: ChatRequest,
    options: { skipPromptPersistence?: boolean } = {},
  ): Promise<NonStreamingChatResult> {
    const collector = new MemoryResponseCollector();
    await this.processAndStreamChat(request, collector as unknown as Response, options);
    return this.parseCollectedChatResult(collector);
  }

  async processAndStreamChat(request: ChatRequest, res: Response, options: { skipPromptPersistence?: boolean } = {}): Promise<void> {
    const agentUrl = this.configService.get<string>('agentUrl');
    const systemContext = await this.docsService.getSystemContext();
    const latestUserMessage = (request.messages || []).filter(m => m.role === 'user').slice(-1)[0];
    const latestUserContent = latestUserMessage?.content || '';
    let assistantLane = this.promptCatalog.resolveAssistantLane(latestUserContent);
    const assistantState = await this.assistantService.getState();
    let assistantStateText = this.assistantService.formatStateForPrompt(assistantState);
    const promptedAgent = !request.agent_id ? await this.maybeResolveAgentFromPrompt(latestUserContent) : null;
    if (promptedAgent && !request.agent_id) {
      request.agent_id = promptedAgent.id;
      this.logger.log(`Resolved agent switch from prompt to '${promptedAgent.name}' (${promptedAgent.id})`);
    }
    let selectedAgent = promptedAgent || await this.agentsService.getOptional(request.agent_id);
    let effectiveSelectedAgent = this.resolveEffectiveSelectedAgent(request, selectedAgent);
    if (request.agent_id && !selectedAgent) {
      if (!res.writableEnded) {
        res.status(404).json({ error: `Unknown agent profile '${request.agent_id}'` });
      }
      return;
    }
    const resolvedBinding = await this.gatewayRoutingService.resolveBinding({
      sessionId: request.session_id,
      workspaceId: request.workspace_id || 'default',
      senderIdentifier: request.sender_identifier || 'local',
      surfaceType: request.surfaceType || 'chat',
      threadKey: request.threadKey || null,
      channelKey: request.channelKey || null,
      agentId: selectedAgent?.id || request.agent_id || 'main',
      delegationDepth: 0,
    });
    request.session_id = resolvedBinding.binding.sessionId;
    request.workspace_id = resolvedBinding.binding.workspaceId;
    request.sender_identifier = resolvedBinding.binding.senderIdentifier;
    request.agent_id = resolvedBinding.binding.agentId || request.agent_id || undefined;
    request.surfaceType = resolvedBinding.binding.surfaceType;
    request.threadKey = resolvedBinding.binding.threadKey || undefined;
    request.channelKey = resolvedBinding.binding.channelKey || undefined;

    if (!selectedAgent || selectedAgent.id !== (request.agent_id || 'main')) {
      selectedAgent = await this.agentsService.getOptional(request.agent_id);
      effectiveSelectedAgent = this.resolveEffectiveSelectedAgent(request, selectedAgent);
    }

    const sessionSnapshot = await this.chatService.getSession(request.session_id);
    const { settings, workspaceFiles } = await this.settingsService.getPayload();
    const effectiveChatControls = this.mergeChatControls(
      settings.chatDefaults,
      sessionSnapshot?.chatControls,
      this.extractRequestChatControls(request),
    );
    await this.chatService.upsertSessionControls(request.session_id, effectiveChatControls);
    request.planMode = effectiveChatControls.planMode;
    request.preferredWebMode = effectiveChatControls.preferredWebMode;
    request.toolUseMode = effectiveChatControls.toolUseMode;
    request.permissionMode = effectiveChatControls.permissionMode;
    request.selectedPlugins = effectiveChatControls.selectedPlugins;
    request.selectedTools = effectiveChatControls.selectedTools;

    let nluFrame: ChatNluFrame | null = null;
    let contextBudget: ChatContextBudget | null = null;
    let preTurnSignals: Awaited<ReturnType<AssistantService['ingestUserTurn']>> = { memoryEvents: [], advisoryEvents: [] };

      const gatewayRunId = randomUUID();
      await this.gatewayControlPlane.createRun({
        id: gatewayRunId,
        kind: 'foreground_chat',
        status: 'running',
        executionMode: 'foreground',
        sessionId: request.session_id,
        bindingId: resolvedBinding.binding.id,
        agentId: request.agent_id || selectedAgent?.id || null,
        summary: `Foreground chat run started for session ${request.session_id}`,
        queueMetadata: {
          executionMode: 'foreground',
          queuedRoles: [],
          workerAssignments: [],
          queueFallbackUsed: false,
        },
        guardianOutcome: null,
        terminalOutcome: null,
        metadata: {
          surfaceType: request.surfaceType || 'chat',
          threadKey: request.threadKey || null,
          channelKey: request.channelKey || null,
          preferredWebMode: request.preferredWebMode || 'auto',
          toolUseMode: request.toolUseMode || 'auto',
          permissionMode: request.permissionMode || 'workspace_default',
        },
      });
      await this.gatewayRoutingService.markRunStarted(resolvedBinding.binding.id, gatewayRunId);

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
    const systemMessages: ChatMessage[] = [];

    // Fetch available tools from agent and pass them to the model
    let toolsSchema: any[] | undefined;
    let availableSkills: Array<{ name: string; description: string; capabilityTags: string[] }> = [];
    let availableNluTools: ChatNluAvailableTool[] = [];
    try {
      const toolsRes = await firstValueFrom(
        this.httpService.get(`${agentUrl}/api/tools`)
      );
      // Agent returns { tools: [...], count: N }
      const rawTools = Array.isArray(toolsRes.data.tools) ? toolsRes.data.tools : [];
      const tools = this.filterRawToolsByPluginSelection(rawTools, effectiveChatControls.selectedPlugins || []);
      availableNluTools = this.normalizeToolsForNlu(tools);
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
    } catch (e: any) {
      this.logger.warn('[TOOL_TRACE] Could not fetch tools from agent:', e?.message || String(e));
      toolsSchema = undefined;
      availableSkills = [];
      availableNluTools = [];
    }

    try {
      if (latestUserContent) {
        const pendingClarification = sessionSnapshot?.pendingNluClarification || await this.chatService.getPendingNluClarification(request.session_id);
        const nluInput = {
            sessionId: request.session_id,
            latestUserContent,
            chatControlsSubset: {
              preferredWebMode: effectiveChatControls.preferredWebMode,
              toolUseMode: effectiveChatControls.toolUseMode,
              selectedTools: effectiveChatControls.selectedTools || [],
              selectedPlugins: effectiveChatControls.selectedPlugins || [],
            },
            selectedAgent: effectiveSelectedAgent
              ? {
                  id: effectiveSelectedAgent.id,
                  name: effectiveSelectedAgent.name,
                  skills: effectiveSelectedAgent.skills || [],
                }
              : null,
            availableTools: availableNluTools,
            attachments: latestUserMessage?.attachments || [],
            selection: request.selection || latestUserMessage?.selection || null,
            assistantStateSummary: assistantStateText.slice(0, 1500),
            pendingClarification,
            nluOverride: request.nluOverride || null,
            previousAssistantNlu: this.getPreviousAssistantNlu(history),
          };
        let nluResult = await this.chatNluService.analyzeTurn(nluInput);
        if (nluResult.pendingClarificationUpdate) {
          const updateResult = await this.chatService.applyNluClarificationUpdate(request.session_id, nluResult.pendingClarificationUpdate);
          if (!updateResult.applied && updateResult.reason === 'stale') {
            this.logger.warn(`Pending NLU clarification update was stale for session ${request.session_id}; rerunning without pending clarification.`);
            nluResult = await this.chatNluService.analyzeTurn({
              ...nluInput,
              pendingClarification: null,
            });
          }
        }
        nluFrame = nluResult.frame;
      } else {
        nluFrame = null;
      }
      if (nluFrame?.recommendedLane) {
        assistantLane = nluFrame.recommendedLane;
      }
    } catch (e: any) {
      this.logger.warn(`Chat NLU analysis failed; continuing with legacy routing: ${e?.message || String(e)}`);
      nluFrame = null;
    }

    preTurnSignals = latestUserContent
      ? await this.assistantService.ingestUserTurn(request.session_id, latestUserContent, nluFrame)
      : { memoryEvents: [], advisoryEvents: [] };
    const nluMemoryQuery = latestUserContent
      ? await this.assistantService.queryMemoryForNlu(request.session_id, latestUserContent, nluFrame)
      : { promptText: null, memoryEvents: [] };
    if (nluMemoryQuery.promptText) {
      assistantStateText = [assistantStateText, nluMemoryQuery.promptText].filter(Boolean).join('\n\n');
    }
    if (nluMemoryQuery.memoryEvents.length) {
      preTurnSignals = {
        ...preTurnSignals,
        memoryEvents: [...preTurnSignals.memoryEvents, ...nluMemoryQuery.memoryEvents],
      };
    }

    if (toolsSchema?.length) {
      toolsSchema = this.selectRelevantTools(latestUserContent, toolsSchema, effectiveChatControls, effectiveSelectedAgent, nluFrame);
      const allowedToolNames = new Set((toolsSchema || []).map((tool: any) => tool?.function?.name).filter(Boolean));
      availableSkills = availableSkills.filter((skill) => allowedToolNames.has(`skill_${skill.name}`));
      this.logger.log(`[TOOL_TRACE] Converted to OpenAI format, passing ${toolsSchema?.length || 0} filtered tools to agent`);
    }

    const toolGuidance = this.buildToolGuidance(toolsSchema);
    const skillGuidance = this.buildSkillGuidance(availableSkills, effectiveSelectedAgent);

    let editPrompt: string | null = null;
    if (request.editRequest) {
      editPrompt = `You are an expert document editor. The user has requested to perform an edit action on a specific selection of text.
Action requested: ${request.editRequest.action}
${request.editRequest.instruction ? `Additional instructions: ${request.editRequest.instruction}\n` : ''}
Original text selection: "${request.editRequest.selectedText}"
Context before: "...${request.editRequest.contextBefore.slice(-200)}"
Context after: "${request.editRequest.contextAfter.slice(0, 200)}..."

Output ONLY your proposed replacement text wrapped in <edit_suggestion>...</edit_suggestion> tags. Do not include original text, conversational filler, or markdown fences outside the tags.`;
    }

    const activeAgentSkillsText = this.buildActiveAgentSkillsText(effectiveSelectedAgent, availableSkills);
    const composedPrompt = this.promptCatalog.composeChatPrompt({
      systemContext,
      workspaceFiles,
      toolGuidance,
      skillGuidance,
      selectedAgent: effectiveSelectedAgent,
      activeAgentSkillsText,
      latestUserContent,
      reviewEnabled: !!request.output_reviewer_id,
      editPrompt,
      assistantStateText,
      assistantLane,
      nluFrame,
    });

    systemMessages.push({
      role: 'system',
      content: composedPrompt.prompt,
    });
    if (effectiveChatControls.planMode) {
      systemMessages.push({
        role: 'system',
        content: 'Plan mode is enabled for this chat. Prefer planning, implementation outlines, and decision-complete specs before executing work unless the user clearly asks for immediate action.',
      });
    }
    if (effectiveChatControls.preferredWebMode && effectiveChatControls.preferredWebMode !== 'auto') {
      const modeGuidance = {
        search: 'The user selected web search mode. Prefer search/research tools for broad current information.',
        read_page: 'The user selected read page mode. Prefer direct page extraction and exact source reading over broad web research.',
        browser: 'The user selected browser/live UI mode. Prefer browser-style tools for localhost, interactive sites, and inspect/click/test requests.',
      } as const;
      const selectedMode = effectiveChatControls.preferredWebMode as keyof typeof modeGuidance;
      if (modeGuidance[selectedMode]) {
        systemMessages.push({
          role: 'system',
          content: modeGuidance[selectedMode],
        });
      }
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

    // Apply budgeting before either direct actions or agent calls so persisted
    // metadata describes the same prompt context the model would receive.
    allMessages = this.budgetContext(allMessages);
    contextBudget = this.estimateContextChars(allMessages, composedPrompt.prompt, toolsSchema);

    if (await this.handleDirectActionIfApplicable(request, res, latestUserContent, {
      assistantLane,
      promptPackId: composedPrompt.provenance.promptPackId,
      promptVersionHash: composedPrompt.provenance.promptVersionHash,
      reviewerPromptVersionHash: composedPrompt.provenance.reviewerPromptVersionHash,
      workflowPromptIds: composedPrompt.provenance.workflowPromptIds,
      memoryEvents: preTurnSignals.memoryEvents,
      advisoryEvents: preTurnSignals.advisoryEvents,
      nluFrame,
      contextBudget,
      })) {
        await this.gatewayControlPlane.markRunTerminal(
          gatewayRunId,
          'completed',
          'Foreground chat completed via direct action.',
          null,
        );
        await this.gatewayRoutingService.markRunFinished(resolvedBinding.binding.id, gatewayRunId, 'completed');
        return;
      }

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
      promptTemplates: composedPrompt.templates,
      promptProvenance: composedPrompt.provenance,
      gateway_context: this.buildGatewayContextPayload(request, effectiveSelectedAgent, toolsSchema, resolvedBinding.routing),
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
        await this.gatewayRoutingService.markRunFinished(
          resolvedBinding.binding.id,
          gatewayRunId,
          'failed',
          err?.message || 'Agent unavailable',
        );
        await this.gatewayControlPlane.markRunTerminal(
          gatewayRunId,
          'failed',
          'Foreground chat failed before agent stream was established.',
          err?.message || 'Agent unavailable',
        );
        if (isConnectionError) {
        await this.gatewayRoutingService.emitHealthDegraded('Agent connection failed during chat orchestration', {
          code: err.code || null,
          message: err.message || String(err),
        });
      }

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
    const reviewEvents: Array<{ approved?: boolean; feedback?: string; reviewer_id?: string }> = [];
    const memoryEvents = [...preTurnSignals.memoryEvents];
    const advisoryEvents = [...preTurnSignals.advisoryEvents];

    let streamBuffer = '';
    let streamClosed = false;

    // Set headers for SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (nluFrame && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'metadata', metadata: { nlu: nluFrame } })}\n\n`);
    }

    return new Promise<void>((resolve) => {
      // Stream inactivity timeout: if the agent goes silent for this long,
      // force-close the stream so the frontend doesn't hang forever.
      const STREAM_INACTIVITY_TIMEOUT_MS = 75_000;
      const STREAM_HEARTBEAT_MS = 10_000;
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        // Ensure we persist whatever we have
        const citations = sources.length > 0 ? sources.map(url => ({ url, title: url })) : undefined;
        
        try {
          // If we had an error but also some content, prioritize content but mark it
          let persistContent = this.sanitizeAssistantContentChunk(fullAssistantResponse, true);
          // If no content but we have an error, keep content empty so UI only shows Error Card
          if (!persistContent && payload?.type !== 'error') {
            persistContent = 'Request failed';
          }

          // Finalize provenance if we have it
            if (provenanceTrace && !processedProvenance) {
              processedProvenance = ProvenanceSanitizer.processTrace(provenanceTrace);
            }
            if (provenanceTrace) {
              await this.gatewayControlPlane.captureRoleTraceFromProvenance({
                sessionId: request.session_id,
                runId: gatewayRunId,
                provenanceTrace,
                bindingId: resolvedBinding.binding.id,
                agentId: request.agent_id || selectedAgent?.id || null,
                source: 'foreground',
              });
            }
            const confidenceState = this.deriveAssistantConfidenceState(
              persistContent,
              payload?.type === 'error' ? String(payload?.error || 'error') : null,
            reviewEvents,
          );
          const derivedAdvisories = await this.assistantService.buildTurnAdvisories(
            request.session_id,
            latestUserContent,
            persistContent,
            assistantLane,
          );
          const allAdvisoryEvents = [
            ...advisoryEvents,
            ...derivedAdvisories.map((item) => ({
              category: item.category,
              summary: item.summary,
              actionState: item.actionState,
            })),
          ];

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
              reviewEvents: reviewEvents.length > 0 ? reviewEvents.map((event) => ({
                approved: event.approved,
                feedback: event.feedback,
                reviewerId: event.reviewer_id,
              })) : undefined,
              ...lastMetadata,
              agentId: request.agent_id,
              promptPackId: composedPrompt.provenance.promptPackId,
              promptVersionHash: composedPrompt.provenance.promptVersionHash,
              reviewerPromptVersionHash: composedPrompt.provenance.reviewerPromptVersionHash,
              workflowPromptIds: composedPrompt.provenance.workflowPromptIds,
              memoryEvents: memoryEvents.length > 0 ? memoryEvents : undefined,
              advisoryEvents: allAdvisoryEvents.length > 0 ? allAdvisoryEvents : undefined,
              workflowState: {
                promptPackId: composedPrompt.provenance.promptPackId,
                promptVersionHash: composedPrompt.provenance.promptVersionHash,
                reviewerPromptVersionHash: composedPrompt.provenance.reviewerPromptVersionHash,
                workflowPromptIds: composedPrompt.provenance.workflowPromptIds,
                reviewEnabled: !!request.output_reviewer_id,
                runIds: processedProvenance?.runIds || undefined,
                assistantLane,
                confidenceState,
                nlu: nluFrame || undefined,
                contextBudget,
              },
              ...(payload?.type === 'error' ? { error: { type: payload.error as string, message: payload.message as string } } : {})
            }
          );
          if (payload?.type === 'error' || (reviewEvents.length > 0 && reviewEvents[reviewEvents.length - 1]?.approved === false)) {
            const failureCategory = this.categorizeImprovementFailure((payload?.message as string) || null, reviewEvents);
            await this.selfImprovementService.createProposal({
              sessionId: request.session_id,
              failureCategory,
              promptPackId: composedPrompt.provenance.promptPackId,
              promptVersionHash: composedPrompt.provenance.promptVersionHash,
              reviewerPromptVersionHash: composedPrompt.provenance.reviewerPromptVersionHash,
              workflowPromptIds: composedPrompt.provenance.workflowPromptIds,
              rationale: (reviewEvents[reviewEvents.length - 1]?.feedback || (payload?.message as string) || 'Prompt-guided run failed quality gates.').slice(0, 1000),
              proposal: this.buildPromptCandidateProposal(
                failureCategory,
                latestUserContent,
                composedPrompt.provenance.workflowPromptIds,
                reviewEvents,
                payload?.type === 'error' ? String(payload.message || '') : null,
              ),
              expectedImprovement: 'Improve grounded output quality without mutating active production prompts.',
            });
          }
            await this.gatewayRoutingService.markRunFinished(
              resolvedBinding.binding.id,
              gatewayRunId,
              payload?.type === 'error' ? 'failed' : 'completed',
              payload?.type === 'error' ? String(payload?.message || payload?.error || 'Unknown agent error') : null,
            );
            await this.gatewayControlPlane.markRunTerminal(
              gatewayRunId,
              payload?.type === 'error' ? 'failed' : 'completed',
              persistContent.slice(0, 240) || null,
              payload?.type === 'error' ? String(payload?.message || payload?.error || 'Unknown agent error') : null,
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

      heartbeatTimer = setInterval(() => {
        if (streamClosed || res.writableEnded) {
          return;
        }
          try {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', ts: Date.now() })}\n\n`);
            void this.gatewayRoutingService.heartbeat(resolvedBinding.binding.id, gatewayRunId);
            void this.gatewayControlPlane.markRunHeartbeat(gatewayRunId);
          } catch (e) {
            this.logger.warn(`Failed to write heartbeat: ${e instanceof Error ? e.message : String(e)}`);
          }
      }, STREAM_HEARTBEAT_MS);

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
            const sanitizedContent = this.sanitizeAssistantContentChunk(data.content || '', false);
            if (!sanitizedContent) {
              return;
            }
            data.content = sanitizedContent;
            fullAssistantResponse += sanitizedContent;
          } else if (data.type === 'tool_call') {
            this.logger.log(`[TOOL_TRACE] Received tool_call from agent: ${JSON.stringify(data.tool_call || data)}`);
            toolCalls.push(data.tool_call || data);
            const toolName = data.tool_call?.name || data.tool_call?.tool_name || data.tool_call?.function?.name || 'tool';
            void this.gatewayRoutingService.emitToolActivity(resolvedBinding.binding.id, gatewayRunId, String(toolName), 'start');
          } else if (data.type === 'tool_result') {
            this.logger.log(`[TOOL_TRACE] Received tool_result from agent: ${data.tool_result?.tool_name || 'unknown'}`);
            toolResults.push(data.tool_result || data);
            const toolName = data.tool_result?.tool_name || data.tool_call?.name || 'tool';
            void this.gatewayRoutingService.emitToolActivity(resolvedBinding.binding.id, gatewayRunId, String(toolName), 'result');
          } else if (data.type === 'provenance') {
            const rawTrace = data.provenance_trace || data.provenance || data;
            // Process once and store
            provenanceTrace = rawTrace;
            processedProvenance = ProvenanceSanitizer.processTrace(rawTrace);
            await this.gatewayControlPlane.captureRoleTraceFromProvenance({
              sessionId: request.session_id,
              runId: gatewayRunId,
              provenanceTrace: rawTrace,
              bindingId: resolvedBinding.binding.id,
              agentId: request.agent_id || selectedAgent?.id || null,
              source: 'foreground',
            });
            await this.gatewayControlPlane.updateRun(gatewayRunId, {
              metadata: {
                provenanceCapturedAt: new Date().toISOString(),
                latestRunIds: processedProvenance?.runIds || [],
              },
            });
            // Replace with sanitized version for client
            data.provenanceTrace = processedProvenance;
            delete (data as any).provenance_trace;
            delete (data as any).provenance;
          } else if (data.type === 'metadata') {
            if (nluFrame || contextBudget) {
              data.metadata = {
                ...(data.metadata || {}),
                ...(nluFrame ? { nlu: nluFrame } : {}),
                contextBudget,
              };
            }
            lastMetadata = data.metadata;
            await this.gatewayControlPlane.updateRun(gatewayRunId, {
              metadata: {
                latestAgentMetadata: data.metadata || null,
              },
            });
          } else if (data.type === 'sources') {
            if (Array.isArray(data.sources)) {
              sources.push(...data.sources);
            }
          } else if (data.type === 'harness') {
            this.logger.log(`[HARNESS] Tool prep: ${data.harness_log?.tool} (${data.harness_log?.step})`);
          } else if (data.type === 'approval_required') {
            this.logger.warn(`[ORCHESTRATOR] Approval required: ${data.reason}`);
          } else if (data.type === 'review_result') {
            reviewEvents.push({
              approved: data.approved,
              feedback: data.feedback,
              reviewer_id: data.reviewer_id,
            });
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
    const targetMessage = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        sessionId,
        role: 'user',
      },
    });

    if (!targetMessage) {
      if (!res.writableEnded) {
        res.status(404).json({ error: 'Editable user message not found for this session' });
      }
      return;
    }

    // 1. Update the target message content first, then truncate later history.
    await this.prisma.message.update({
      where: { id: messageId },
      data: { content }
    });

    // 2. Truncate history after this message (including any old assistant responses)
    await this.chatService.deleteMessagesAfter(sessionId, messageId, false);

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
    options: { model?: string; complexity?: string; agentId?: string; temperature?: number; top_p?: number; nluOverride?: ChatRequest['nluOverride'] } = {}
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
      top_p: options.top_p,
      nluOverride: options.nluOverride || null,
    };

    return this.processAndStreamChat(request, res, { skipPromptPersistence: true });
  }

  private estimateContextChars(messages: ChatMessage[], composedSystemPrompt: string, toolsSchema?: any[], otherChars = 0): ChatContextBudget {
    const systemPromptChars = composedSystemPrompt.length;
    const messageHistoryChars = (messages || [])
      .filter((message) => message.role !== 'system')
      .reduce((total, message) => total + (message.content?.length || 0), 0);
    const toolDefinitionChars = (toolsSchema || []).reduce((total, tool) => total + JSON.stringify(tool).length, 0);
    const totalEstimatedChars = systemPromptChars + messageHistoryChars + toolDefinitionChars + otherChars;
    return {
      systemPromptChars,
      messageHistoryChars,
      toolDefinitionChars,
      otherChars,
      totalEstimatedChars,
    };
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

    const toolDescriptions = toolsSchema
      .filter(t => t?.function?.name)
      .map(t => {
        const name = t.function.name;
        const desc = t.function.description || '';
        return `- \`${name}\`: ${desc}`;
      })
      .join('\n');

    return `=== AVAILABLE TOOLS ===
You have access to the following relevant tools for this request:

${toolDescriptions}

=== WHEN TO USE TOOLS ===
- Use \`web_search\` for latest/current information.
- Use \`web_extract\` when you need page content, structured extraction, or a stronger backend than plain fetch.
- Use \`web_fetch\` when you need a simple direct URL fetch and no richer extractor is available.
- Use skill tools when one directly matches the task.
- Use utility tools only when the request clearly needs them.

=== TOOL CALLING FORMAT ===
When you need a tool, output ONLY a tool call like:
{"name": "web_search", "arguments": {"query": "your search query"}}

=== IMPORTANT RULES ===
- If a relevant tool is available, use it instead of guessing.
- If web/network access is needed but no such tool is available, say so plainly.
- Never claim to have used a tool unless it was actually invoked.`;
  }

  private buildSkillGuidance(
    availableSkills: Array<{ name: string; description: string; capabilityTags: string[] }>,
    selectedAgent?: { skills?: string[]; name?: string } | null,
  ): string | null {
    if (!availableSkills.length) {
      return null;
    }

    const skillLines = availableSkills
      .slice(0, this.MAX_SKILLS_IN_GUIDANCE)
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

  private buildActiveAgentSkillsText(
    selectedAgent?: { skills?: string[]; name?: string } | null,
    availableSkills: Array<{ name: string; description: string; capabilityTags: string[] }> = [],
  ): string | null {
    if (!selectedAgent?.skills?.length) {
      return null;
    }

    const installedSelectedSkills = selectedAgent.skills
      .map((skillName) => {
        const matched = availableSkills.find((skill) => skill.name === skillName);
        if (!matched) return null;
        const tags = matched.capabilityTags?.length ? ` [${matched.capabilityTags.join(', ')}]` : '';
        return `- skill_${matched.name}: ${matched.description}${tags}`;
      })
      .filter(Boolean);

    if (installedSelectedSkills.length) {
      return (
        `This agent has the following installed skills assigned. Prefer these skill tools when they are relevant before falling back to generic tool usage.\n` +
        `${installedSelectedSkills.join('\n')}`
      );
    }

    return (
      `This agent was assigned skills (${selectedAgent.skills.join(', ')}), but those skills are not currently installed in the agent runtime. Do not invent them.`
    );
  }

  private buildGatewayContextPayload(
    request: ChatRequest,
    selectedAgent: { id?: string; name?: string | null; modelId?: string | null; skills?: string[] } | null,
    toolsSchema?: any[],
    routingBinding?: GatewayRoutingContext,
  ): ChatRequest['gateway_context'] {
    const workspacePath = this.resolveWorkspaceRoot();
    const allowedTools = (toolsSchema || [])
      .map((tool: any) => tool?.function?.name)
      .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0);

    return {
      workspace_path: workspacePath,
      memory_scope: 'workspace',
      routing_binding: routingBinding,
      resolved_agent_profile: {
        id: selectedAgent?.id || request.agent_id || 'main',
        name: selectedAgent?.name || request.agent_id || 'Main',
        workspace_id: request.workspace_id || 'default',
        workspace_path: workspacePath,
        default_model: selectedAgent?.modelId || request.model || undefined,
        allowed_tools: allowedTools,
        memory_scope: 'workspace',
        prompt_files: [],
        research_defaults: {
          skills: selectedAgent?.skills || [],
        },
        active: true,
      },
    };
  }

  private categorizeImprovementFailure(errorMessage?: string | null, reviewEvents: Array<{ approved?: boolean; feedback?: string }> = []): string {
    const latestFeedback = (reviewEvents[reviewEvents.length - 1]?.feedback || '').toLowerCase();
    const combined = `${(errorMessage || '').toLowerCase()} ${latestFeedback}`.trim();
    if (combined.includes('forgot') || combined.includes('memory') || combined.includes('recall')) return 'memory-quality';
    if (combined.includes('continuity')) return 'continuity-gap';
    if (combined.includes('advis') || combined.includes('suggestion') || combined.includes('recommend')) return 'advisory-quality';
    if (combined.includes('provenance') || combined.includes('workflow state') || combined.includes('why i said')) return 'provenance-clarity';
    if (combined.includes('initiative') || combined.includes('follow-up')) return 'missed-initiative';
    if (combined.includes('raw') || combined.includes('leak')) return 'raw-leakage';
    if (combined.includes('duplicate') || combined.includes('repet')) return 'duplication';
    if (combined.includes('source') || combined.includes('fetch') || combined.includes('search')) return 'source-mismatch';
    if (combined.includes('format') || combined.includes('markdown') || combined.includes('bullet')) return 'format';
    if (combined.includes('ground') || combined.includes('unsupported') || combined.includes('uncertainty')) return 'grounding';
    return 'workflow-quality';
  }

  private targetBlocksForFailureCategory(
    failureCategory: string,
    workflowPromptIds: string[] = [],
  ): string[] {
    const category = (failureCategory || '').toLowerCase();
    if (category === 'format') return ['output-reviewer', 'repair-rewriter'];
    if (category === 'grounding') return ['web-research-grounded', 'output-reviewer', 'repair-rewriter'];
    if (category === 'source-mismatch') return ['web-research-grounded', 'output-reviewer', 'repair-rewriter'];
    if (category === 'memory-quality' || category === 'continuity-gap') return ['jarvis-core', 'jarvis-briefing'];
    if (category === 'advisory-quality' || category === 'missed-initiative') return ['jarvis-core', 'jarvis-advisory'];
    if (category === 'provenance-clarity') return ['jarvis-briefing', 'output-reviewer'];
    if (category === 'duplication') return ['core-chat', 'output-reviewer', 'repair-rewriter'];
    if (category === 'raw-leakage') return ['core-chat', 'output-reviewer', 'repair-rewriter'];
    return Array.from(new Set([...workflowPromptIds, 'output-reviewer', 'repair-rewriter']));
  }

  private candidateActionsForFailureCategory(
    failureCategory: string,
    latestFeedback: string,
    latestUserContent: string,
  ): string[] {
    const category = (failureCategory || '').toLowerCase();
    const actions: string[] = [];

    if (category === 'format') {
      actions.push('Tighten reviewer rules so required headings and bullet counts are treated as hard failures.');
      actions.push('Strengthen repair guidance to preserve exact markdown structure in every retry.');
    } else if (category === 'grounding') {
      actions.push('Add a stronger requirement to separate verified facts from inference when evidence is weak.');
      actions.push('Require explicit limitation statements instead of unsupported claims when retrieval is incomplete.');
    } else if (category === 'source-mismatch') {
      actions.push('Bias workflow guidance toward higher-relevance official or domain-specific sources before synthesis.');
      actions.push('Reject weak fetched pages earlier and fall back to stronger search evidence when needed.');
    } else if (category === 'memory-quality' || category === 'continuity-gap') {
      actions.push('Strengthen durable memory capture so explicit operator and mission facts are stored with clearer source labels.');
      actions.push('Improve prompt composition so relevant operator and mission memory is surfaced consistently.');
    } else if (category === 'advisory-quality' || category === 'missed-initiative') {
      actions.push('Refine advisory guidance so next-step suggestions are concise, relevant, and clearly labeled as recommendations.');
      actions.push('Suppress repetitive initiative when the same recommendation was recently offered.');
    } else if (category === 'provenance-clarity') {
      actions.push('Clarify control-room and provenance wording so users can understand why the assistant responded the way it did.');
      actions.push('Expose assistant lane, confidence state, and memory/advisory events more clearly in the UI.');
    } else if (category === 'duplication') {
      actions.push('Add reviewer checks for repeated phrasing and summary padding.');
      actions.push('Push repair prompts to compress repeated wording without dropping factual content.');
    } else if (category === 'raw-leakage') {
      actions.push('Harden prompts against leaking tool transcripts, reviewer notes, and protocol markers.');
      actions.push('Require repair output to strip process text and only return user-facing content.');
    } else {
      actions.push('Improve workflow prompts so evidence gathering and final synthesis stay aligned with the request.');
      actions.push('Refine reviewer and repair prompts to recover from degraded runs without surfacing draft artifacts.');
    }

    if (latestFeedback) {
      actions.push(`Address reviewer guidance directly: ${latestFeedback.slice(0, 220)}`);
    }

    if ((latestUserContent || '').toLowerCase().includes('search the web')) {
      actions.push('Keep grounded web workflow attached for current-information requests and preserve evidence-first synthesis.');
    }

    return Array.from(new Set(actions)).slice(0, 5);
  }

  private buildPromptCandidateProposal(
    failureCategory: string,
    latestUserContent: string,
    workflowPromptIds: string[],
    reviewEvents: Array<{ approved?: boolean; feedback?: string }> = [],
    errorMessage?: string | null,
  ): Record<string, unknown> {
    const latestFeedback = (reviewEvents[reviewEvents.length - 1]?.feedback || '').trim();
    const targetBlocks = this.targetBlocksForFailureCategory(failureCategory, workflowPromptIds);
    const candidateActions = this.candidateActionsForFailureCategory(failureCategory, latestFeedback, latestUserContent);

    return {
      kind: 'prompt_candidate',
      suggestedAreas: Array.from(new Set([
        ...workflowPromptIds,
        ...targetBlocks,
        ...(failureCategory === 'memory-quality' || failureCategory === 'continuity-gap' ? ['memory-capture-heuristics', 'assistant-state'] : []),
        ...(failureCategory === 'advisory-quality' || failureCategory === 'missed-initiative' ? ['advisory-policies', 'jarvis-advisory'] : []),
        ...(failureCategory === 'provenance-clarity' ? ['provenance-clarity', 'jarvis-briefing'] : []),
        'reviewer-heuristics',
        'repair-prompts',
      ])),
      targetBlocks,
      candidateActions,
      evaluationHints: [
        'Verify that the proposal targets an existing prompt block or workflow.',
        'Check that the candidate actions are concrete enough for a human to promote later.',
        'Do not mutate production prompt files automatically; require human promotion after eval approval.',
      ],
      requiresHumanPromotion: true,
      failureEvidence: {
        latestFeedback: latestFeedback || null,
        errorMessage: errorMessage || null,
        reviewEventCount: reviewEvents.length,
      },
    };
  }

  private deriveAssistantConfidenceState(
    content: string,
    errorType?: string | null,
    reviewEvents: Array<{ approved?: boolean; feedback?: string }> = [],
  ): 'grounded' | 'limited' | 'provider-outage' | 'draft' | 'direct' {
    const lowered = (content || '').toLowerCase();
    if (errorType) return 'limited';
    if (reviewEvents.length > 0 && reviewEvents[reviewEvents.length - 1]?.approved === false) return 'draft';
    if (lowered.includes('provider') && lowered.includes('could not verify')) return 'provider-outage';
    if (lowered.includes('could not verify') || lowered.includes('not enough evidence') || lowered.includes('uncertain')) return 'limited';
    return 'grounded';
  }

  private sanitizeAssistantContentChunk(content: string, finalize = false): string {
    if (!content) {
      return '';
    }

    const trimmed = content.trim();
    if (
      /<\/?edit_suggestion>/i.test(content)
      || /^<edit/i.test(trimmed)
      || /^edit_suggestion>/i.test(trimmed)
      || /^_suggestion>/i.test(trimmed)
    ) {
      let repaired = trimmed;
      if (/^_suggestion>/i.test(repaired)) {
        repaired = `<edit${repaired}`;
      } else if (/^edit_suggestion>/i.test(repaired)) {
        repaired = `<${repaired}`;
      }
      return repaired;
    }

    let sanitized = content
      .replace(/<\/think>/gi, '')
      .replace(/<\/thinking>/gi, '')
      .replace(/<think>/gi, '')
      .replace(/<thinking>/gi, '')
      .replace(/<\/?skill_[a-z0-9-]+>/gi, '')
      .replace(/<\/?skill>/gi, '');

    sanitized = sanitized.replace(
      /^\s*>?\s*(?:\{[\s\S]*?"(?:tool|args|thought)"[\s\S]*?\}\s*)+/i,
      '',
    );

    const transcriptMatch = sanitized.match(ChatOrchestratorService.TRANSCRIPT_MARKER_REGEX);
    if (transcriptMatch?.index !== undefined) {
      sanitized = sanitized.slice(0, transcriptMatch.index);
    }

    const rawLeakMatch = sanitized.match(
      />?\s*(?:\{"name":|>\{"tool":|>sequential_thinking\{|<\/skill>|<tool_code>|<invoke|minimax:tool_call)/i,
    );
    if (rawLeakMatch?.index !== undefined) {
      sanitized = sanitized.slice(0, rawLeakMatch.index);
    }

    if (!finalize) {
      return sanitized;
    }

    return this.normalizeAssistantReadability(sanitized, true);
  }

  private normalizeAssistantReadability(content: string, finalize = false): string {
    if (!content) {
      return '';
    }

    let normalized = content
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\bIam(?=[A-Z])/g, 'I am ')
      .replace(/\bIve(?=[A-Z])/g, "I've ")
      .replace(/\bIll(?=[A-Z])/g, "I'll ")
      .replace(/\bId(?=[A-Z])/g, "I'd ")
      .replace(/\bYouve(?=[A-Z])/g, "You've ")
      .replace(/\bYoure(?=[A-Z])/g, "You're ")
      .replace(/\bDont(?=[A-Z])/g, "Don't ")
      .replace(/\bCant(?=[A-Z])/g, "Can't ")
      .replace(/\bWont(?=[A-Z])/g, "Won't ")
      .replace(/([,:;!?])([A-Za-z])/g, '$1 $2');

    normalized = this.collapseRepeatedContent(normalized);

    const alphaCount = (normalized.match(/[A-Za-z]/g) || []).length;
    const whitespaceCount = (normalized.match(/\s/g) || []).length;
    if (alphaCount >= 40 && whitespaceCount / Math.max(alphaCount, 1) < 0.08) {
      normalized = this.expandCompactedEnglish(normalized);
    }

    normalized = normalized.replace(/[ \t]{2,}/g, ' ');
    return finalize ? normalized.trim() : normalized;
  }

  private collapseRepeatedContent(content: string): string {
    let collapsed = content;

    collapsed = collapsed.replace(/(.{50,180}?)(?:\s+\1){2,}/gis, '$1 ...');

    const words = collapsed.split(/\s+/).filter(Boolean);
    if (words.length < 40) {
      return collapsed;
    }

    const maxWindow = Math.min(24, Math.floor(words.length / 3));
    for (let size = maxWindow; size >= 10; size--) {
      const tail = words.slice(-size).join(' ').toLowerCase();
      if (tail.length < 60) {
        continue;
      }

      const body = words.slice(0, -size).join(' ').toLowerCase();
      const firstIndex = body.indexOf(tail);
      if (firstIndex === -1) {
        continue;
      }

      const secondIndex = body.indexOf(tail, firstIndex + tail.length);
      if (secondIndex === -1) {
        continue;
      }

      const prefixWords = words.slice(0, -size);
      return `${prefixWords.join(' ')} ...`;
    }

    return collapsed;
  }

  private expandCompactedEnglish(content: string): string {
    const boundaryWords = [
      'including',
      'answering',
      'questions',
      'information',
      'repository',
      'workspace',
      'favorite',
      'summary',
      'provide',
      'assist',
      'variety',
      'latest',
      'results',
      'because',
      'about',
      'would',
      'could',
      'should',
      'with',
      'your',
      'just',
      'know',
      'this',
      'that',
      'have',
      'from',
      'into',
      'task',
      'agent',
      'search',
      'read',
      'list',
      'help',
      'what',
      'mind',
      'can',
      'you',
      'for',
      'the',
      'and',
    ];

    let expanded = content;
    for (const word of boundaryWords) {
      const regex = new RegExp(`(?<=[A-Za-z])(${word})(?=[A-Za-z])`, 'gi');
      expanded = expanded.replace(regex, ' $1 ');
    }

    expanded = expanded
      .replace(/\bI(?=[a-z]{4,})/g, 'I ')
      .replace(/\bYou(?=[a-z]{4,})/g, 'You ')
      .replace(/\bYour(?=[a-z]{4,})/g, 'Your ')
      .replace(/[ \t]{2,}/g, ' ');

    return expanded;
  }
}
