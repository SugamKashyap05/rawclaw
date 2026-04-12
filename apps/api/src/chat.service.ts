import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ChatMessage, ChatResponse } from '@rawclaw/shared';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async createMessage(sessionId: string, role: string, content: string, toolCalls?: any, citations?: any) {
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

  async getMessages(sessionId: string) {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map(m => ({
      role: m.role as any,
      content: m.content,
      tool_calls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      // Add more fields if needed
    }));
  }

  async listSessions() {
    return this.prisma.session.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 20
    });
  }

  async getSession(id: string) {
    return this.prisma.session.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
  }
}
