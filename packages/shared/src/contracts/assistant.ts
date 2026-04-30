export type AssistantLane = 'conversation' | 'research' | 'memory' | 'tasking' | 'advisory';

export type AssistantConfidenceState = 'grounded' | 'limited' | 'provider-outage' | 'draft' | 'direct';

export interface AssistantCommitment {
  id: string;
  summary: string;
  status: 'active' | 'completed' | 'cancelled';
  dueAt?: string | null;
  sourceSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantState {
  operatorProfile: {
    name?: string | null;
    preferences: string[];
    priorities: string[];
    notes: string[];
  };
  missionSummary?: string | null;
  activeFocus: string[];
  commitments: AssistantCommitment[];
  pendingFollowUps: string[];
  advisoryStatus?: string | null;
  updatedAt: string;
}

export interface AdvisoryItem {
  id: string;
  category: 'next_step' | 'follow_up' | 'reminder' | 'blocker' | 'briefing';
  summary: string;
  actionState: 'suggested' | 'queued' | 'executed';
  sourceSessionId?: string | null;
  createdAt: string;
}

export interface AssistantBriefing {
  generatedAt: string;
  summary: string;
  missionSummary?: string | null;
  activeFocus: string[];
  pendingCommitments: AssistantCommitment[];
  advisories: AdvisoryItem[];
}
