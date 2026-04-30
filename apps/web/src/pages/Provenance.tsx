import { ReactNode, useEffect, useMemo, useState } from 'react';
import { AdvisoryEvent, MemoryEvent, ProvenanceTrace as ProvenanceTraceType, ReviewEvent, WorkflowState } from '@rawclaw/shared';
import {
  FiActivity,
  FiAlertCircle,
  FiBookOpen,
  FiClock,
  FiLayers,
  FiRefreshCw,
  FiShield,
  FiTarget,
} from 'react-icons/fi';
import { api } from '../lib/api';
import { ProvenanceTrace } from '../components/chat/ProvenanceTrace';

type SessionMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt?: string | Date;
  modelId?: string;
  durationMs?: number;
  promptPackId?: string;
  promptVersionHash?: string;
  reviewerPromptVersionHash?: string;
  workflowPromptIds?: string[];
  runIds?: string[];
  reviewEvents?: ReviewEvent[];
  workflowState?: WorkflowState;
  provenanceTrace?: ProvenanceTraceType | null;
  memoryEvents?: MemoryEvent[];
  advisoryEvents?: AdvisoryEvent[];
};

type SessionRecord = {
  id: string;
  title?: string | null;
  updatedAt?: string | Date;
  messages: SessionMessage[];
};

type ImprovementProposal = {
  id: string;
  sessionId?: string | null;
  failureCategory: string;
  promptPackId?: string | null;
  promptVersionHash?: string | null;
  reviewerPromptVersionHash?: string | null;
  rationale: string;
  expectedImprovement?: string | null;
  status?: string | null;
  evalStatus?: string | null;
  evalNotes?: string | null;
  workflowPromptIds?: string | string[] | null;
  createdAt: string;
};

type TaskRun = {
  id: string;
  sessionId?: string | null;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  promptPackId?: string | null;
  promptVersionHash?: string | null;
  reviewerPromptVersionHash?: string | null;
  workflowPromptIds?: string | null;
  selectedAgent?: string | null;
};

type AssistantTurn = SessionMessage & {
  id: string;
};

function latestAssistant(session: SessionRecord): AssistantTurn | null {
  const assistants = session.messages.filter((message) => message.role === 'assistant' && message.id) as AssistantTurn[];
  return assistants.length ? assistants[assistants.length - 1] : null;
}

function reviewStatus(turn: AssistantTurn | null): 'approved' | 'rejected' | 'pending' | 'not-reviewed' {
  if (!turn?.reviewEvents?.length) {
    return turn?.workflowState?.reviewEnabled ? 'pending' : 'not-reviewed';
  }
  const last = turn.reviewEvents[turn.reviewEvents.length - 1];
  if (last?.approved === true) return 'approved';
  if (last?.approved === false) return 'rejected';
  return 'pending';
}

function workflowSummary(turn: AssistantTurn | null): string {
  const workflowIds = turn?.workflowState?.workflowPromptIds || turn?.workflowPromptIds || [];
  if (!workflowIds.length) return 'General';
  return workflowIds.join(', ');
}

