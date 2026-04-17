import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface TaskRunSummary {
  id: string;
  status: string;
  startedAt?: string;
  outputPath?: string | null;
  workspacePath?: string | null;
  sandboxPath?: string | null;
  definition?: { name?: string };
}

export default function Sandbox() {
  const [runs, setRuns] = useState<TaskRunSummary[]>([]);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    const response = await api.get<TaskRunSummary[]>('/tasks/runs/recent');
    setRuns(response.data);
  };

  return (
    <div className="animate-in">
      <div className="glass-card">
        <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Sandbox</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.4rem' }}>
          RawShell runs behind the scenes, and this page gives us a live view of the workspaces and artifact paths it is using.
        </p>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {runs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No recent task runs to inspect yet.</div>
          ) : (
            runs.map((run) => (
              <div key={run.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.55rem' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{run.definition?.name || 'Unnamed task run'}</div>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {run.id}
                    </div>
                  </div>
                  <span className={`status-dot ${run.status === 'done' ? 'ok' : run.status === 'failed' ? 'down' : 'loading'}`} />
                </div>
                <div style={{ display: 'grid', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                  <div>Workspace: {run.workspacePath || 'Not provided'}</div>
                  <div>Sandbox: {run.sandboxPath || 'Not provided'}</div>
                  <div>Artifact output: {run.outputPath || 'Not provided'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
