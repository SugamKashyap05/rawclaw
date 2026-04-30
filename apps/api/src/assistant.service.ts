import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AdvisoryItem, AssistantBriefing, AssistantCommitment, AssistantState } from '@rawclaw/shared';
import { MemoryService } from './memory.service';
import { TasksService } from './tasks/tasks.service';
import { SelfImprovementService } from './self-improvement.service';

const ASSISTANT_STATE_KEY = 'rawclaw.assistant_state';

type IngestResult = {
  memoryEvents: Array<{ layer: 'session' | 'operator' | 'mission'; action: 'captured' | 'updated'; summary: string; entryId?: string }>;
  advisoryEvents: Array<{ category: 'next_step' | 'follow_up' | 'reminder' | 'blocker' | 'briefing'; summary: string; actionState: 'suggested' | 'queued' | 'executed' }>;
};

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly tasksService: TasksService,
    private readonly selfImprovementService: SelfImprovementService,
  ) {}

  private defaultState(): AssistantState {
    return {
      operatorProfile: {
        name: null,
        preferences: [],
        priorities: [],
        notes: [],
      },
      missionSummary: null,
      activeFocus: [],
      commitments: [],
      pendingFollowUps: [],
      advisoryStatus: 'advisory-first',
      updatedAt: new Date().toISOString(),
    };
  }

  private dedupeStrings(values: string[], limit: number): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values || []) {
      const trimmed = String(value || '').trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push(trimmed);
      if (normalized.length >= limit) {
        break;
      }
    }
    return normalized;
  }

  private normalizeCommitments(commitments: AssistantCommitment[]): AssistantCommitment[] {
    const latestBySummary = new Map<string, AssistantCommitment>();
    for (const item of commitments || []) {
      if (!item?.summary) {
        continue;
      }
      const summary = String(item.summary).trim();
      if (!summary) {
        continue;
      }
      const key = summary.toLowerCase();
      const normalized: AssistantCommitment = {
        ...item,
        summary,
        updatedAt: item.updatedAt || item.createdAt,
      };
      const current = latestBySummary.get(key);
      if (!current || new Date(normalized.updatedAt).getTime() >= new Date(current.updatedAt).getTime()) {
        latestBySummary.set(key, normalized);
      }
    }
    return Array.from(latestBySummary.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 12);
  }

  private normalizeState(state: AssistantState): AssistantState {
    return {
      ...state,
      operatorProfile: {
        ...state.operatorProfile,
        preferences: this.dedupeStrings(state.operatorProfile.preferences || [], 8),
        priorities: this.dedupeStrings(state.operatorProfile.priorities || [], 8),
        notes: this.dedupeStrings(state.operatorProfile.notes || [], 12),
      },
      activeFocus: this.dedupeStrings(state.activeFocus || [], 5),
      commitments: this.normalizeCommitments(state.commitments || []),
      pendingFollowUps: this.dedupeStrings(state.pendingFollowUps || [], 8),
      updatedAt: state.updatedAt || new Date().toISOString(),
    };
  }

  async getState(): Promise<AssistantState> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ASSISTANT_STATE_KEY } });
    if (!row) {
      return this.defaultState();
    }

    try {
      const parsed = JSON.parse(row.value) as Partial<AssistantState>;
      const base = this.defaultState();
      return this.normalizeState({
        ...base,
        ...parsed,
        operatorProfile: {
          ...base.operatorProfile,
          ...(parsed.operatorProfile || {}),
          preferences: Array.isArray(parsed.operatorProfile?.preferences) ? parsed.operatorProfile.preferences : [],
          priorities: Array.isArray(parsed.operatorProfile?.priorities) ? parsed.operatorProfile.priorities : [],
          notes: Array.isArray(parsed.operatorProfile?.notes) ? parsed.operatorProfile.notes : [],
        },
        activeFocus: Array.isArray(parsed.activeFocus) ? parsed.activeFocus : [],
        commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
        pendingFollowUps: Array.isArray(parsed.pendingFollowUps) ? parsed.pendingFollowUps : [],
        updatedAt: parsed.updatedAt || base.updatedAt,
      });
    } catch {
      return this.defaultState();
    }
  }

  async updateState(patch: Partial<AssistantState>): Promise<AssistantState> {
    const current = await this.getState();
    const next: AssistantState = {
      ...current,
      ...patch,
      operatorProfile: {
        ...current.operatorProfile,
        ...(patch.operatorProfile || {}),
        preferences: patch.operatorProfile?.preferences ?? current.operatorProfile.preferences,
        priorities: patch.operatorProfile?.priorities ?? current.operatorProfile.priorities,
        notes: patch.operatorProfile?.notes ?? current.operatorProfile.notes,
      },
      activeFocus: patch.activeFocus ?? current.activeFocus,
      commitments: patch.commitments ?? current.commitments,
      pendingFollowUps: patch.pendingFollowUps ?? current.pendingFollowUps,
      updatedAt: new Date().toISOString(),
    };
    const normalized = this.normalizeState(next);

    await this.prisma.appSetting.upsert({
      where: { key: ASSISTANT_STATE_KEY },
      update: { value: JSON.stringify(normalized) },
      create: { key: ASSISTANT_STATE_KEY, value: JSON.stringify(normalized) },
    });

    return normalized;
  }

  async ingestUserTurn(sessionId: string, content: string): Promise<IngestResult> {
    const text = (content || '').trim();
    const lower = text.toLowerCase();
    const current = await this.getState();
    const memoryEvents: IngestResult['memoryEvents'] = [];
    const advisoryEvents: IngestResult['advisoryEvents'] = [];
    const nextState: Partial<AssistantState> = {};

    const sessionMemoryMatch = text.match(/remember this(?: for later)?(?: in this chat)?:?\s*(.+?)(?:[.?!]|$)/i);
    if (sessionMemoryMatch?.[1]) {
      const entry = await this.memoryService.add({
        content: sessionMemoryMatch[1].trim(),
        collection: 'session',
        source: `session:${sessionId}`,
        tags: ['assistant', 'session-memory'],
      });
      memoryEvents.push({
        layer: 'session',
        action: 'captured',
        summary: 'Captured a session-scoped fact for continuity.',
        entryId: entry.id,
      });
    }

    const nameMatch = text.match(/\b(?:my name is|call me)\s+([A-Za-z][A-Za-z\s'-]{1,40})/i);
    if (nameMatch?.[1]) {
      const name = nameMatch[1].trim();
      nextState.operatorProfile = {
        ...current.operatorProfile,
        name,
      };
      const entry = await this.memoryService.add({
        content: `Operator preferred name: ${name}`,
        collection: 'operator',
        source: 'assistant-state',
        tags: ['assistant', 'operator-profile', 'name'],
      });
      memoryEvents.push({
        layer: 'operator',
        action: 'updated',
        summary: `Updated operator profile name to ${name}.`,
        entryId: entry.id,
      });
    }

    const preferenceMatch = text.match(/\b(?:i prefer|my preference is|i like)\s+(.+?)(?:[.?!]|$)/i);
    if (preferenceMatch?.[1]) {
      const preference = preferenceMatch[1].trim().replace(/[.?!]+$/, '');
      const preferences = Array.from(new Set([...current.operatorProfile.preferences, preference]));
      nextState.operatorProfile = {
        ...(nextState.operatorProfile || current.operatorProfile),
        preferences,
      };
      const entry = await this.memoryService.add({
        content: `Operator preference: ${preference}`,
        collection: 'operator',
        source: 'assistant-state',
        tags: ['assistant', 'operator-profile', 'preference'],
      });
      memoryEvents.push({
        layer: 'operator',
        action: 'updated',
        summary: 'Added an operator preference to durable memory.',
        entryId: entry.id,
      });
    }

    const missionMatch = text.match(/\b(?:we are working on|our mission is|the mission is|the goal is|i am working on)\s+(.+?)(?:[.?!]|$)/i);
    if (missionMatch?.[1]) {
      const mission = missionMatch[1].trim().replace(/[.?!]+$/, '');
      nextState.missionSummary = mission;
      nextState.activeFocus = Array.from(new Set([mission, ...current.activeFocus])).slice(0, 5);
      const entry = await this.memoryService.add({
        content: `Mission summary: ${mission}`,
        collection: 'mission',
        source: 'assistant-state',
        tags: ['assistant', 'mission'],
      });
      memoryEvents.push({
        layer: 'mission',
        action: 'updated',
        summary: 'Updated the active mission summary.',
        entryId: entry.id,
      });
    }

    const remindMatch = text.match(/\bremind me to\s+(.+?)(?:[.?!]|$)/i);
    if (remindMatch?.[1]) {
      const summary = remindMatch[1].trim().replace(/[.?!]+$/, '');
      const now = new Date().toISOString();
      const existing = current.commitments.find((item) => item.summary.trim().toLowerCase() === summary.toLowerCase());
      const commitment: AssistantCommitment = existing
        ? {
            ...existing,
            status: 'active',
            sourceSessionId: sessionId,
            updatedAt: now,
          }
        : {
            id: `commitment-${Date.now()}`,
            summary,
            status: 'active',
            sourceSessionId: sessionId,
            createdAt: now,
            updatedAt: now,
          };
      nextState.commitments = [commitment, ...current.commitments.filter((item) => item.summary.trim().toLowerCase() !== summary.toLowerCase())].slice(0, 15);
      advisoryEvents.push({
        category: 'reminder',
        summary: `Tracking reminder: ${summary}`,
        actionState: 'queued',
      });
    }

    if (lower.includes('next step') || lower.includes('what should we do next')) {
      advisoryEvents.push({
        category: 'next_step',
        summary: 'User is asking for immediate advisory guidance.',
        actionState: 'suggested',
      });
    }

    if (Object.keys(nextState).length > 0) {
      await this.updateState(nextState);
    }

    return { memoryEvents, advisoryEvents };
  }

  async buildTurnAdvisories(sessionId: string, latestUserContent: string, assistantContent: string, assistantLane: string): Promise<AdvisoryItem[]> {
    const advisories: AdvisoryItem[] = [];
    const now = new Date().toISOString();
    const lowerUser = (latestUserContent || '').toLowerCase();
    const lowerAssistant = (assistantContent || '').toLowerCase();

    const push = (category: AdvisoryItem['category'], summary: string) => {
      advisories.push({
        id: `${category}-${Date.now()}-${advisories.length}`,
        category,
        summary,
        actionState: 'suggested',
        sourceSessionId: sessionId,
        createdAt: now,
      });
    };

    if (assistantLane === 'research' && !lowerAssistant.includes('i could not verify')) {
      push('next_step', 'Offer to save the key findings into mission memory or spin them into a follow-up task.');
    }
    if (assistantLane === 'tasking') {
      push('follow_up', 'Offer a follow-up reminder or monitoring step for the created task or action item.');
    }
    if (assistantLane === 'conversation' && (lowerUser.includes('plan') || lowerUser.includes('strategy'))) {
      push('next_step', 'Offer a short next-actions list to keep the conversation moving.');
    }
    if (lowerAssistant.includes('i could not verify') || lowerAssistant.includes('tool failed')) {
      push('blocker', 'Call out the missing evidence or tool limitation and suggest a safe retry path.');
    }

    return advisories.slice(0, 3);
  }

  async listAdvisories(): Promise<AdvisoryItem[]> {
    const state = await this.getState();
    const recentRuns = await this.tasksService.listRecentRuns();
    const proposals = await this.selfImprovementService.list();
    const now = new Date().toISOString();

    const advisories: AdvisoryItem[] = state.pendingFollowUps.map((item, index) => ({
      id: `follow-up-${index}`,
      category: 'follow_up',
      summary: item,
      actionState: 'suggested',
      createdAt: now,
    }));

    if (state.commitments.some((item) => item.status === 'active')) {
      advisories.push({
        id: 'commitments-active',
        category: 'reminder',
        summary: 'You have active assistant commitments that may need review.',
        actionState: 'queued',
        createdAt: now,
      });
    }

    if (recentRuns.some((run: any) => run.status === 'queued' || run.status === 'running')) {
      advisories.push({
        id: 'task-runs-active',
        category: 'follow_up',
        summary: 'There are active background runs worth monitoring from the command center.',
        actionState: 'suggested',
        createdAt: now,
      });
    }

    if (proposals.some((proposal: any) => (proposal.evalStatus || 'pending') === 'pending')) {
      advisories.push({
        id: 'pending-proposals',
        category: 'briefing',
        summary: 'Learning proposals are waiting for evaluation or promotion review.',
        actionState: 'suggested',
        createdAt: now,
      });
    }

    return advisories.slice(0, 6);
  }

  async generateBriefing(): Promise<AssistantBriefing> {
    const state = await this.getState();
    const advisories = await this.listAdvisories();
    const pendingCommitments = state.commitments.filter((item) => item.status === 'active');
    const summaryParts = [
      state.missionSummary ? `Mission: ${state.missionSummary}.` : 'Mission summary is not set yet.',
      state.activeFocus.length ? `Active focus: ${state.activeFocus.join(', ')}.` : 'No active focus areas are pinned.',
      pendingCommitments.length ? `${pendingCommitments.length} active commitment(s) are being tracked.` : 'No active commitments are queued.',
      advisories.length ? `${advisories.length} advisory suggestion(s) are available.` : 'No advisory suggestions are queued right now.',
    ];

    return {
      generatedAt: new Date().toISOString(),
      summary: summaryParts.join(' '),
      missionSummary: state.missionSummary || null,
      activeFocus: state.activeFocus,
      pendingCommitments,
      advisories,
    };
  }

  formatStateForPrompt(state: AssistantState): string {
    const parts = [
      state.operatorProfile.name ? `Operator: ${state.operatorProfile.name}` : '',
      state.operatorProfile.preferences.length ? `Preferences: ${state.operatorProfile.preferences.join('; ')}` : '',
      state.missionSummary ? `Mission Summary: ${state.missionSummary}` : '',
      state.activeFocus.length ? `Active Focus: ${state.activeFocus.join('; ')}` : '',
      state.commitments.filter((item) => item.status === 'active').length
        ? `Open Commitments: ${state.commitments.filter((item) => item.status === 'active').map((item) => item.summary).join('; ')}`
        : '',
      state.pendingFollowUps.length ? `Pending Follow-Ups: ${state.pendingFollowUps.join('; ')}` : '',
      state.advisoryStatus ? `Autonomy Mode: ${state.advisoryStatus}` : '',
    ].filter(Boolean);

    return parts.join('\n');
  }
}