export default function Provenance() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [proposals, setProposals] = useState<ImprovementProposal[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionRes, proposalRes, runRes] = await Promise.all([
        api.get<SessionRecord[]>('/chat/sessions'),
        api.get<ImprovementProposal[]>('/self-improvement/proposals'),
        api.get<TaskRun[]>('/tasks/runs/recent'),
      ]);
      const nextSessions = sessionRes.data || [];
      setSessions(nextSessions);
      setProposals(proposalRes.data || []);
      setRuns(runRes.data || []);

      if (!selectedSessionId && nextSessions.length) {
        const first = nextSessions[0];
        setSelectedSessionId(first.id);
        setSelectedTurnId(latestAssistant(first)?.id || null);
      }
    } catch (loadError) {
      console.error('Failed to load control room data', loadError);
      setError('Unable to load operator control room data right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  );

  const assistantTurns = useMemo(
    () => (selectedSession?.messages.filter((message) => message.role === 'assistant' && message.id) as AssistantTurn[]) || [],
    [selectedSession],
  );

  const selectedTurn = useMemo(() => {
    if (!assistantTurns.length) return null;
    return assistantTurns.find((turn) => turn.id === selectedTurnId) || assistantTurns[assistantTurns.length - 1];
  }, [assistantTurns, selectedTurnId]);

  const relatedProposals = useMemo(() => {
    if (!selectedSession) return [];
    return proposals.filter((proposal) => {
      if (proposal.sessionId && proposal.sessionId === selectedSession.id) return true;
      if (selectedTurn?.promptVersionHash && proposal.promptVersionHash === selectedTurn.promptVersionHash) return true;
      return false;
    });
  }, [proposals, selectedSession, selectedTurn]);

  const relatedRuns = useMemo(() => {
    if (!selectedSession) return [];
    return runs.filter((run) => run.sessionId === selectedSession.id);
  }, [runs, selectedSession]);

  const stats = useMemo(() => {
    const sessionApprovals = sessions
      .map((session) => latestAssistant(session))
      .filter(Boolean)
      .map((turn) => reviewStatus(turn));
    return {
      monitoredSessions: sessions.length,
      reviewApproved: sessionApprovals.filter((status) => status === 'approved').length,
      reviewRejected: sessionApprovals.filter((status) => status === 'rejected').length,
      pendingProposals: proposals.filter((proposal) => (proposal.evalStatus || 'pending') === 'pending').length,
      activeRuns: runs.filter((run) => run.status === 'running' || run.status === 'queued').length,
    };
  }, [sessions, proposals, runs]);

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Operator Control Room</h1>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '920px', lineHeight: 1.6 }}>
              Inspect prompt provenance, reviewer decisions, proposal history, and workflow execution state across recent RawClaw runs.
            </p>
          </div>
          <button className="btn-ghost" onClick={() => void load()} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FiRefreshCw /> {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem' }}>
          <MetricCard label="Monitored Sessions" value={String(stats.monitoredSessions)} />
          <MetricCard label="Review Approved" value={String(stats.reviewApproved)} tone="good" />
          <MetricCard label="Review Rejected" value={String(stats.reviewRejected)} tone="bad" />
          <MetricCard label="Pending Proposals" value={String(stats.pendingProposals)} tone="warn" />
          <MetricCard label="Active Runs" value={String(stats.activeRuns)} tone="info" />
        </div>
      </section>

      {error ? <ErrorCard message={error} /> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        <section className="glass-card" style={{ display: 'grid', gap: '0.85rem', maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <FiActivity />
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Recent Sessions</h2>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No recent chat sessions were found.</div>
          ) : (
            sessions.map((session) => {
              const turn = latestAssistant(session);
              const status = reviewStatus(turn);
              return (
                <button
                  key={session.id}
                  onClick={() => {
                    setSelectedSessionId(session.id);
                    setSelectedTurnId(turn?.id || null);
                  }}
                  style={{
                    textAlign: 'left',
                    border: selectedSessionId === session.id ? '1px solid rgba(0, 240, 255, 0.35)' : '1px solid var(--border-glass)',
                    borderRadius: '14px',
                    background: selectedSessionId === session.id ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.03)',
                    padding: '0.95rem',
                    display: 'grid',
                    gap: '0.45rem',
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700 }}>{session.title || 'Untitled session'}</div>
                    <StatusPill status={status} />
                  </div>
                  <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{session.id}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.5 }}>
                    {workflowSummary(turn)}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                    {turn?.promptPackId || turn?.workflowState?.promptPackId || 'No prompt pack'}
                  </div>
                </button>
              );
            })
          )}
        </section>

        <section style={{ display: 'grid', gap: '1.25rem' }}>
          {!selectedSession || !selectedTurn ? (
            <div className="glass-card" style={{ color: 'var(--text-muted)' }}>
              Select a session to inspect its prompt provenance, reviewer state, and proposal history.
            </div>
          ) : (
            <>
              <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Execution Snapshot</h2>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginTop: '0.3rem' }}>
                      Session {selectedSession.id}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <StatusPill status={reviewStatus(selectedTurn)} />
                    <StatusPill status={relatedRuns.some((run) => run.status === 'running' || run.status === 'queued') ? 'active' : 'idle'} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem' }}>
                  <MetricCard label="Prompt Pack" value={selectedTurn.workflowState?.promptPackId || selectedTurn.promptPackId || 'n/a'} tone="info" />
                  <MetricCard label="Workflow Count" value={String((selectedTurn.workflowState?.workflowPromptIds || selectedTurn.workflowPromptIds || []).length)} tone="info" />
                  <MetricCard label="Review Events" value={String(selectedTurn.reviewEvents?.length || 0)} />
                  <MetricCard label="Run IDs" value={String(selectedTurn.runIds?.length || selectedTurn.workflowState?.runIds?.length || 0)} />
                </div>

                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {selectedTurn.content || 'No assistant content captured for this turn.'}
                </div>
              </section>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.9fr)', gap: '1.25rem', alignItems: 'start' }}>
                <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
                  <SectionHeader icon={<FiLayers />} title="Prompt Provenance" />
                  <DetailRow label="Prompt pack" value={selectedTurn.workflowState?.promptPackId || selectedTurn.promptPackId || 'n/a'} />
                  <DetailRow label="Prompt version" value={selectedTurn.workflowState?.promptVersionHash || selectedTurn.promptVersionHash || 'n/a'} mono />
                  <DetailRow label="Reviewer version" value={selectedTurn.workflowState?.reviewerPromptVersionHash || selectedTurn.reviewerPromptVersionHash || 'n/a'} mono />
                  <DetailRow label="Workflow ids" value={(selectedTurn.workflowState?.workflowPromptIds || selectedTurn.workflowPromptIds || []).join(', ') || 'general'} mono />
                  <DetailRow label="Assistant lane" value={selectedTurn.workflowState?.assistantLane || 'conversation'} mono />
                  <DetailRow label="Confidence" value={selectedTurn.workflowState?.confidenceState || 'n/a'} mono />
                  <DetailRow label="Model" value={selectedTurn.modelId || 'n/a'} mono />
                  <DetailRow label="Duration" value={selectedTurn.durationMs ? `${(selectedTurn.durationMs / 1000).toFixed(1)}s` : 'n/a'} />
                  <DetailRow label="Run ids" value={(selectedTurn.workflowState?.runIds || selectedTurn.runIds || []).join(', ') || 'none'} mono />
                </section>

                <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
                  <SectionHeader icon={<FiShield />} title="Reviewer Decisions" />
                  {!selectedTurn.reviewEvents?.length ? (
                    <div style={{ color: 'var(--text-muted)' }}>
                      {selectedTurn.workflowState?.reviewEnabled ? 'Review was enabled, but no persisted review events were captured for this turn.' : 'No reviewer was attached to this run.'}
                    </div>
                  ) : (
                    selectedTurn.reviewEvents.map((event, index) => (
                      <div
                        key={`${selectedTurn.id}-review-${index}`}
                        style={{
                          border: '1px solid var(--border-glass)',
                          borderRadius: '12px',
                          padding: '0.85rem',
                          background: 'rgba(255,255,255,0.03)',
                          display: 'grid',
                          gap: '0.45rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                          <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Reviewer {event.reviewerId || index + 1}
                          </div>
                          <StatusPill status={event.approved === true ? 'approved' : event.approved === false ? 'rejected' : 'pending'} />
                        </div>
                        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                          {event.feedback || 'No feedback captured.'}
                        </div>
                      </div>
                    ))
                  )}
                </section>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.9fr)', gap: '1.25rem', alignItems: 'start' }}>
                <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
                  <SectionHeader icon={<FiTarget />} title="Proposal History" />
                  {!relatedProposals.length ? (
                    <div style={{ color: 'var(--text-muted)' }}>No linked improvement proposals were found for this session.</div>
                  ) : (
                    relatedProposals.map((proposal) => (
                      <div
                        key={proposal.id}
                        style={{
                          border: '1px solid var(--border-glass)',
                          borderRadius: '12px',
                          padding: '0.9rem',
                          background: 'rgba(255,255,255,0.03)',
                          display: 'grid',
                          gap: '0.45rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                          <div style={{ fontWeight: 700 }}>{humanizeFailureCategory(proposal.failureCategory)}</div>
                          <StatusPill status={proposal.evalStatus || proposal.status || 'pending'} />
                        </div>
                        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{proposal.rationale}</div>
                        {proposal.expectedImprovement ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                            Target: {proposal.expectedImprovement}
                          </div>
                        ) : null}
                        <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {proposal.promptVersionHash || 'n/a'} | {new Date(proposal.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </section>

                <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
                  <SectionHeader icon={<FiClock />} title="Active Workflow State" />
                  <DetailRow label="Workflow" value={workflowSummary(selectedTurn)} />
                  <DetailRow label="Review enabled" value={selectedTurn.workflowState?.reviewEnabled ? 'Yes' : 'No'} />
                  <DetailRow label="Source mode" value={selectedTurn.provenanceTrace?.summary?.mainSource || 'model'} />
                  <DetailRow label="Trace summary" value={selectedTurn.provenanceTrace?.summary?.brief || 'No trace summary available.'} />
                  <DetailRow label="Last action" value={selectedTurn.provenanceTrace?.summary?.lastAction || 'n/a'} />
                  <div style={{ display: 'grid', gap: '0.55rem', marginTop: '0.2rem' }}>
                    {relatedRuns.length ? relatedRuns.map((run) => (
                      <div key={run.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                          <div className="mono" style={{ fontSize: '0.72rem' }}>{run.id}</div>
                          <StatusPill status={run.status} />
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.3rem' }}>
                          {run.selectedAgent || 'No agent'} | {new Date(run.createdAt).toLocaleString()}
                        </div>
                      </div>
                    )) : (
                      <div style={{ color: 'var(--text-muted)' }}>No background task runs are linked to this session.</div>
                    )}
                  </div>
                </section>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.9fr)', gap: '1.25rem', alignItems: 'start' }}>
                <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
                  <SectionHeader icon={<FiBookOpen />} title="Memory And Continuity Events" />
                  {!selectedTurn.memoryEvents?.length ? (
                    <div style={{ color: 'var(--text-muted)' }}>No memory captures were persisted for this turn.</div>
                  ) : (
                    selectedTurn.memoryEvents.map((event, index) => (
                      <div key={`${selectedTurn.id}-memory-${index}`} style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '0.85rem', background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <strong>{humanizeFailureCategory(event.layer)}</strong>
                          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{event.action}</span>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: '0.35rem' }}>{event.summary}</div>
                      </div>
                    ))
                  )}
                </section>

                <section className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
                  <SectionHeader icon={<FiShield />} title="Why I Suggested This" />
                  {!selectedTurn.advisoryEvents?.length ? (
                    <div style={{ color: 'var(--text-muted)' }}>No advisory suggestions were persisted for this turn.</div>
                  ) : (
                    selectedTurn.advisoryEvents.map((event, index) => (
                      <div key={`${selectedTurn.id}-advisory-${index}`} style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '0.85rem', background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <strong>{humanizeFailureCategory(event.category)}</strong>
                          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{event.actionState}</span>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: '0.35rem' }}>{event.summary}</div>
                      </div>
                    ))
                  )}
                </section>
              </div>

              <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
                <SectionHeader icon={<FiBookOpen />} title="Assistant Turns" />
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  {assistantTurns.map((turn, index) => (
                    <button
                      key={turn.id}
                      onClick={() => setSelectedTurnId(turn.id)}
                      style={{
                        border: selectedTurnId === turn.id ? '1px solid rgba(0, 240, 255, 0.35)' : '1px solid var(--border-glass)',
                        borderRadius: '999px',
                        background: selectedTurnId === turn.id ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.03)',
                        padding: '0.45rem 0.8rem',
                        cursor: 'pointer',
                        color: 'inherit',
                      }}
                    >
                      Turn {index + 1}
                    </button>
                  ))}
                </div>
                {selectedTurn.provenanceTrace ? (
                  <ProvenanceTrace trace={selectedTurn.provenanceTrace} />
                ) : (
                  <div style={{ color: 'var(--text-muted)' }}>No provenance trace was stored for this turn.</div>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
      {icon}
      <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{title}</h2>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: '0.2rem' }}>
      <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{label.toUpperCase()}</div>
      <div className={mono ? 'mono' : ''} style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function humanizeFailureCategory(value: string): string {
  return (value || 'unknown')
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'bad' | 'info' }) {
  const color =
    tone === 'good'
      ? 'rgba(24, 201, 100, 0.22)'
      : tone === 'warn'
        ? 'rgba(255, 170, 0, 0.22)'
        : tone === 'bad'
          ? 'rgba(255, 90, 90, 0.18)'
          : tone === 'info'
            ? 'rgba(0, 240, 255, 0.16)'
            : 'rgba(255,255,255,0.05)';

  return (
    <div style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: color }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.25rem' }}>{value}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = (status || 'pending').toLowerCase();
  const palette =
    normalized === 'approved'
      ? { bg: 'rgba(24, 201, 100, 0.18)', border: 'rgba(24, 201, 100, 0.35)', text: '#9ef2bf' }
      : normalized === 'rejected'
        ? { bg: 'rgba(255, 90, 90, 0.16)', border: 'rgba(255, 90, 90, 0.32)', text: '#ffb3b3' }
        : normalized === 'active' || normalized === 'running' || normalized === 'queued'
          ? { bg: 'rgba(0, 240, 255, 0.16)', border: 'rgba(0, 240, 255, 0.32)', text: '#9defff' }
          : normalized === 'idle'
            ? { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.16)', text: '#d9dce7' }
            : normalized === 'not-reviewed'
              ? { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.16)', text: '#d9dce7' }
              : { bg: 'rgba(255, 184, 0, 0.16)', border: 'rgba(255, 184, 0, 0.32)', text: '#ffd26a' };

  return (
    <span
      className="mono"
      style={{
        padding: '0.3rem 0.55rem',
        borderRadius: '999px',
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.text,
        fontSize: '0.72rem',
      }}
    >
      {normalized.toUpperCase()}
    </span>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div
      className="glass-card"
      style={{
        border: '1px solid rgba(255, 90, 90, 0.28)',
        background: 'rgba(255, 90, 90, 0.08)',
        display: 'flex',
        gap: '0.65rem',
        alignItems: 'flex-start',
      }}
    >
      <FiAlertCircle style={{ marginTop: '0.1rem' }} />
      <div style={{ color: 'var(--text-secondary)' }}>{message}</div>
    </div>
  );
}
