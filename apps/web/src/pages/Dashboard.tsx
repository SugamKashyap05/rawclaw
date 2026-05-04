import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AdvisoryItem,
  AgentProfile,
  AssistantBriefing,
  AssistantState,
  CommandMemoryOverview,
  SkillDefinition,
  SystemStatusSnapshot,
} from '@rawclaw/shared';
import { api } from '../lib/api';
import { useGatewayRuntime } from '../hooks/useGatewayRuntime';

interface TaskRunSummary {
  id: string;
  status: string;
  sessionId?: string | null;
  startedAt?: string;
  definition?: { name?: string };
}

interface ProposalSummary {
  id: string;
  failureCategory: string;
  evalStatus?: string | null;
  status?: string | null;
}

interface DashboardState {
  system: SystemStatusSnapshot | null;
  assistantState: AssistantState | null;
  briefing: AssistantBriefing | null;
  advisories: AdvisoryItem[];
  memoryOverview: CommandMemoryOverview | null;
  agents: AgentProfile[];
  skills: SkillDefinition[];
  runs: TaskRunSummary[];
  proposals: ProposalSummary[];
}

export default function Dashboard() {
  const gateway = useGatewayRuntime({ enableStream: true });
  const [state, setState] = useState<DashboardState>({
    system: null,
    assistantState: null,
    briefing: null,
    advisories: [],
    memoryOverview: null,
    agents: [],
    skills: [],
    runs: [],
    proposals: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    const [system, assistantState, briefing, advisories, memoryOverview, agents, skills, runs, proposals] = await Promise.all([
      api.get<SystemStatusSnapshot>('/system/status').catch(() => null),
      api.get<AssistantState>('/assistant/state').catch(() => null),
      api.get<AssistantBriefing>('/assistant/briefing').catch(() => null),
      api.get<AdvisoryItem[]>('/assistant/advisories').catch(() => null),
      api.get<CommandMemoryOverview>('/memory/overview').catch(() => null),
      api.get<AgentProfile[]>('/agents').catch(() => null),
      api.get<SkillDefinition[]>('/skills').catch(() => null),
      api.get<TaskRunSummary[]>('/tasks/runs/recent').catch(() => null),
      api.get<ProposalSummary[]>('/self-improvement/proposals').catch(() => null),
    ]);

    setState({
      system: system?.data || null,
      assistantState: assistantState?.data || null,
      briefing: briefing?.data || null,
      advisories: advisories?.data || [],
      memoryOverview: memoryOverview?.data || null,
      agents: agents?.data || [],
      skills: skills?.data || [],
      runs: runs?.data || [],
      proposals: proposals?.data || [],
    });
    setLoading(false);
  };

  const metrics = useMemo(() => {
    const activeCommitments = state.assistantState?.commitments.filter((item) => item.status === 'active').length || 0;
    const pendingProposals = state.proposals.filter((proposal) => (proposal.evalStatus || 'pending') === 'pending').length;
    const activeRuns = state.runs.filter((run) => run.status === 'queued' || run.status === 'running').length;
    return {
      activeCommitments,
      pendingProposals,
      activeRuns,
      advisories: state.advisories.length,
    };
  }, [state]);

  const activeAgents = state.agents.filter((agent) => agent.status === 'running' || agent.isDefault).slice(0, 4);
  const gatewayAlerts = gateway.recentEvents.filter((event: any) =>
    event.type === 'run.failed'
    || event.type === 'health.degraded'
    || event.type === 'subagent.failed'
    || event.type === 'automation.run.failed',
  ).slice(0, 3);

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.25rem' }}>
      <section
        className="glass-card"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 0.8fr',
          gap: '1.5rem',
          background: 'linear-gradient(135deg, rgba(10,12,20,0.92), rgba(17,36,48,0.82))',
        }}
      >
        <div>
          <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.8rem', marginBottom: '0.65rem' }}>
            RAWCLAW JARVIS COMMAND CENTER
          </div>
          <h1 style={{ fontSize: '2.35rem', marginBottom: '0.75rem', lineHeight: 1.04 }}>
            Operate a calm assistant that remembers context, explains itself, and keeps the next move visible.
          </h1>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: '760px' }}>
            The command center now combines assistant state, active mission context, learning proposals, provenance,
            memory, and running tasks so RawClaw feels like one reliable system instead of a collection of screens.
          </p>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
            <Link to="/chat" className="btn-primary">Talk To RawClaw</Link>
            <Link to="/operator" className="btn-ghost">Open Operator</Link>
            <Link to="/app-builder" className="btn-ghost">Open App Builder</Link>
            <Link to="/memory" className="btn-ghost">Review Memory</Link>
            <Link to="/provenance" className="btn-ghost">Open Control Room</Link>
            <Link to="/learning" className="btn-ghost">Review Lessons</Link>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '0.9rem' }}>
          <MetricCard label="Active advisories" value={metrics.advisories} tone="info" />
          <MetricCard label="Open commitments" value={metrics.activeCommitments} tone="good" />
          <MetricCard label="Pending proposals" value={metrics.pendingProposals} tone="warn" />
          <MetricCard label="Active runs" value={metrics.activeRuns} />
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
        <Panel title="Assistant Status">
          <StatusRow label="Autonomy" value={state.assistantState?.advisoryStatus || 'advisory-first'} />
          <StatusRow label="Operator" value={state.assistantState?.operatorProfile.name || 'Not set'} />
          <StatusRow label="Prompt-ready packs" value={String(state.agents.filter((agent) => !!agent.promptPackId).length)} />
          <StatusRow label="Skills exposed" value={String(state.skills.length)} />
        </Panel>

        <Panel title="System Health">
          <StatusRow label="API" value={state.system?.services.api || 'unknown'} />
          <StatusRow label="Agent" value={state.system?.services.agent || 'unknown'} />
          <StatusRow label="Database" value={state.system?.services.database || 'unknown'} />
          <StatusRow label="MCP" value={String(state.system?.counts.mcpServers ?? 0)} />
        </Panel>

        <Panel title="Memory Layers">
          <StatusRow label="Operator" value={String(state.memoryOverview?.operator.length || 0)} />
          <StatusRow label="Mission" value={String(state.memoryOverview?.mission.length || 0)} />
          <StatusRow label="Session" value={String(state.memoryOverview?.session.length || 0)} />
          <StatusRow label="Recent" value={String(state.memoryOverview?.recent.length || 0)} />
        </Panel>

        <Panel title="Quick Links">
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            <QuickLink to="/agents" label="Choose assistant pack" />
            <QuickLink to="/app-builder" label="Build controllable apps" />
            <QuickLink to="/tasks" label="Track commitments" />
            <QuickLink to="/models" label="Tune model routing" />
            <QuickLink to="/settings" label="Edit operator files" />
          </div>
        </Panel>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1rem', alignItems: 'start' }}>
        <Panel title="Gateway Runtime Preview">
          <div style={{ display: 'grid', gap: '0.9rem' }}>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Watch live route bindings, delegated subagent work, and degraded control-plane signals without leaving the command center.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '0.75rem' }}>
              <MetricCard label="Sessions" value={gateway.summary.activeSessions} tone="info" />
              <MetricCard label="Routes" value={gateway.summary.activeRoutes} />
              <MetricCard label="Runs" value={gateway.summary.inflightRuns} tone="good" />
              <MetricCard label="Degraded" value={gateway.summary.degradedRoutes} tone={gateway.summary.degradedRoutes > 0 ? 'warn' : 'default'} />
              <MetricCard label="Subagents" value={gateway.summary.activeSubagents} tone="warn" />
              <MetricCard label="Auto Jobs" value={gateway.summary.activeAutomationJobs || 0} tone="info" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ color: gateway.isStreamLive ? 'var(--text-secondary)' : '#ffd26a', fontSize: '0.9rem' }}>
                {gateway.isStreamLive ? 'Gateway stream is live.' : gateway.streamError || 'Gateway stream is reconnecting.'}
              </div>
              <Link to="/operator" className="btn-ghost" style={{ textDecoration: 'none' }}>
                Open Unified Operator
              </Link>
              <Link to="/gateway" className="btn-ghost" style={{ textDecoration: 'none' }}>
                Open Gateway Runtime
              </Link>
            </div>
          </div>
        </Panel>

        <Panel title="Recent Gateway Alerts">
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {gatewayAlerts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>
                No recent degraded runtime alerts have surfaced from the gateway.
              </div>
            ) : (
              gatewayAlerts.map((event: any) => (
                <div key={event.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <strong>{humanize(String(event.type || 'gateway-alert'))}</strong>
                    <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'live'}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    {event.summary || 'No summary captured.'}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1rem', alignItems: 'start' }}>
        <Panel title="Current Briefing">
          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading assistant briefing...</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.9rem' }}>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                {state.briefing?.summary || 'No assistant briefing is available yet.'}
              </div>
              {state.assistantState?.missionSummary ? (
                <div style={{ borderLeft: '3px solid rgba(0,240,255,0.4)', paddingLeft: '0.8rem', color: 'var(--text-secondary)' }}>
                  Mission: {state.assistantState.missionSummary}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                {(state.assistantState?.activeFocus || []).map((focus) => (
                  <span key={focus} style={tagStyle}>{focus}</span>
                ))}
                {(!state.assistantState?.activeFocus || state.assistantState.activeFocus.length === 0) ? (
                  <span style={{ color: 'var(--text-muted)' }}>No focus items pinned.</span>
                ) : null}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Active Advisories">
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {state.advisories.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No advisory suggestions are queued right now.</div>
            ) : (
              state.advisories.map((advisory) => (
                <div key={advisory.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <strong>{humanize(advisory.category)}</strong>
                    <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{advisory.actionState}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{advisory.summary}</div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
        <Panel title="Operator And Mission Memory">
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            <MemoryCluster title="Operator Memory" items={state.memoryOverview?.operator || []} empty="No operator memory has been captured yet." />
            <MemoryCluster title="Mission Memory" items={state.memoryOverview?.mission || []} empty="No mission memory has been captured yet." />
          </div>
        </Panel>

        <Panel title="Commitments And Running Work">
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            {(state.assistantState?.commitments.filter((item) => item.status === 'active') || []).length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No active assistant commitments are being tracked.</div>
            ) : (
              state.assistantState!.commitments
                .filter((item) => item.status === 'active')
                .map((commitment) => (
                  <div key={commitment.id} style={cardStyle}>
                    <div style={{ fontWeight: 700 }}>{commitment.summary}</div>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {commitment.dueAt ? `due ${new Date(commitment.dueAt).toLocaleString()}` : 'no due time'}
                    </div>
                  </div>
                ))
            )}

            {state.runs.slice(0, 4).map((run) => (
              <div key={run.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <strong>{run.definition?.name || 'Task run'}</strong>
                  <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{run.status}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{run.id}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Panel title="Active Agents">
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {activeAgents.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No active or default agents discovered.</div>
            ) : (
              activeAgents.map((agent) => (
                <div key={agent.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <strong>{agent.name}</strong>
                    <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{agent.status}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5 }}>
                    {agent.promptPackId || 'No prompt pack selected'}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Learning Queue">
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {state.proposals.slice(0, 5).map((proposal) => (
              <div key={proposal.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <strong>{humanize(proposal.failureCategory)}</strong>
                  <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                    {proposal.evalStatus || proposal.status || 'pending'}
                  </span>
                </div>
              </div>
            ))}
            {state.proposals.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No learning proposals are waiting right now.</div>
            ) : null}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="glass-card">
      <h2 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>{title}</h2>
      {children}
    </div>
  );
}

function MemoryCluster({ title, items, empty }: { title: string; items: Array<{ id: string; content: string; updatedAt: string }>; empty: string }) {
  return (
    <div style={{ display: 'grid', gap: '0.55rem' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{title.toUpperCase()}</div>
      {items.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>{empty}</div>
      ) : (
        items.slice(0, 4).map((entry) => (
          <div key={entry.id} style={cardStyle}>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{entry.content}</div>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.35rem' }}>
              {new Date(entry.updatedAt).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'good' | 'warn' | 'info' }) {
  const color =
    tone === 'good'
      ? 'rgba(24, 201, 100, 0.22)'
      : tone === 'warn'
        ? 'rgba(255, 170, 0, 0.22)'
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

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.35rem 0' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="btn-ghost" style={{ textDecoration: 'none', textAlign: 'left' }}>
      {label}
    </Link>
  );
}

function humanize(value: string) {
  return (value || 'unknown')
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const tagStyle = {
  fontSize: '0.68rem',
  padding: '0.24rem 0.55rem',
  borderRadius: '999px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-secondary)',
};

const cardStyle = {
  border: '1px solid var(--border-glass)',
  borderRadius: '14px',
  padding: '0.85rem',
  background: 'rgba(255,255,255,0.03)',
};
