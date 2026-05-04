import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReflectionProposalView, SimulationRun } from '@rawclaw/shared';
import { FiAlertCircle, FiBookOpen, FiGitPullRequest, FiLayers, FiRefreshCw } from 'react-icons/fi';
import {
  approveReflectionProposal,
  fetchReflectionProposals,
  fetchSimulations,
  getProposalSimulationEligibility,
  publishReflectionProposal,
  queueSimulation,
  rejectReflectionProposal,
} from '../lib/gateway';

export default function Learning() {
  const [proposals, setProposals] = useState<ReflectionProposalView[]>([]);
  const [simulations, setSimulations] = useState<SimulationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'proposed' | 'approved' | 'published' | 'rejected'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProposals, nextSimulations] = await Promise.all([
        fetchReflectionProposals({ limit: 40 }),
        fetchSimulations(20),
      ]);
      setProposals(nextProposals);
      setSimulations(nextSimulations);
    } catch (loadError) {
      console.error('Failed to load learning runtime data', loadError);
      setError('Learning proposals, simulations, or publish state are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredProposals = useMemo(() => {
    if (statusFilter === 'all') {
      return proposals;
    }
    return proposals.filter((entry) => entry.proposal.status === statusFilter);
  }, [proposals, statusFilter]);

  const stats = useMemo(() => {
    const counts = {
      total: proposals.length,
      proposed: proposals.filter((entry) => entry.proposal.status === 'proposed').length,
      approved: proposals.filter((entry) => entry.proposal.status === 'approved').length,
      published: proposals.filter((entry) => entry.proposal.status === 'published').length,
      rejected: proposals.filter((entry) => entry.proposal.status === 'rejected').length,
      ready: proposals.filter((entry) => getProposalSimulationEligibility(entry, simulations).canApprove).length,
    };
    return counts;
  }, [proposals, simulations]);

  const actOnProposal = async (
    proposalView: ReflectionProposalView,
    action: 'simulate' | 'approve' | 'reject' | 'publish',
  ) => {
    const proposal = proposalView.proposal;
    setBusyAction(`${action}:${proposal.id}`);
    setError(null);
    try {
      if (action === 'simulate') {
        await queueSimulation({
          proposalId: proposal.id,
          runId: proposal.runId ?? null,
          inputEnvelope: {
            proposalId: proposal.id,
            runId: proposal.runId ?? null,
            title: proposal.title,
          },
        });
      } else if (action === 'approve') {
        await approveReflectionProposal(proposal.id, 'Approved from Learning workflow.');
      } else if (action === 'reject') {
        await rejectReflectionProposal(proposal.id, 'Rejected from Learning workflow.');
      } else {
        await publishReflectionProposal(proposal.id, 'Published from Learning workflow.');
      }
      await load();
    } catch (actionError: any) {
      console.error(`Failed to ${action} proposal`, actionError);
      setError(actionError?.message || `Unable to ${action} the proposal right now.`);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.25rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Learning Ledger</h1>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '920px', lineHeight: 1.6 }}>
              Review the Phase 3 reflection loop the same way the runtime now works in production:
              capture a proposal, run a simulation, approve only if it improves the baseline, then publish a versioned runtime asset.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link to="/gateway" className="btn-ghost" style={{ textDecoration: 'none' }}>Gateway Runtime</Link>
            <Link to="/operator" className="btn-ghost" style={{ textDecoration: 'none' }}>Operator Surface</Link>
            <button className="btn-ghost" onClick={() => void load()} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FiRefreshCw /> {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
          <MetricCard label="Total Proposals" value={String(stats.total)} />
          <MetricCard label="Proposed" value={String(stats.proposed)} tone="warn" />
          <MetricCard label="Approved" value={String(stats.approved)} tone="good" />
          <MetricCard label="Published" value={String(stats.published)} tone="info" />
          <MetricCard label="Rejected" value={String(stats.rejected)} tone="bad" />
          <MetricCard label="Ready To Approve" value={String(stats.ready)} tone="good" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-secondary)' }}>
            Simulations must complete and show improvement before approval is allowed.
          </div>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>STATUS FILTER</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} style={fieldStyle}>
              <option value="all">All</option>
              <option value="proposed">Proposed</option>
              <option value="approved">Approved</option>
              <option value="published">Published</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <section className="glass-card" style={{ borderColor: 'rgba(255, 118, 118, 0.4)', display: 'grid', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: '#ffb4b4' }}>
            <FiAlertCircle />
            <strong>Learning runtime issue</strong>
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>{error}</div>
        </section>
      ) : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)', gap: '1.25rem', alignItems: 'start' }}>
        <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <FiGitPullRequest />
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Reflection Workflow</h2>
          </div>
          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading proposal workflow...</div>
          ) : filteredProposals.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No reflection proposals match the current filter.</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              {filteredProposals.map((proposalView) => {
                const proposal = proposalView.proposal;
                const eligibility = getProposalSimulationEligibility(proposalView, simulations);
                const latestSimulation = simulations.find((simulation) => simulation.proposalId === proposal.id) || null;

                return (
                  <div key={proposal.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: 'rgba(255,255,255,0.03)', display: 'grid', gap: '0.55rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{proposal.title}</strong>
                      <StatusPill status={proposal.status} />
                    </div>
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{proposal.rationale}</div>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {proposal.kind} | run {proposal.runId || 'n/a'} | {proposal.assetVersion || 'unpublished'}
                    </div>
                    <div style={{ display: 'grid', gap: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                      <div>
                        Latest simulation: {latestSimulation ? `${latestSimulation.id} (${latestSimulation.status})` : 'none queued yet'}
                      </div>
                      <div style={{ color: eligibility.canApprove ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                        {eligibility.canApprove
                          ? 'Simulation gate passed. This proposal can be approved.'
                          : eligibility.reasons.join(' ')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="btn-ghost" disabled={busyAction === `simulate:${proposal.id}`} onClick={() => void actOnProposal(proposalView, 'simulate')}>
                        Simulate
                      </button>
                      {proposal.status === 'proposed' ? (
                        <>
                          <button
                            className="btn-ghost"
                            disabled={busyAction === `approve:${proposal.id}` || !eligibility.canApprove}
                            onClick={() => void actOnProposal(proposalView, 'approve')}
                          >
                            Approve
                          </button>
                          <button className="btn-ghost" disabled={busyAction === `reject:${proposal.id}`} onClick={() => void actOnProposal(proposalView, 'reject')}>
                            Reject
                          </button>
                        </>
                      ) : null}
                      {proposal.status === 'approved' ? (
                        <button className="btn-secondary" disabled={busyAction === `publish:${proposal.id}`} onClick={() => void actOnProposal(proposalView, 'publish')}>
                          Publish
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
              <FiBookOpen />
              <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Operator Rules</h2>
            </div>
            <RuleBullet
              title="Proposals start as proposed"
              body="Reflection can suggest routing, policy, prompt, and sandbox improvements, but nothing changes live until an operator reviews it."
            />
            <RuleBullet
              title="Simulations gate approval"
              body="A proposal must show a completed simulation with an improvement signal before the system allows approval."
            />
            <RuleBullet
              title="Publishing creates a versioned asset"
              body="Publishing marks the proposal as released without silently mutating the active runtime. That keeps the learning loop auditable."
            />
          </div>

          <div className="glass-card" style={{ display: 'grid', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
              <FiLayers />
              <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Recent Simulations</h2>
            </div>
            {simulations.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No simulations have been queued yet.</div>
            ) : (
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {simulations.map((simulation) => (
                  <div key={simulation.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.85rem', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <strong>{simulation.id}</strong>
                      <StatusPill status={simulation.status} />
                    </div>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.25rem' }}>
                      proposal {simulation.proposalId || 'n/a'} | run {simulation.runId || 'n/a'}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                      started {simulation.startedAt ? formatTimestamp(simulation.startedAt) : 'pending'} | finished {simulation.finishedAt ? formatTimestamp(simulation.finishedAt) : 'pending'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info';
}) {
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
    <div style={{ borderRadius: '16px', padding: '0.95rem', border: '1px solid var(--border-glass)', background: color }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.35rem' }}>{value}</div>
    </div>
  );
}

function RuleBullet({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: 'grid', gap: '0.2rem' }}>
      <strong>{title}</strong>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone =
    normalized === 'published' || normalized === 'completed' || normalized === 'approved'
      ? 'rgba(24, 201, 100, 0.22)'
      : normalized === 'rejected' || normalized === 'failed'
        ? 'rgba(255, 90, 90, 0.18)'
        : normalized === 'proposed' || normalized === 'queued' || normalized === 'running'
          ? 'rgba(255, 170, 0, 0.22)'
          : 'rgba(255,255,255,0.08)';

  return (
    <span
      className="mono"
      style={{
        fontSize: '0.7rem',
        letterSpacing: '0.08em',
        padding: '0.28rem 0.55rem',
        borderRadius: '999px',
        border: '1px solid var(--border-glass)',
        background: tone,
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return 'n/a';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

const fieldStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid var(--border-glass)',
  borderRadius: '12px',
  padding: '0.75rem 0.85rem',
  color: 'var(--text-primary)',
};
