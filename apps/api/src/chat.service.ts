import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { AdvisoryEvent, ChatControlState, ChatMessage, ChatResponse, MemoryEvent, ToolCall, ReviewEvent, WorkflowState } from '@rawclaw/shared';
import { ProvenanceSanitizer } from './common/provenance-sanitizer';

interface Citation {
  url: string;
  title?: string;
}

interface MessageWithRelations {
  id: string;
  role: string;
  content: string;
  toolCalls: string | null;
  toolResults: string | null;
  provenance: string | null;
  citations: string | null;
  createdAt: Date;
  sessionId: string;
  // P1 Metadata
  modelId: string | null;
  isLocal: boolean | null;
  fallbacks: string | null;
  memoryRecall: boolean | null;
  agentId: string | null;
  errorType: string | null;
  errorMessage: string | null;
  attachments: string | null;
  durationMs: number | null;
  promptPackId?: string | null;
  promptVersionHash?: string | null;
  reviewerPromptVersionHash?: string | null;
  workflowPromptIds?: string | null;
  runIds?: string | null;
}

export interface SessionWithMessages {
  id: string;
  title: string | null;
  workspaceId: string;
  senderIdentifier: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
  chatControls?: ChatControlState;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  private normalizeSessionTitleContent(content: string): string {
    return (content || '').replace(/\s+/g, ' ').trim();
  }

  private isLowSignalSessionPrompt(content: string): boolean {
    const normalized = this.normalizeSessionTitleContent(content).toLowerCase();
    if (!normalized) return true;

    return /^(?:hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|test|ping|hola|hey there|hello there)(?:[.!?,\s]*)$/i.test(
      normalized,
    );
  }

  private deriveSessionTitle(content: string): string | null {
    const normalized = this.normalizeSessionTitleContent(content);
    if (!normalized || this.isLowSignalSessionPrompt(normalized)) {
      return null;
    }

    return normalized.substring(0, 50) + (normalized.length > 50 ? '...' : '');
  }

  private deriveSessionTitleFromMessages(messages: MessageWithRelations[]): string | null {
    const userMessages = messages.filter((message) => message.role === 'user');
    for (const message of userMessages) {
      const meaningful = this.deriveSessionTitle(message.content);
      if (meaningful) {
        return meaningful;
      }
    }

    const fallback = userMessages
      .map((message) => this.normalizeSessionTitleContent(message.content))
      .find((content) => content.length > 0);

    if (!fallback) {
      return null;
    }

    return fallback.substring(0, 50) + (fallback.length > 50 ? '...' : '');
  }

  private parseSessionControls(metadataJson: string | null | undefined): ChatControlState | undefined {
    if (!metadataJson) return undefined;
    try {
      const parsed = JSON.parse(metadataJson) as { chatControls?: ChatControlState } | ChatControlState;
      const controls = (parsed as any)?.chatControls && typeof (parsed as any).chatControls === 'object'
        ? (parsed as any).chatControls as ChatControlState
        : (parsed as ChatControlState);
      if (!controls || typeof controls !== 'object') return undefined;
      return {
        planMode: typeof controls.planMode === 'boolean' ? controls.planMode : undefined,
        preferredWebMode: controls.preferredWebMode,
        toolUseMode: controls.toolUseMode,
        permissionMode: controls.permissionMode,
        selectedPlugins: Array.isArray(controls.selectedPlugins) ? controls.selectedPlugins : [],
        selectedTools: Array.isArray(controls.selectedTools) ? controls.selectedTools : [],
      };
    } catch {
      return undefined;
    }
  }

