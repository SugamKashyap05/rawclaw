import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PromptCatalogService } from './prompt-catalog.service';

type ProposalEvalState = 'approved' | 'rejected' | 'pending';

type ImprovementProposalRecord = {
  id: string;
  sessionId: string | null;
  messageId: string | null;
  failureCategory: string;
  promptPackId: string | null;
  promptVersionHash: string | null;
  reviewerPromptVersionHash: string | null;
  workflowPromptIds: string | null;
  rationale: string;
  proposalJson: string;
  expectedImprovement: string | null;
  status: string;
  evalStatus: string;
  evalNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SelfImprovementService {
  private readonly logger = new Logger(SelfImprovementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promptCatalog: PromptCatalogService,
  ) {}

  private isMissingTableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('no such table') || message.includes('does not exist') || message.includes('promptImprovementProposal');
  }

  async list() {
    try {
      return await this.prisma.promptImprovementProposal.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  async get(id: string) {
    try {
      const proposal = await this.prisma.promptImprovementProposal.findUnique({
        where: { id },
      });
      if (!proposal) {
        throw new NotFoundException(`Prompt improvement proposal '${id}' not found`);
      }
      return proposal;
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async createProposal(payload: {
    sessionId?: string;
    messageId?: string;
    failureCategory: string;
    promptPackId?: string;
    promptVersionHash?: string;
    reviewerPromptVersionHash?: string;
    workflowPromptIds?: string[];
    rationale: string;
    proposal: Record<string, unknown>;
    expectedImprovement?: string;
  }) {
    try {
      return await this.prisma.promptImprovementProposal.create({
        data: {
          sessionId: payload.sessionId || null,
          messageId: payload.messageId || null,
          failureCategory: payload.failureCategory,
          promptPackId: payload.promptPackId || null,
          promptVersionHash: payload.promptVersionHash || null,
          reviewerPromptVersionHash: payload.reviewerPromptVersionHash || null,
          workflowPromptIds: payload.workflowPromptIds ? JSON.stringify(payload.workflowPromptIds) : null,
          rationale: payload.rationale,
          proposalJson: JSON.stringify(payload.proposal),
          expectedImprovement: payload.expectedImprovement || null,
        },
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async recordEvaluation(id: string, payload: { evalStatus?: ProposalEvalState; status?: string; evalNotes?: string }) {
    try {
      return await this.prisma.promptImprovementProposal.update({
        where: { id },
        data: {
          ...(payload.evalStatus !== undefined ? { evalStatus: payload.evalStatus } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
          ...(payload.evalNotes !== undefined ? { evalNotes: payload.evalNotes } : {}),
        },
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async evaluateProposal(id: string) {
    const proposal = await this.get(id) as ImprovementProposalRecord | null;
    if (!proposal) {
      return null;
    }

    const parsedProposal = this.parseJsonRecord(proposal.proposalJson);
    const workflowPromptIds = this.parseStringArray(proposal.workflowPromptIds);
    const suggestedAreas = this.parseStringArray(parsedProposal.suggestedAreas);
    const targetBlocks = this.parseStringArray(parsedProposal.targetBlocks);
    const candidateActions = this.parseStringArray(parsedProposal.candidateActions);
    const evaluationHints = this.parseStringArray(parsedProposal.evaluationHints);

    const knownBlockIds = new Set(this.promptCatalog.listBlocks().map((block) => block.id));
    const knownPackIds = new Set(this.promptCatalog.listPacks().map((pack) => pack.id));
    const recognizedAreas = new Set([
      ...knownBlockIds,
      'core-chat',
      'jarvis-core',
      'output-reviewer',
      'repair-rewriter',
      'web-research-grounded',
      'jarvis-briefing',
      'jarvis-advisory',
      'routing-heuristics',
      'skill-assignment-heuristics',
      'reviewer-heuristics',
      'repair-prompts',
      'prompt-blocks',
      'memory-capture-heuristics',
      'advisory-policies',
      'assistant-state',
      'provenance-clarity',
    ]);

    const strengths: string[] = [];
    const issues: string[] = [];
    const blockers: string[] = [];
    let score = 0;

    if (proposal.promptPackId && knownPackIds.has(proposal.promptPackId)) {
      score += 15;
      strengths.push(`Targets existing prompt pack '${proposal.promptPackId}'.`);
    } else {
      blockers.push('Proposal does not point at a valid prompt pack.');
    }

    if (proposal.promptVersionHash) {
      score += 10;
      strengths.push('Includes prompt version provenance.');
    } else {
      issues.push('Prompt version hash is missing.');
    }

    if (proposal.reviewerPromptVersionHash) {
      score += 5;
      strengths.push('Includes reviewer prompt provenance.');
    }

    if (workflowPromptIds.length > 0) {
      score += 10;
      strengths.push(`References workflow prompts: ${workflowPromptIds.join(', ')}.`);
    } else {
      issues.push('No workflow prompt ids were captured with the proposal.');
    }

    const rationaleLength = (proposal.rationale || '').trim().length;
    if (rationaleLength >= 120) {
      score += 15;
      strengths.push('Rationale is specific enough to guide a prompt change.');
    } else if (rationaleLength >= 50) {
      score += 8;
      strengths.push('Rationale is present but could be more concrete.');
      issues.push('Rationale is relatively short for an evaluable prompt change.');
    } else {
      blockers.push('Rationale is too thin to evaluate safely.');
    }

    if (proposal.expectedImprovement?.trim()) {
      score += 10;
      strengths.push('Includes an expected improvement target.');
    } else {
      issues.push('Expected improvement target is missing.');
    }

    if (targetBlocks.length > 0) {
      const invalidBlocks = targetBlocks.filter((blockId) => !knownBlockIds.has(blockId));
      if (invalidBlocks.length === 0) {
        score += 15;
        strengths.push(`Targets concrete prompt blocks: ${targetBlocks.join(', ')}.`);
      } else {
        score += 5;
        issues.push(`Some target blocks are not recognized: ${invalidBlocks.join(', ')}.`);
      }
    } else {
      blockers.push('No target prompt blocks were proposed.');
    }

    if (suggestedAreas.length > 0) {
      const unrecognizedAreas = suggestedAreas.filter((area) => !recognizedAreas.has(area));
      if (unrecognizedAreas.length === 0) {
        score += 10;
        strengths.push('Suggested areas align with known prompt or workflow surfaces.');
      } else {
        issues.push(`Some suggested areas are not recognized: ${unrecognizedAreas.join(', ')}.`);
      }
    } else {
      issues.push('Suggested areas were not captured.');
    }

    if (candidateActions.length >= 2) {
      score += 15;
      strengths.push('Contains concrete candidate actions instead of only a failure label.');
    } else if (candidateActions.length === 1) {
      score += 8;
      issues.push('Only one concrete candidate action was proposed.');
    } else {
      blockers.push('No concrete candidate actions were proposed.');
    }

    if (evaluationHints.length > 0) {
      score += 5;
      strengths.push('Includes evaluation hints for follow-up review.');
    }

    const failureAlignedBlocks = this.expectedBlocksForFailureCategory(proposal.failureCategory);
    if (failureAlignedBlocks.some((blockId) => targetBlocks.includes(blockId))) {
      score += 15;
      strengths.push(`Target blocks align with failure category '${proposal.failureCategory}'.`);
    } else {
      issues.push(`Target blocks do not clearly align with failure category '${proposal.failureCategory}'.`);
    }

    const approved = blockers.length === 0 && score >= 70;
    const evalStatus: ProposalEvalState = approved ? 'approved' : 'rejected';
    const nextStatus = approved ? proposal.status || 'pending' : 'rejected';
    const evalNotes = [
      `score=${score}/100`,
      approved ? 'result=approved-for-human-promotion' : 'result=rejected',
      targetBlocks.length ? `targetBlocks=${targetBlocks.join(', ')}` : 'targetBlocks=none',
      strengths.length ? `strengths=${strengths.join(' | ')}` : '',
      issues.length ? `issues=${issues.join(' | ')}` : '',
      blockers.length ? `blockers=${blockers.join(' | ')}` : '',
    ].filter(Boolean).join('\n');

    this.logger.log(`Evaluated prompt proposal ${proposal.id}: ${evalStatus} (${score}/100)`);
    return this.recordEvaluation(id, {
      evalStatus,
      status: nextStatus,
      evalNotes,
    });
  }

  async evaluatePending(limit = 20) {
    try {
      const proposals = await this.prisma.promptImprovementProposal.findMany({
        where: {
          OR: [
            { evalStatus: 'pending' },
            { evalStatus: null as any },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });

      const results = [];
      for (const proposal of proposals) {
        const evaluated = await this.evaluateProposal(proposal.id);
        if (evaluated) {
          results.push(evaluated);
        }
      }
      return results;
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  private parseJsonRecord(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, any>;
        }
      } catch (error) {
        this.logger.warn(`Failed to parse proposal JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {};
  }

  private parseStringArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map(String).map((entry) => entry.trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map(String).map((entry) => entry.trim()).filter(Boolean);
        }
      } catch {
        return value.split(',').map((entry) => entry.trim()).filter(Boolean);
      }
    }
    return [];
  }

  private expectedBlocksForFailureCategory(failureCategory: string): string[] {
    const category = (failureCategory || '').toLowerCase();
    if (category === 'format') return ['output-reviewer', 'repair-rewriter'];
    if (category === 'grounding' || category === 'source-mismatch' || category === 'unsupported-claim') {
      return ['web-research-grounded', 'output-reviewer', 'repair-rewriter'];
    }
    if (category === 'memory-quality' || category === 'continuity-gap') {
      return ['jarvis-core', 'jarvis-briefing'];
    }
    if (category === 'advisory-quality' || category === 'missed-initiative') {
      return ['jarvis-advisory', 'jarvis-core'];
    }
    if (category === 'provenance-clarity') {
      return ['jarvis-briefing', 'output-reviewer'];
    }
    if (category === 'duplication' || category === 'raw-leakage') {
      return ['output-reviewer', 'repair-rewriter', 'core-chat'];
    }
    return ['web-research-grounded', 'output-reviewer', 'repair-rewriter'];
  }
}
