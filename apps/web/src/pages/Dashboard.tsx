import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DocsIndexResponse, SkillDefinition, SystemStatusSnapshot } from '@rawclaw/shared';
import { api } from '../lib/api';

interface TaskRunSummary {
  id: string;
  status: string;
  startedAt?: string;
  definition?: { name?: string };
}

interface DashboardState {
  system: SystemStatusSnapshot | null;
  docs: DocsIndexResponse | null;
  agents: Array<{ id: string; name: string; status: string }>;
  skills: SkillDefinition[];
  runs: TaskRunSummary[];
}

export default function Dashboard() {
  const [state, setState] = useState<DashboardState>({
    system: null,
    docs: null,
    agents: [],
    skills: [],
    runs: [],
  });

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    const [system, docs, agents, skills, runs] = await Promise.all([
      api.get<SystemStatusSnapshot>('/system/status').catch(() => null),
      api.get<DocsIndexResponse>('/docs').catch(() => null),
      api.get<Array<{ id: string; name: string; status: string }>>('/agents').catch(() => null),
      api.get<SkillDefinition[]>('/skills').catch(() => null),
      api.get<TaskRunSummary[]>('/tasks/runs/recent').catch(() => null),
    ]);

    setState({
      system: system?.data || null,
      docs: docs?.data || null,
      agents: agents?.data || [],
      skills: skills?.data || [],
      runs: runs?.data || [],
    });
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.5rem' }}>
      <section
        className="glass-card"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 0.8fr',
          gap: '1.5rem',
          background: 'linear-gradient(135deg, rgba(12,12,18,0.88), rgba(32,18,52,0.78))',
        }}
      >
        <div>
          <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.8rem', marginBottom: '0.65rem' }}>
            RAWCLAW COMMAND CENTER
          </div>
          <h1 style={{ fontSize: '2.3rem', marginBottom: '0.75rem', lineHeight: 1.05 }}>
            Operate agents, memory, models, MCP servers, and tasks from one live surface.
          </h1>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: '760px' }}>
            This dashboard is now wired to the actual backend contracts we rebuilt. The goal is simple: every major capability has a route, a backing API, and a visible operational state.
          </p>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
            <Link to="/chat" className="btn-primary">New Chat</Link>
            <Link to="/agents" className="btn-ghost">Create Agent</Link>
            <Link to="/mcp" className="btn-ghost">Add MCP Server</Link>
            <Link to="/skills" className="btn-ghost">Install Skill</Link>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '0.9rem' }}>
          <MetricCard label="Running agents" value={state.system?.counts.agents ?? 0} />
          <MetricCard label="Connected MCP servers" value={state.system?.counts.mcpServers ?? 0} />
          <MetricCard label="Pending tasks" value={state.system?.counts.pendingTasks ?? 0} />
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
        <Panel title="System Status">
          <StatusRow label="API" value={state.system?.services.api || 'unknown'} />
          <StatusRow label="Agent" value={state.system?.services.agent || 'unknown'} />
          <StatusRow label="Redis" value={state.system?.services.redis || 'unknown'} />
          <StatusRow label="ChromaDB" value={state.system?.services.chroma || 'unknown'} />
          <StatusRow label="Prisma / SQLite" value={state.system?.services.database || 'unknown'} />
        </Panel>

        <Panel title="Foundation Intel">
          <StatusRow label="Docs indexed" value={String(state.docs?.total || 0)} />
          <StatusRow label="Decision records" value={String(state.docs?.entries.filter((entry) => entry.category === 'decision').length || 0)} />
          <StatusRow label="Skills exposed" value={String(state.skills.length)} />
          <StatusRow label="Git branch" value={state.system?.git.branch || 'unknown'} />
        </Panel>

        <Panel title="Quick Links">
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            <QuickLink to="/memory" label="Open Memory Matrix" />
            <QuickLink to="/models" label="Tune routing policy" />
            <QuickLink to="/settings" label="Edit providers and workspace files" />
            <QuickLink to="/sandbox" label="Inspect task sandbox paths" />
          </div>
        </Panel>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1rem' }}>
        <Panel title="Active Agents">
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {state.agents.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No agents configured yet.</div>
            ) : (
              state.agents.map((agent) => (
                <div key={agent.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.85rem', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <strong>{agent.name}</strong>
                    <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {agent.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Recent Activity">
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {state.runs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No recent task activity yet.</div>
            ) : (
              state.runs.map((run) => (
                <div key={run.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.85rem', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ fontWeight: 700 }}>{run.definition?.name || 'Task run'}</div>
                  <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                    {run.status} • {run.id}
                  </div>
                </div>
              ))
            )}
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

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.25rem' }}>{value}</div>
      <div style={{ color: 'var(--text-secondary)' }}>{label}</div>
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
