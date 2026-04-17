import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ChatMessage, ChatResponse, ToolCall } from '@rawclaw/shared';

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
}

export interface SessionWithMessages {
  id: string;
  title: string | null;
  workspaceId: string;
  senderIdentifier: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async createMessage(
    sessionId: string,
    role: string,
    content: string,
    metadata?: {
      toolCalls?: any[];
      toolResults?: any[];
      provenance?: any;
      citations?: Citation[];
      modelId?: string;
      isLocal?: boolean;
      fallbacks?: string[];
      memoryRecall?: boolean;
      agentId?: string;
      error?: { type: string; message: string };
    }
  ): Promise<MessageWithRelations> {
    // Ensure session exists
    await this.prisma.session.upsert({
      where: { id: sessionId },
      update: { updatedAt: new Date() },
      create: {
        id: sessionId,
        title: content.substring(0, 50) + (content.length > 50 ? '...' : '')
      },
    });

    return this.prisma.message.create({
      data: {
        sessionId,
        role,
        content,
        toolCalls: metadata?.toolCalls ? JSON.stringify(metadata.toolCalls) : null,
        toolResults: metadata?.toolResults ? JSON.stringify(metadata.toolResults) : null,
        provenance: metadata?.provenance ? JSON.stringify(metadata.provenance) : null,
        citations: metadata?.citations ? JSON.stringify(metadata.citations) : null,
        modelId: metadata?.modelId,
        isLocal: metadata?.isLocal,
        fallbacks: metadata?.fallbacks ? JSON.stringify(metadata.fallbacks) : null,
        memoryRecall: metadata?.memoryRecall,
        agentId: metadata?.agentId,
        errorType: metadata?.error?.type,
        errorMessage: metadata?.error?.message,
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
    return {
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      tool_calls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      toolResults: m.toolResults ? JSON.parse(m.toolResults) : undefined,
      provenanceTrace: m.provenance ? JSON.parse(m.provenance) : undefined,
      modelId: m.modelId || undefined,
      isLocal: m.isLocal ?? undefined,
      fallbacks: m.fallbacks ? JSON.parse(m.fallbacks) : undefined,
      memoryRecall: m.memoryRecall ?? undefined,
      agentId: m.agentId || undefined,
      error: m.errorType ? { type: m.errorType, message: m.errorMessage || '' } : undefined,
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
      title: session.title,
      workspaceId: session.workspaceId,
      senderIdentifier: session.senderIdentifier,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages.map((m: MessageWithRelations) => this.mapToChatMessage(m)),
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
      title: session.title,
      workspaceId: session.workspaceId,
      senderIdentifier: session.senderIdentifier,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages.map((m: MessageWithRelations) => this.mapToChatMessage(m)),
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

  async deleteSession(id: string): Promise<void> {
    // Note: Prisma will handle foreign key deletion if configured (cascading)
    // In our schema, we should ensure messages are deleted with the session.
    await this.prisma.message.deleteMany({ where: { sessionId: id } });
    await this.prisma.session.delete({ where: { id } });
  }
}