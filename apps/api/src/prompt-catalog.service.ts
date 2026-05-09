import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { AssistantLane, ChatNluFrame } from '@rawclaw/shared';

type PromptBlockScope = 'core' | 'workflow' | 'review' | 'repair';

export interface PromptBlock {
  id: string;
  purpose: string;
  scope: PromptBlockScope;
  body: string;
  tags?: string[];
  order?: number;
}

export interface PromptPack {
  id: string;
  purpose: string;
  scope: 'pack';
  coreBlockIds: string[];
  defaultWorkflowIds?: string[];
  reviewBlockId?: string;
  repairBlockId?: string;
  tags?: string[];
}

export interface PromptProvenance {
  promptPackId: string;
  promptVersionHash: string;
  reviewerPromptVersionHash?: string;
  workflowPromptIds: string[];
  blockIds: string[];
  assistantLane?: AssistantLane;
}

export const PromptSectionId = {
  SYSTEM_BASE: 'SYSTEM_BASE',
  BASELINE_PERSONA: 'BASELINE_PERSONA',
  ACTIVE_LANE: 'ACTIVE_LANE',
  NLU_ROUTING_CONTEXT: 'NLU_ROUTING_CONTEXT',
  TOOL_GUIDANCE: 'TOOL_GUIDANCE',
  WEB_RESEARCH_WORKFLOW: 'WEB_RESEARCH_WORKFLOW',
  MEMORY_CONTEXT: 'MEMORY_CONTEXT',
  AGENT_IDENTITY: 'AGENT_IDENTITY',
  SELECTED_TEXT_CONTEXT: 'SELECTED_TEXT_CONTEXT',
} as const;

export type PromptSectionId = (typeof PromptSectionId)[keyof typeof PromptSectionId];

export interface PromptSection {
  sectionId: PromptSectionId;
  label: string;
  content: string;
}

interface ComposePromptOptions {
  systemContext: string;
  workspaceFiles: { soul?: string; user?: string; memory?: string; tools?: string };
  toolGuidance?: string | null;
  skillGuidance?: string | null;
  selectedAgent?: {
    name?: string;
    systemPrompt?: string | null;
    promptPackId?: string | null;
    promptOverlay?: string | null;
    skills?: string[];
  } | null;
  activeAgentSkillsText?: string | null;
  latestUserContent?: string;
  reviewEnabled?: boolean;
  editPrompt?: string | null;
  assistantStateText?: string | null;
  assistantLane?: AssistantLane | null;
  nluFrame?: ChatNluFrame | null;
}

@Injectable()
export class PromptCatalogService {
  private readonly promptsRoot = this.resolvePromptsRoot();

  private resolvePromptsRoot(): string {
    const candidates = [
      resolve(process.cwd(), 'prompts'),
      resolve(process.cwd(), '..', 'prompts'),
      resolve(process.cwd(), '..', '..', 'prompts'),
      resolve(__dirname, '..', '..', '..', 'prompts'),
      resolve(__dirname, '..', '..', '..', '..', 'prompts'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  private readJsonFile<T>(filePath: string): T {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  }

  private collectJsonFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        results.push(...this.collectJsonFiles(full));
      } else if (entry.endsWith('.json')) {
        results.push(full);
      }
    }
    return results;
  }

  private loadBlocks(): PromptBlock[] {
    const dirs = ['core', 'workflows', 'review', 'repair'].map((dir) => join(this.promptsRoot, dir));
    return dirs
      .flatMap((dir) => this.collectJsonFiles(dir))
      .map((filePath) => this.readJsonFile<PromptBlock>(filePath))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
  }

  private baselinePersonaFragment(): string {
    return [
      'You are RawClaw.',
      'Use a warm, grounded coworker voice that stays calm, capable, and clear across model changes.',
      'Be explicit about what you did when it helps the user follow your work, especially around tools, memory, fallbacks, and uncertainty.',
      'State limitations plainly, avoid exaggerated capability claims, and prefer honest uncertainty over bluffing.',
      'This identity contract controls register, truthfulness, uncertainty handling, and coworker tone.',
      'It does not override safety constraints, workflow guidance, tool rules, or task-specific execution instructions.',
    ].join(' ');
  }

