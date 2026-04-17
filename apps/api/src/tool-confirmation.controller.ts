import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ToolConfirmationService, ToolConfirmation } from './tool-confirmation.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

interface CreateConfirmationBody {
  sessionId: string;
  toolName: string;
  toolInput: string;
}

@UseGuards(JwtAuthGuard)
@Controller('tools/confirm')
export class ToolConfirmationController {
  constructor(private readonly confirmationService: ToolConfirmationService) {}

  /**
   * POST /api/tools/confirm/request
   * Create a new tool confirmation request.
   * Called by the agent when a tool requires user consent.
   */
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateConfirmationBody): Promise<ToolConfirmation> {
    return this.confirmationService.create({
      sessionId: body.sessionId,
      toolName: body.toolName,
      toolInput: body.toolInput,
    });
  }

  /**
   * GET /api/tools/confirm/:id
   * Get a specific confirmation by ID.
   * The agent polls this endpoint to check if user has approved/denied.
   */
  @Get(':id')
  async getById(@Param('id') id: string): Promise<ToolConfirmation> {
    return this.confirmationService.getById(id);
  }

  /**
   * GET /api/tools/confirm?sessionId=xxx
   * List all pending confirmations for a session.
   * The UI uses this to render banners.
   */
  @Get()
  async listPending(@Query('sessionId') sessionId: string): Promise<ToolConfirmation[]> {
    if (!sessionId) {
      return [];
    }
    return this.confirmationService.listPending(sessionId);
  }

  /**
   * POST /api/tools/confirm/:id/approve
   * Approve a pending tool confirmation.
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id') id: string): Promise<ToolConfirmation> {
    return this.confirmationService.approve(id);
  }

  /**
   * POST /api/tools/confirm/:id/deny
   * Deny a pending tool confirmation.
   */
  @Post(':id/deny')
  @HttpCode(HttpStatus.OK)
  async deny(@Param('id') id: string): Promise<ToolConfirmation> {
    return this.confirmationService.deny(id);
  }
}