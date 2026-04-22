import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgentProfile, CreateAgentRequest, UpdateAgentRequest } from '@rawclaw/shared';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AgentProfile[]> {
    const rows = await this.prisma.agentProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => this.toAgent(row));
  }

  async get(id: string): Promise<AgentProfile> {
    const row = await this.prisma.agentProfile.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Agent ${id} not found`);
    return this.toAgent(row);
  }

  async getOptional(id?: string | null): Promise<AgentProfile | null> {
    if (!id) return null;
    const row = await this.prisma.agentProfile.findUnique({ where: { id } });
    return row ? this.toAgent(row) : null;
  }

  async create(payload: CreateAgentRequest): Promise<AgentProfile> {
    if (payload.isDefault) {
      await this.prisma.agentProfile.updateMany({
        data: { isDefault: false },
      });
    }

    const created = await this.prisma.agentProfile.create({
      data: {
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        systemPrompt: payload.systemPrompt.trim(),
        isDefault: payload.isDefault ?? false,
        modelId: payload.modelId || null,
        skills: payload.skills ? JSON.stringify(payload.skills) : null,
      },
    });
    return this.toAgent(created);
  }

  async update(id: string, payload: UpdateAgentRequest): Promise<AgentProfile> {
    if (payload.isDefault) {
      await this.prisma.agentProfile.updateMany({ data: { isDefault: false } });
    }

    const updated = await this.prisma.agentProfile.update({
      where: { id },
      data: {
        name: payload.name?.trim(),
        description: payload.description?.trim(),
        systemPrompt: payload.systemPrompt?.trim(),
        status: payload.status,
        isDefault: payload.isDefault,
        modelId: payload.modelId,
        skills: payload.skills ? JSON.stringify(payload.skills) : undefined,
      },
    });
    return this.toAgent(updated);
  }

  async remove(id: string): Promise<{ success: true }> {
    await this.prisma.agentProfile.delete({ where: { id } });
    return { success: true };
  }

  async countRunning(): Promise<number> {
    return this.prisma.agentProfile.count({
      where: { status: 'running' },
    });
  }

  private toAgent(row: any): AgentProfile {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.systemPrompt,
      status: row.status as AgentProfile['status'],
      isDefault: row.isDefault,
      modelId: row.modelId || undefined,
      skills: row.skills ? JSON.parse(row.skills) : [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
