import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ChatMessage, ChatResponse } from '@rawclaw/shared';

interface ToolCall {
  tool_name: string;
  input: Record<string, unknown>;
}

interface Citation {
  url: string;
  title?: string;
}

interface MessageWithRelations {
  id: string;
  role: string;
  content: string;
  toolCalls: string | null;
  citations: string | null;
  createdAt: Date;
  sessionId: string;
}

export interface SessionWithMessages {
  id: string;
  title: string | null;
  workspaceId: string;
  senderIdentifier: string;
  createdAt: Date;
  updatedAt: Date;
  messages: MessageWithRelations[];
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
    toolCalls?: ToolCall[],
    citations?: Citation[]
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
        toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
        citations: citations ? JSON.stringify(citations) : null,
      },
    });
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((m: MessageWithRelations) => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      tool_calls: m.toolCalls ? JSON.parse(m.toolCalls) as ToolCall[] : undefined,
    }));
  }

  async listSessions(): Promise<SessionWithMessages[]> {
    return this.prisma.session.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 20
    }) as Promise<SessionWithMessages[]>;
  }

  async getSession(id: string): Promise<SessionWithMessages | null> {
    return this.prisma.session.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    }) as Promise<SessionWithMessages | null>;
  }
}