  private loadPacks(): PromptPack[] {
    const dir = join(this.promptsRoot, 'packs');
    return this.collectJsonFiles(dir)
      .map((filePath) => this.readJsonFile<PromptPack>(filePath))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  listPacks(): PromptPack[] {
    return this.loadPacks();
  }

  listBlocks(): PromptBlock[] {
    return this.loadBlocks();
  }

  getPack(id?: string | null): PromptPack {
    const resolvedId = id || 'rawclaw-default';
    const pack = this.loadPacks().find((entry) => entry.id === resolvedId);
    if (!pack) {
      throw new NotFoundException(`Prompt pack '${resolvedId}' not found`);
    }
    return pack;
  }

  getBlock(id: string): PromptBlock {
    const block = this.loadBlocks().find((entry) => entry.id === id);
    if (!block) {
      throw new NotFoundException(`Prompt block '${id}' not found`);
    }
    return block;
  }

  getReviewTemplate(id = 'output-reviewer'): string {
    return this.getBlock(id).body;
  }

  getRepairTemplate(id = 'repair-rewriter'): string {
    return this.getBlock(id).body;
  }

  private shouldAttachWebWorkflow(text: string, nluFrame?: ChatNluFrame | null): boolean {
    if (nluFrame && nluFrame.confidence >= 0.55) {
      return nluFrame.intent === 'research' || nluFrame.routingFallbackReason === 'research_followup';
    }

    const lower = (text || '').toLowerCase();
    return [
      'search the web',
      'latest',
      'current',
      'news',
      'fetch',
      'official page',
      'standings',
      'points table',
      'openai api',
      'spacex',
      'starship',
      'ipl',
      'research brief',
      'sources used',
      'research notes',
    ].some((token) => lower.includes(token));
  }

  resolveAssistantLane(latestUserContent: string): AssistantLane {
    const lower = (latestUserContent || '').toLowerCase();
    if (
      ['identify yourself', 'who are you', 'introduce yourself', 'what system are you part of', 'how do you operate'].some((token) =>
        lower.includes(token),
      )
    ) {
      return 'conversation';
    }
    if (['remember', 'what do you know about me', 'memory', 'tracking'].some((token) => lower.includes(token))) {
      return 'memory';
    }
    if (['create a task', 'create task', 'task', 'remind me', 'follow up', 'monitor'].some((token) => lower.includes(token))) {
      return 'tasking';
    }
    if (this.shouldAttachWebWorkflow(latestUserContent)) {
      return 'research';
    }
    if (['briefing', 'operator briefing', 'status update', 'what am i tracking', 'next step', 'recommend'].some((token) => lower.includes(token))) {
      return 'advisory';
    }
    return 'conversation';
  }

  resolveWorkflowIds(
    latestUserContent: string,
    reviewEnabled: boolean,
    promptPackId?: string | null,
    assistantLane?: AssistantLane | null,
    nluFrame?: ChatNluFrame | null,
  ): string[] {
    const workflowIds: string[] = [];
    if (this.shouldAttachWebWorkflow(latestUserContent, nluFrame)) {
      workflowIds.push('web-research-grounded');
    }
    const isJarvisPack = (promptPackId || '').toLowerCase().includes('jarvis');
    if (isJarvisPack) {
      workflowIds.push('jarvis-advisory');
      const lower = (latestUserContent || '').toLowerCase();
      if (
        assistantLane === 'advisory'
        || assistantLane === 'memory'
        || ['briefing', 'brief', 'status', 'tracking', 'summary'].some((token) => lower.includes(token))
      ) {
        workflowIds.push('jarvis-briefing');
      }
    }
    if (reviewEnabled) {
      workflowIds.push('output-reviewer');
      workflowIds.push('repair-rewriter');
    }
    return Array.from(new Set(workflowIds));
  }

  private sanitizeNluValue(value: string): string {
    return String(value || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  private buildNluRoutingContext(nluFrame?: ChatNluFrame | null): string | null {
    if (!nluFrame) {
      return null;
    }

    const cleanConversation =
      nluFrame.intent === 'conversation' &&
      nluFrame.confidence >= 0.75 &&
      !nluFrame.secondaryIntents?.length &&
      !nluFrame.entities?.length &&
      !nluFrame.routingFallbackReason &&
      !nluFrame.clarificationFailed &&
      !nluFrame.clarificationQuestion;
    if (cleanConversation) {
      return null;
    }

    const lines = [
      `Intent: ${nluFrame.intent}`,
      `Lane: ${nluFrame.recommendedLane}`,
      `Confidence: ${nluFrame.confidenceState} (${nluFrame.confidence.toFixed(2)})`,
      `Source: ${nluFrame.source}`,
    ];
    if (nluFrame.routingFallbackReason) {
      lines.push(`Fallback reason: ${nluFrame.routingFallbackReason}`);
    }
    if (nluFrame.clarificationFailed) {
      lines.push('Clarification: failed; continue conversationally and let the user try again.');
    } else if (nluFrame.clarificationQuestion) {
      lines.push(`Clarification question: ${this.sanitizeNluValue(nluFrame.clarificationQuestion)}`);
    }
    if (nluFrame.secondaryIntents?.length) {
      lines.push(`Secondary intents: ${nluFrame.secondaryIntents.map((item) => `${item.intent} (${item.confidence.toFixed(2)})`).join(', ')}`);
    }
    const entities = (nluFrame.entities || [])
      .slice(0, 5)
      .map((entity) => `${entity.type}=${this.sanitizeNluValue(entity.value)}`)
      .filter(Boolean);
    if (entities.length) {
      lines.push(`Important entities: ${entities.join('; ')}`);
    }

    return lines.join('\n');
  }

  private buildWorkspaceSection(workspaceFiles: ComposePromptOptions['workspaceFiles']): PromptSection[] {
    const sections: PromptSection[] = [];
    if (workspaceFiles.user || workspaceFiles.soul) {
      sections.push(this.makeSection(
        PromptSectionId.AGENT_IDENTITY,
        'Identity',
        workspaceFiles.user ? `User Context:\n${workspaceFiles.user}` : '',
        workspaceFiles.soul ? `Soul / Guidelines:\n${workspaceFiles.soul}` : '',
      ));
    }
    if (workspaceFiles.memory) {
      sections.push(this.makeSection(PromptSectionId.MEMORY_CONTEXT, 'Persistent Memory', workspaceFiles.memory));
    }
    if (workspaceFiles.tools) {
      sections.push(this.makeSection(PromptSectionId.TOOL_GUIDANCE, 'Tool Guidelines', workspaceFiles.tools));
    }
    return sections.filter((section) => section.content.length > 0);
  }

  private makeSection(sectionId: PromptSectionId, label: string, ...parts: Array<string | null | undefined>): PromptSection {
    return {
      sectionId,
      label,
      content: parts.map((part) => part?.trim()).filter(Boolean).join('\n\n'),
    };
  }

  private renderPromptSections(sections: PromptSection[]): string {
    return sections
      .filter((section) => section.content.trim())
      .map((section) => `## ${section.label}\n${section.content.trim()}`)
      .join('\n\n')
      .trim();
  }

  buildEffectiveAgentPrompt(agent: { promptPackId?: string | null; promptOverlay?: string | null; systemPrompt?: string | null; name?: string }): { effectiveSystemPrompt: string; promptPackId: string | null } {
    const pack = agent.promptPackId ? this.getPack(agent.promptPackId) : null;
    const parts: string[] = [];
    if (pack) {
      parts.push(...pack.coreBlockIds.map((id) => this.getBlock(id).body));
    }
    if (agent.promptOverlay?.trim()) {
      parts.push(agent.promptOverlay.trim());
    }
    if (agent.systemPrompt?.trim()) {
      parts.push(agent.systemPrompt.trim());
    }
    return {
      effectiveSystemPrompt: parts.filter(Boolean).join('\n\n').trim(),
      promptPackId: pack?.id || null,
    };
  }

  composeChatPrompt(options: ComposePromptOptions): { prompt: string; sections: PromptSection[]; templates: { reviewer?: string; repair?: string }; provenance: PromptProvenance } {
    const pack = this.getPack(options.selectedAgent?.promptPackId || 'rawclaw-default');
    const assistantLane = options.assistantLane || this.resolveAssistantLane(options.latestUserContent || '');
    const workflowIds = this.resolveWorkflowIds(options.latestUserContent || '', !!options.reviewEnabled, pack.id, assistantLane, options.nluFrame);
    const coreBlocks = pack.coreBlockIds.map((id) => this.getBlock(id));
    const workflowBlocks = workflowIds
      .filter((id) => ['output-reviewer', 'repair-rewriter'].includes(id) === false)
      .map((id) => this.getBlock(id));

    const sections: PromptSection[] = [];
    sections.push(this.makeSection(PromptSectionId.SYSTEM_BASE, 'RawClaw System Context', options.systemContext));
    sections.push(...this.buildWorkspaceSection(options.workspaceFiles));
    if (options.assistantStateText?.trim()) {
      sections.push(this.makeSection(PromptSectionId.MEMORY_CONTEXT, 'Assistant State', options.assistantStateText));
    }
    sections.push(this.makeSection(PromptSectionId.SYSTEM_BASE, 'Prompt Pack', ...coreBlocks.map((block) => block.body)));
    if (workflowBlocks.length) {
      sections.push(this.makeSection(PromptSectionId.WEB_RESEARCH_WORKFLOW, 'Active Workflow Guidance', ...workflowBlocks.map((block) => block.body)));
    }
    sections.push(this.makeSection(PromptSectionId.ACTIVE_LANE, 'Active Assistant Lane', `You are currently operating in the '${assistantLane}' lane.`));
    const nluRoutingContext = this.buildNluRoutingContext(options.nluFrame);
    if (nluRoutingContext) {
      sections.push(this.makeSection(PromptSectionId.NLU_ROUTING_CONTEXT, 'NLU Routing Context', nluRoutingContext));
    }
    if (options.selectedAgent?.name) {
      sections.push(this.makeSection(PromptSectionId.AGENT_IDENTITY, 'Active Agent', `You are now operating as the ${options.selectedAgent.name} agent.`));
    }
    if (options.selectedAgent?.promptOverlay?.trim()) {
      sections.push(this.makeSection(PromptSectionId.AGENT_IDENTITY, 'Agent Overlay', options.selectedAgent.promptOverlay));
    }
    if (options.selectedAgent?.systemPrompt?.trim()) {
      sections.push(this.makeSection(PromptSectionId.AGENT_IDENTITY, 'Legacy Agent Prompt', options.selectedAgent.systemPrompt));
    }
    if (options.activeAgentSkillsText?.trim()) {
      sections.push(this.makeSection(PromptSectionId.TOOL_GUIDANCE, 'Active Agent Skills', options.activeAgentSkillsText));
    }
    if (options.toolGuidance?.trim()) {
      sections.push(this.makeSection(PromptSectionId.TOOL_GUIDANCE, 'Tool Guidance', options.toolGuidance));
    }
    if (options.skillGuidance?.trim()) {
      sections.push(this.makeSection(PromptSectionId.TOOL_GUIDANCE, 'Skill Guidance', options.skillGuidance));
    }
    if (options.editPrompt?.trim()) {
      sections.push(this.makeSection(PromptSectionId.SELECTED_TEXT_CONTEXT, 'Edit Request', options.editPrompt));
    }
    sections.push(this.makeSection(PromptSectionId.BASELINE_PERSONA, 'RawClaw Identity Contract', this.baselinePersonaFragment()));

    const prompt = this.renderPromptSections(sections);
    const reviewBlockId = pack.reviewBlockId || 'output-reviewer';
    const repairBlockId = pack.repairBlockId || 'repair-rewriter';
    const reviewerTemplate = this.getReviewTemplate(reviewBlockId);
    const repairTemplate = this.getRepairTemplate(repairBlockId);
    const provenanceBody = JSON.stringify({
      pack: pack.id,
      coreBlocks: coreBlocks.map((block) => ({ id: block.id, body: block.body })),
      baselinePersona: this.baselinePersonaFragment(),
      workflows: workflowBlocks.map((block) => ({ id: block.id, body: block.body })),
      overlay: options.selectedAgent?.promptOverlay || '',
      legacy: options.selectedAgent?.systemPrompt || '',
      toolGuidance: options.toolGuidance || '',
      skillGuidance: options.skillGuidance || '',
      activeAgentSkillsText: options.activeAgentSkillsText || '',
      editPrompt: options.editPrompt || '',
      nlu: nluRoutingContext || '',
    });

    return {
      prompt,
      sections,
      templates: {
        reviewer: reviewerTemplate,
        repair: repairTemplate,
      },
      provenance: {
        promptPackId: pack.id,
        promptVersionHash: createHash('sha256').update(provenanceBody).digest('hex').slice(0, 16),
        reviewerPromptVersionHash: createHash('sha256').update(reviewerTemplate).digest('hex').slice(0, 16),
        workflowPromptIds: workflowIds.filter((id) => id !== 'output-reviewer' && id !== 'repair-rewriter'),
        blockIds: [...coreBlocks.map((block) => block.id), ...workflowBlocks.map((block) => block.id)],
        assistantLane,
      },
    };
  }
}
