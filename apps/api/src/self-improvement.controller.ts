import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { SelfImprovementService } from './self-improvement.service';

@UseGuards(JwtAuthGuard)
@Controller('self-improvement')
export class SelfImprovementController {
  constructor(private readonly selfImprovementService: SelfImprovementService) {}

  @Get('proposals')
  list() {
    return this.selfImprovementService.list();
  }

  @Get('proposals/:id')
  get(@Param('id') id: string) {
    return this.selfImprovementService.get(id);
  }

  @Post('proposals')
  create(@Body() body: any) {
    return this.selfImprovementService.createProposal(body);
  }

  @Post('proposals/:id/evaluate')
  evaluate(@Param('id') id: string) {
    return this.selfImprovementService.evaluateProposal(id);
  }

  @Post('proposals/evaluate-pending')
  evaluatePending(@Body() body?: { limit?: number }) {
    return this.selfImprovementService.evaluatePending(body?.limit || 20);
  }

  @Patch('proposals/:id/eval')
  updateEval(@Param('id') id: string, @Body() body: { evalStatus?: 'approved' | 'rejected' | 'pending'; status?: string; evalNotes?: string }) {
    return this.selfImprovementService.recordEvaluation(id, body);
  }
}
