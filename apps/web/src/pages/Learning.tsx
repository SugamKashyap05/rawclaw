import { useEffect, useMemo, useState } from 'react';
import { FiAlertCircle, FiBookOpen, FiGitPullRequest, FiLayers, FiRefreshCw } from 'react-icons/fi';
import { api } from '../lib/api';

type ImprovementProposal = {
  id: string;
  sessionId?: string | null;
  messageId?: string | null;
  failureCategory: string;
  promptPackId?: string | null;
  promptVersionHash?: string | null;
  reviewerPromptVersionHash?: string | null;
  workflowPromptIds?: string | string[] | null;
  rationale: string;
  proposalJson?: string | Record<string, unknown> | null;
  expectedImprovement?: string | null;
  status?: string | null;
  evalStatus?: string | null;
  evalNotes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PromptPack = {
  id: string;
  purpose: string;
};

type ParsedProposal = ImprovementProposal & {
  parsedWorkflowPromptIds: string[];
  parsedProposal: Record<string, unknown>;
  suggestedAreas: string[];
  targetBlocks: string[];
  candidateActions: string[];
  requiresHumanPromotion: boolean;
};

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeProposal(entry: ImprovementProposal): ParsedProposal {
  const parsedProposal = parseJsonRecord(entry.proposalJson);
  const suggestedAreas = Array.isArray(parsedProposal.suggestedAreas)
    ? parsedProposal.suggestedAreas.map(String).filter(Boolean)
    : [];

  return {
    ...entry,
    parsedWorkflowPromptIds: parseStringArray(entry.workflowPromptIds),
    parsedProposal,
    suggestedAreas,
    targetBlocks: parseStringArray(parsedProposal.targetBlocks),
    candidateActions: parseStringArray(parsedProposal.candidateActions),
    requiresHumanPromotion: Boolean(parsedProposal.requiresHumanPromotion),
  };
}

export default function Learning() {
  const [proposals, setProposals] = useState<ParsedProposal[]>([]);
  const [promptPacks, setPromptPacks] = useState<PromptPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setProposalError(null);
    setPackError(null);
    try {
      const [proposalResponse, packResponse] = await Promise.allSettled([
        api.get<ImprovementProposal[]>('/self-improvement/proposals'),
        api.get<PromptPack[]>('/prompts/packs'),
      ]);

      if (proposalResponse.status === 'fulfilled') {
        setProposals((proposalResponse.value.data || []).map(normalizeProposal));
      } else {
        console.error('Failed to load self-improvement proposals', proposalResponse.reason);
        setProposals([]);
        setProposalError('Learning history is temporarily unavailable.');
      }

      if (packResponse.status === 'fulfilled') {
        setPromptPacks(packResponse.value.data || []);
      } else {
        console.error('Failed to load prompt packs', packResponse.reason);
        setPromptPacks([]);
        setPackError('Prompt pack data is temporarily unavailable.');
      }
    } catch (loadError) {
      console.error('Failed to load learning data', loadError);
      setProposalError('Unable to load learning history right now.');
      setPackError('Unable to load prompt pack data right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => {
    const evalApproved = proposals.filter((item) => item.evalStatus === 'approved').length;
    const pending = proposals.filter((item) => (item.evalStatus || 'pending') === 'pending').length;
    const rejected = proposals.filter((item) => item.evalStatus === 'rejected').length;
    const ready = proposals.filter((item) => (item.status || 'pending') === 'approved').length;
    return { evalApproved, pending, rejected, ready };
  }, [proposals]);

  const runEvaluation = async (proposalId: string) => {
    setEvaluatingId(proposalId);
    try {
      await api.post(`/self-improvement/proposals/${proposalId}/evaluate`);
      await load();
    } catch (error) {
      console.error('Failed to evaluate proposal', error);
      setProposalError('Unable to run proposal evaluation right now.');
    } finally {
      setEvaluatingId(null);
    }
  };

  const evaluatePending = async () => {
    setEvaluatingId('__batch__');
    try {
      await api.post('/self-improvement/proposals/evaluate-pending', { limit: 25 });
      await load();
    } catch (error) {
      console.error('Failed to evaluate pending proposals', error);
      setProposalError('Unable to evaluate pending proposals right now.');
    } finally {
      setEvaluatingId(null);
    }
  };

  const updateProposalStatus = async (proposal: ParsedProposal, status: 'approved' | 'rejected') => {
    setUpdatingId(proposal.id);
    try {
      await api.patch(`/self-improvement/proposals/${proposal.id}/eval`, {
        status,
        evalStatus: proposal.evalStatus || 'pending',
        evalNotes:
          status === 'approved'
            ? `${proposal.evalNotes || ''}\nmanual_status=approved-for-promotion`.trim()
            : `${proposal.evalNotes || ''}\nmanual_status=rejected-by-operator`.trim(),
      });
      await load();
    } catch (error) {
      console.error('Failed to update proposal status', error);
      setProposalError('Unable to update proposal status right now.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.25rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Learning Ledger</h1>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '860px', lineHeight: 1.6 }}>
              Review what RawClaw learned from failed or degraded runs, which prompt pack those lessons came from,
              and which update candidates are waiting for evaluation or are now ready for human promotion.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={() => void load()} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FiRefreshCw /> {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => void evaluatePending()}
              disabled={loading || evaluatingId === '__batch__'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <FiGitPullRequest /> {evaluatingId === '__batch__' ? 'Evaluating...' : 'Evaluate Pending'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
          <MetricCard label="Captured Lessons" value={String(proposals.length)} />
          <MetricCard label="Eval Approved" value={String(stats.evalApproved)} tone="good" />
          <MetricCard label="Pending Eval" value={String(stats.pending)} tone="warn" />
          <MetricCard label="Ready To Promote" value={String(stats.ready)} tone="good" />
          <MetricCard label="Prompt Packs" value={String(promptPacks.length)} />
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)', gap: '1.25rem', alignItems: 'start' }}>
        <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <FiBookOpen />
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>How To Use This Page</h2>
          </div>
          <HowItWorksStep
            number="1"
            title="Watch for captured lessons"
            body="Whenever a run fails, gets rejected by the reviewer, or degrades badly, RawClaw records a lesson here. The left column tells you what broke, which prompt pack it came from, and why the system thinks it happened."
          />
          <HowItWorksStep
            number="2"
            title="Run the proposal evaluation"
            body="Use Run Eval on one candidate, or Evaluate Pending to score a batch. The evaluator checks whether the proposal points at real prompt blocks, has concrete actions, and is aligned with the failure category instead of being vague."
          />
          <HowItWorksStep
            number="3"
            title="Mark only strong candidates ready"
            body="If a proposal is eval-approved and makes sense to you, use Mark Ready. That means it is good enough for human promotion into prompt files later. Reject Candidate when the idea is weak, noisy, or too risky."
          />
        </div>

        <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <FiGitPullRequest />
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>How This Makes RawClaw Smarter</h2>
          </div>
          <SmartnessBullet
            title="Failures become structured evidence"
            body="Instead of losing bad runs in chat history, RawClaw turns them into proposals with target blocks, candidate actions, workflow ids, and prompt provenance."
          />
          <SmartnessBullet
            title="Evaluation gates low-quality ideas"
            body="The system does not rewrite production prompts on its own. It first checks whether a candidate is concrete, traceable, and aligned with the failure before it can move forward."
          />
          <SmartnessBullet
            title="Human promotion keeps the core stable"
            body="Approved candidates still need a human to promote them into prompt files. That lets RawClaw improve steadily without becoming chaotic or self-corrupting."
          />
          <div
            style={{
              borderLeft: '3px solid rgba(0,240,255,0.45)',
              paddingLeft: '0.85rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}
          >
            Practical rule: treat this page as the training queue for the prompt system. The more disciplined the proposals and reviews are here, the more reliable the whole agent becomes.
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)', gap: '1.25rem', alignItems: 'start' }}>
        <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <FiBookOpen />
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>What The AI Learned</h2>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading learning history...</div>
          ) : proposalError ? (
            <ErrorCard message={proposalError} />
          ) : proposals.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No self-improvement proposals have been recorded yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.9rem' }}>
              {proposals.map((proposal) => (
                <article
                  key={proposal.id}
                  style={{
                    border: '1px solid var(--border-glass)',
                    borderRadius: '16px',
                    padding: '1rem',
                    background: 'rgba(255,255,255,0.03)',
                    display: 'grid',
                    gap: '0.65rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                        {humanizeFailureCategory(proposal.failureCategory)}
                      </div>
                      <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {proposal.promptPackId || 'No prompt pack'} | {new Date(proposal.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <StatusPill status={proposal.evalStatus || proposal.status || 'pending'} />
                  </div>

                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {proposal.rationale || 'No rationale recorded.'}
                  </div>

                  {proposal.expectedImprovement ? (
                    <div
                      style={{
                        borderLeft: '3px solid rgba(0,240,255,0.45)',
                        paddingLeft: '0.8rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Target: {proposal.expectedImprovement}
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    {(proposal.parsedWorkflowPromptIds.length ? proposal.parsedWorkflowPromptIds : ['general']).map((item) => (
                      <span key={`${proposal.id}-${item}`} style={tagStyle}>
                        {item}
                      </span>
                    ))}
                  </div>

                  {proposal.targetBlocks.length ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.55 }}>
                      Target blocks: <span className="mono">{proposal.targetBlocks.join(', ')}</span>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: 'grid', gap: '1.25rem' }}>
          <div className="glass-card" style={{ display: 'grid', gap: '0.95rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
              <FiGitPullRequest />
              <h2 style={{ fontSize: '1.05rem', margin: 0 }}>What The AI Updated</h2>
            </div>

            {loading ? (
              <div style={{ color: 'var(--text-muted)' }}>Loading update candidates...</div>
            ) : proposalError ? (
              <ErrorCard message={proposalError} />
            ) : proposals.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No update candidates are available yet.</div>
            ) : (
              proposals.map((proposal) => (
                <div
                  key={`update-${proposal.id}`}
                  style={{
                    border: '1px solid var(--border-glass)',
                    borderRadius: '16px',
                    padding: '1rem',
                    background: 'rgba(255,255,255,0.03)',
                    display: 'grid',
                    gap: '0.7rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 700 }}>
                      {(proposal.parsedProposal.kind as string) || 'prompt_candidate'}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusPill status={proposal.evalStatus || 'pending'} />
                      <StatusPill status={(proposal.status || 'pending') === 'approved' ? 'ready' : proposal.status || 'pending'} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    {(proposal.suggestedAreas.length ? proposal.suggestedAreas : ['No suggested areas']).map((area) => (
                      <span key={`${proposal.id}-${area}`} style={tagStyle}>
                        {area}
                      </span>
                    ))}
                  </div>

                  <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    Prompt version: <span className="mono">{proposal.promptVersionHash || 'n/a'}</span>
                    <br />
                    Reviewer version: <span className="mono">{proposal.reviewerPromptVersionHash || 'n/a'}</span>
                    {proposal.targetBlocks.length ? (
                      <>
                        <br />
                        Target blocks: <span className="mono">{proposal.targetBlocks.join(', ')}</span>
                      </>
                    ) : null}
                    {proposal.sessionId ? (
                      <>
                        <br />
                        Session: <span className="mono">{proposal.sessionId}</span>
                      </>
                    ) : null}
                  </div>

                  {proposal.evalNotes ? (
                    <div
                      style={{
                        padding: '0.8rem',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.04)',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {proposal.evalNotes}
                    </div>
                  ) : null}

                  {proposal.candidateActions.length ? (
                    <div style={{ display: 'grid', gap: '0.35rem' }}>
                      {proposal.candidateActions.map((action) => (
                        <div key={`${proposal.id}-${action}`} style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.5 }}>
                          - {action}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      className="btn-secondary"
                      onClick={() => void runEvaluation(proposal.id)}
                      disabled={evaluatingId === proposal.id || updatingId === proposal.id}
                    >
                      {evaluatingId === proposal.id ? 'Evaluating...' : 'Run Eval'}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => void updateProposalStatus(proposal, 'approved')}
                      disabled={updatingId === proposal.id || proposal.evalStatus !== 'approved'}
                    >
                      Mark Ready
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => void updateProposalStatus(proposal, 'rejected')}
                      disabled={updatingId === proposal.id}
                    >
                      Reject Candidate
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="glass-card" style={{ display: 'grid', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
              <FiLayers />
              <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Active Prompt Packs</h2>
            </div>
            {packError ? (
              <ErrorCard message={packError} />
            ) : promptPacks.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No prompt packs discovered.</div>
            ) : (
              promptPacks.map((pack) => (
                <div
                  key={pack.id}
                  style={{
                    border: '1px solid var(--border-glass)',
                    borderRadius: '14px',
                    padding: '0.9rem 1rem',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{pack.id}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.55 }}>{pack.purpose}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function humanizeFailureCategory(value: string): string {
  return (value || 'unknown')
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function HowItWorksStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '42px minmax(0, 1fr)',
        gap: '0.85rem',
        alignItems: 'start',
      }}
    >
      <div
        className="mono"
        style={{
          width: '42px',
          height: '42px',
          borderRadius: '999px',
          display: 'grid',
          placeItems: 'center',
          border: '1px solid rgba(0,240,255,0.28)',
          background: 'rgba(0,240,255,0.08)',
          color: 'var(--neon-cyan)',
          fontSize: '0.82rem',
          fontWeight: 700,
        }}
      >
        {number}
      </div>
      <div style={{ display: 'grid', gap: '0.2rem' }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}

function SmartnessBullet({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: 'grid', gap: '0.22rem' }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' }) {
  const color =
    tone === 'good'
      ? 'rgba(24, 201, 100, 0.22)'
      : tone === 'warn'
        ? 'rgba(255, 170, 0, 0.22)'
        : 'rgba(255,255,255,0.05)';

  return (
    <div
      style={{
        border: '1px solid var(--border-glass)',
        borderRadius: '16px',
        padding: '1rem',
        background: color,
      }}
    >
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
      : normalized === 'ready'
        ? { bg: 'rgba(0, 240, 255, 0.16)', border: 'rgba(0, 240, 255, 0.32)', text: '#9defff' }
        : normalized === 'rejected'
          ? { bg: 'rgba(255, 90, 90, 0.16)', border: 'rgba(255, 90, 90, 0.32)', text: '#ffb3b3' }
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
      style={{
        border: '1px solid rgba(255, 90, 90, 0.28)',
        borderRadius: '14px',
        padding: '1rem',
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

const tagStyle = {
  fontSize: '0.7rem',
  padding: '0.24rem 0.55rem',
  borderRadius: '999px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-secondary)',
};
