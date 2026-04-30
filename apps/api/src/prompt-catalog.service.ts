import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { AssistantLane } from '@rawclaw/shared';

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

  private shouldAttachWebWorkflow(text: string): boolean {
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

  resolveWorkflowIds(latestUserContent: string, reviewEnabled: boolean, promptPackId?: string | null, assistantLane?: AssistantLane | null): string[] {
    const workflowIds: string[] = [];
    if (this.shouldAttachWebWorkflow(latestUserContent)) {
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

  private buildWorkspaceSection(workspaceFiles: ComposePromptOptions['workspaceFiles']): string[] {
    const sections: string[] = [];
    if (workspaceFiles.user || workspaceFiles.soul) {
      sections.push(
        '## Identity',
        workspaceFiles.user ? `User Context:\n${workspaceFiles.user}` : '',
        workspaceFiles.soul ? `Soul / Guidelines:\n${workspaceFiles.soul}` : '',
      );
    }
    if (workspaceFiles.memory) {
      sections.push('## Persistent Memory', workspaceFiles.memory);
    }
    if (workspaceFiles.tools) {
      sections.push('## Tool Guidelines', workspaceFiles.tools);
    }
    return sections.filter(Boolean);
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

  composeChatPrompt(options: ComposePromptOptions): { prompt: string; templates: { reviewer?: string; repair?: string }; provenance: PromptProvenance } {
    const pack = this.getPack(options.selectedAgent?.promptPackId || 'rawclaw-default');
    const assistantLane = options.assistantLane || this.resolveAssistantLane(options.latestUserContent || '');
    const workflowIds = this.resolveWorkflowIds(options.latestUserContent || '', !!options.reviewEnabled, pack.id, assistantLane);
    const coreBlocks = pack.coreBlockIds.map((id) => this.getBlock(id));
    const workflowBlocks = workflowIds
      .filter((id) => ['output-reviewer', 'repair-rewriter'].includes(id) === false)
      .map((id) => this.getBlock(id));

    const sections: string[] = [];
    sections.push('## RawClaw System Context', options.systemContext.trim());
    sections.push(...this.buildWorkspaceSection(options.workspaceFiles));
    if (options.assistantStateText?.trim()) {
      sections.push('## Assistant State', options.assistantStateText.trim());
    }
    sections.push('## Prompt Pack', ...coreBlocks.map((block) => block.body.trim()));
    if (workflowBlocks.length) {
      sections.push('## Active Workflow Guidance', ...workflowBlocks.map((block) => block.body.trim()));
    }
    sections.push(`## Active Assistant Lane\nYou are currently operating in the '${assistantLane}' lane.`);
    if (options.selectedAgent?.name) {
      sections.push(`## Active Agent\nYou are now operating as the ${options.selectedAgent.name} agent.`);
    }
    if (options.selectedAgent?.promptOverlay?.trim()) {
      sections.push('## Agent Overlay', options.selectedAgent.promptOverlay.trim());
    }
    if (options.selectedAgent?.systemPrompt?.trim()) {
      sections.push('## Legacy Agent Prompt', options.selectedAgent.systemPrompt.trim());
    }
    if (options.activeAgentSkillsText?.trim()) {
      sections.push('## Active Agent Skills', options.activeAgentSkillsText.trim());
    }
    if (options.toolGuidance?.trim()) {
      sections.push('## Tool Guidance', options.toolGuidance.trim());
    }
    if (options.skillGuidance?.trim()) {
      sections.push('## Skill Guidance', options.skillGuidance.trim());
    }
    if (options.editPrompt?.trim()) {
      sections.push('## Edit Request', options.editPrompt.trim());
    }

    const prompt = sections.filter(Boolean).join('\n\n').trim();
    const reviewBlockId = pack.reviewBlockId || 'output-reviewer';
    const repairBlockId = pack.repairBlockId || 'repair-rewriter';
    const reviewerTemplate = this.getReviewTemplate(reviewBlockId);
    const repairTemplate = this.getRepairTemplate(repairBlockId);
    const provenanceBody = JSON.stringify({
      pack: pack.id,
      coreBlocks: coreBlocks.map((block) => ({ id: block.id, body: block.body })),
      workflows: workflowBlocks.map((block) => ({ id: block.id, body: block.body })),
      overlay: options.selectedAgent?.promptOverlay || '',
      legacy: options.selectedAgent?.systemPrompt || '',
      toolGuidance: options.toolGuidance || '',
      skillGuidance: options.skillGuidance || '',
      activeAgentSkillsText: options.activeAgentSkillsText || '',
      editPrompt: options.editPrompt || '',
    });

    return {
      prompt,
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
