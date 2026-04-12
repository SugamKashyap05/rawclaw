import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

interface CreateConfirmationDto {
  sessionId: string;
  toolName: string;
  toolInput: string;
}

export interface ToolConfirmation {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: string;
  status: string;
  requestedAt: Date;
  resolvedAt: Date | null;
}

@Injectable()
export class ToolConfirmationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new tool confirmation request (status: pending).
   * Called by the agent when it encounters a tool that requires_confirmation.
   */
  async create(dto: CreateConfirmationDto): Promise<ToolConfirmation> {
    return this.prisma.toolConfirmation.create({
      data: {
        sessionId: dto.sessionId,
        toolName: dto.toolName,
        toolInput: dto.toolInput,
        status: 'pending',
      },
    });
  }

  /**
   * Get a confirmation by ID.
   * Used by the agent to poll for user's decision.
   */
  async getById(id: string): Promise<ToolConfirmation> {
    const confirmation = await this.prisma.toolConfirmation.findUnique({
      where: { id },
    });
    if (!confirmation) {
      throw new NotFoundException(`Tool confirmation ${id} not found`);
    }
    return confirmation;
  }

  /**
   * List all pending confirmations for a session.
   * Used by the UI to render ConfirmationBanner components.
   */
  async listPending(sessionId: string): Promise<ToolConfirmation[]> {
    return this.prisma.toolConfirmation.findMany({
      where: {
        sessionId,
        status: 'pending',
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Approve a tool confirmation.
   * Called by the UI when user clicks "Allow".
   */
  async approve(id: string): Promise<ToolConfirmation> {
    const confirmation = await this.getById(id);
    if (confirmation.status !== 'pending') {
      throw new Error(`Confirmation ${id} is already ${confirmation.status}`);
    }
    return this.prisma.toolConfirmation.update({
      where: { id },
      data: {
        status: 'approved',
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Deny a tool confirmation.
   * Called by the UI when user clicks "Deny".
   */
  async deny(id: string): Promise<ToolConfirmation> {
    const confirmation = await this.getById(id);
    if (confirmation.status !== 'pending') {
      throw new Error(`Confirmation ${id} is already ${confirmation.status}`);
    }
    return this.prisma.toolConfirmation.update({
      where: { id },
      data: {
        status: 'denied',
        resolvedAt: new Date(),
      },
    });
  }
}