  async upsertSessionControls(sessionId: string, chatControls: ChatControlState): Promise<void> {
    const existing = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { metadataJson: true },
    });
    const currentControls = this.parseSessionControls(existing?.metadataJson) || {};
    const nextControls: ChatControlState = {
      ...currentControls,
      ...chatControls,
      selectedPlugins: chatControls.selectedPlugins ?? currentControls.selectedPlugins ?? [],
      selectedTools: chatControls.selectedTools ?? currentControls.selectedTools ?? [],
    };

    await this.prisma.session.upsert({
      where: { id: sessionId },
      update: { metadataJson: JSON.stringify({ chatControls: nextControls }) },
      create: {
        id: sessionId,
        title: null,
        metadataJson: JSON.stringify({ chatControls: nextControls }),
      },
    });
  }

  async createMessage(
    sessionId: string,
    role: string,
    content: string,
    metadata?: {
      toolCalls?: any[];
      toolResults?: any[];
      provenance?: any;
      reviewEvents?: ReviewEvent[];
      citations?: Citation[];
      modelId?: string;
      isLocal?: boolean;
      fallbacks?: string[];
      memoryRecall?: boolean;
      agentId?: string;
      error?: { type: string; message: string };
      attachments?: any[];
      durationMs?: number;
      promptPackId?: string;
      promptVersionHash?: string;
      reviewerPromptVersionHash?: string;
      workflowPromptIds?: string[];
      runIds?: string[];
      workflowState?: WorkflowState;
      memoryEvents?: MemoryEvent[];
      advisoryEvents?: AdvisoryEvent[];
    }
  ): Promise<MessageWithRelations> {
    const derivedTitle = role === 'user' ? this.deriveSessionTitle(content) : null;

    // Ensure session exists
    await this.prisma.session.upsert({
      where: { id: sessionId },
      update: { updatedAt: new Date() },
      create: {
        id: sessionId,
        title: derivedTitle,
      },
    });

    if (derivedTitle) {
      await this.prisma.session.updateMany({
        where: {
          id: sessionId,
          title: null,
        },
        data: {
          title: derivedTitle,
        },
      });
    }

    return this.prisma.message.create({
      data: {
        sessionId,
        role,
        content,
        toolCalls: metadata?.toolCalls ? JSON.stringify(metadata.toolCalls) : null,
        toolResults: metadata?.toolResults ? JSON.stringify(metadata.toolResults) : null,
        provenance:
          metadata?.provenance || metadata?.reviewEvents?.length || metadata?.workflowState
            ? JSON.stringify({
                trace: metadata?.provenance || null,
                reviewEvents: metadata?.reviewEvents || [],
                workflowState: metadata?.workflowState || null,
                memoryEvents: metadata?.memoryEvents || [],
                advisoryEvents: metadata?.advisoryEvents || [],
              })
            : null,
        citations: metadata?.citations ? JSON.stringify(metadata.citations) : null,
        modelId: metadata?.modelId,
        isLocal: metadata?.isLocal,
        fallbacks: metadata?.fallbacks ? JSON.stringify(metadata.fallbacks) : null,
        memoryRecall: metadata?.memoryRecall,
        agentId: metadata?.agentId,
        errorType: metadata?.error?.type,
        errorMessage: metadata?.error?.message,
        attachments: metadata?.attachments ? JSON.stringify(metadata.attachments) : null,
        durationMs: metadata?.durationMs,
        promptPackId: metadata?.promptPackId,
        promptVersionHash: metadata?.promptVersionHash,
        reviewerPromptVersionHash: metadata?.reviewerPromptVersionHash,
        // @ts-ignore - field present after prisma generate
        workflowPromptIds: metadata?.workflowPromptIds ? JSON.stringify(metadata.workflowPromptIds) : null,
        // @ts-ignore - runIds is present in generated client but TS server is stale
        runIds: metadata?.runIds ? JSON.stringify(metadata.runIds) : null,
      },
    });
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((m: MessageWithRelations) => this.mapToChatMessage(m));
  }

  private mapToChatMessage(m: MessageWithRelations): ChatMessage {
    const parsedProvenance = m.provenance ? JSON.parse(m.provenance) : null;
    const rawTrace = parsedProvenance?.trace || parsedProvenance;
    const reviewEvents = Array.isArray(parsedProvenance?.reviewEvents) ? parsedProvenance.reviewEvents : undefined;
    const workflowState = parsedProvenance?.workflowState && typeof parsedProvenance.workflowState === 'object'
      ? parsedProvenance.workflowState
      : undefined;
    const memoryEvents = Array.isArray(parsedProvenance?.memoryEvents) ? parsedProvenance.memoryEvents : undefined;
    const advisoryEvents = Array.isArray(parsedProvenance?.advisoryEvents) ? parsedProvenance.advisoryEvents : undefined;

    return {
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      tool_calls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      toolResults: m.toolResults ? JSON.parse(m.toolResults) : undefined,
      provenanceTrace: rawTrace ? ProvenanceSanitizer.processTrace(rawTrace) : undefined,
      runIds: m.runIds ? JSON.parse(m.runIds) : undefined,
      modelId: m.modelId || undefined,
      isLocal: m.isLocal ?? undefined,
      fallbacks: m.fallbacks ? JSON.parse(m.fallbacks) : undefined,
      memoryRecall: m.memoryRecall ?? undefined,
      agentId: m.agentId || undefined,
      error: m.errorType ? { type: m.errorType, message: m.errorMessage || '' } : undefined,
      attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
      createdAt: m.createdAt,
      durationMs: m.durationMs || undefined,
      promptPackId: m.promptPackId || undefined,
      promptVersionHash: m.promptVersionHash || undefined,
      reviewerPromptVersionHash: m.reviewerPromptVersionHash || undefined,
      workflowPromptIds: m.workflowPromptIds ? JSON.parse(m.workflowPromptIds) : undefined,
      reviewEvents,
      workflowState,
      memoryEvents,
      advisoryEvents,
    };
  }

  async listSessions(): Promise<SessionWithMessages[]> {
    const sessions = await this.prisma.session.findMany({
      include: { 
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 20
    });

    return sessions.map(session => ({
      id: session.id,
      title: session.title || this.deriveSessionTitleFromMessages(session.messages),
      workspaceId: session.workspaceId,
      senderIdentifier: session.senderIdentifier,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages.map((m: MessageWithRelations) => this.mapToChatMessage(m)),
      chatControls: this.parseSessionControls(session.metadataJson),
    }));
  }

  async getSession(id: string): Promise<SessionWithMessages | null> {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!session) return null;

    return {
      id: session.id,
      title: session.title || this.deriveSessionTitleFromMessages(session.messages),
      workspaceId: session.workspaceId,
      senderIdentifier: session.senderIdentifier,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages.map((m: MessageWithRelations) => this.mapToChatMessage(m)),
      chatControls: this.parseSessionControls(session.metadataJson),
    };
  }

  async deleteMessagesAfter(sessionId: string, messageId: string, includeTarget: boolean = false): Promise<void> {
    const target = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!target) return;

    await this.prisma.message.deleteMany({
      where: {
        sessionId,
        createdAt: {
          [includeTarget ? 'gte' : 'gt']: target.createdAt,
        },
      },
    });
  }

  async getDocument(id: string) {
    return this.prisma.document.findUnique({
      where: { id }
    });
  }

  async deleteSession(id: string): Promise<void> {
    // Note: Prisma will handle foreign key deletion if configured (cascading)
    // In our schema, we should ensure messages are deleted with the session.
    await this.prisma.message.deleteMany({ where: { sessionId: id } });
    await this.prisma.session.delete({ where: { id } });
  }
}
