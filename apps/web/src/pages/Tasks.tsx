import React, { useEffect, useMemo, useState } from 'react';
import { AgentProfile, RunStep, Task, TaskRun } from '@rawclaw/shared';
import { formatDistanceToNow } from 'date-fns';
import {
  FiClock,
  FiDownload,
  FiEdit2,
  FiExternalLink,
  FiHash,
  FiPlay,
  FiPlus,
  FiSearch,
  FiTrash2,
} from 'react-icons/fi';
import { api } from '../lib/api';

type SchedulePreview = {
  valid: boolean;
  expression: string;
  nextRun: string | null;
  error: string | null;
};

type TaskFormState = {
  id?: string;
  name: string;
  description: string;
  agentId: string;
  schedule: string;
  workspaceId: string;
};

const EMPTY_FORM: TaskFormState = {
  name: '',
  description: '',
  agentId: '',
  schedule: '',
  workspaceId: 'default',
};

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState<TaskFormState>(EMPTY_FORM);
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<TaskRun | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<(TaskRun & { definition?: Task; provenance?: any; steps: RunStep[] }) | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const schedule = createForm.schedule.trim();
    if (!schedule) {
      setSchedulePreview(null);
      return;
    }

    const handle = window.setTimeout(() => {
      void previewSchedule(schedule);
    }, 350);

    return () => window.clearTimeout(handle);
  }, [createForm.schedule]);

  useEffect(() => {
    if (!selectedRun) {
      setSelectedRunDetail(null);
      return;
    }
    void loadRunDetail(selectedRun.id);
  }, [selectedRun]);

  const fetchData = async () => {
    try {
      const [tasksRes, runsRes, agentsRes] = await Promise.all([
        api.get<Task[]>('/tasks'),
        api.get<TaskRun[]>('/tasks/runs/recent'),
        api.get<AgentProfile[]>('/agents'),
      ]);
      setTasks(tasksRes.data);
      setRuns(runsRes.data);
      setAgents(agentsRes.data);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const previewSchedule = async (expression: string) => {
    setPreviewLoading(true);
    try {
      const response = await api.get<SchedulePreview>('/tasks/schedule/preview', {
        params: { expression },
      });
      setSchedulePreview(response.data);
    } catch (error: any) {
      setSchedulePreview({
        valid: false,
        expression,
        nextRun: null,
        error: error?.response?.data?.message || 'Unable to validate schedule.',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const loadRunDetail = async (runId: string) => {
    setRunDetailLoading(true);
    try {
      const response = await api.get<TaskRun & { definition?: Task; provenance?: any; steps: RunStep[] }>(`/tasks/runs/${runId}`);
      setSelectedRunDetail(response.data);
    } catch (error) {
      console.error('Failed to load run detail:', error);
      setSelectedRunDetail(null);
    } finally {
      setRunDetailLoading(false);
    }
  };

  const runTask = async (id: string) => {
    try {
      await api.post(`/tasks/${id}/run`);
      await fetchData();
    } catch (error) {
      console.error('Failed to run task:', error);
    }
  };

  const deleteTask = async (id: string) => {
    if (!window.confirm('Delete this task definition?')) return;
    try {
      await api.delete(`/tasks/${id}`);
      if (createForm.id === id) {
        resetForm();
      }
      await fetchData();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const deleteRun = async (runId: string) => {
    if (!window.confirm('Delete this task run?')) return;
    try {
      await api.delete(`/tasks/runs/${runId}`);
      if (selectedRun?.id === runId) {
        setSelectedRun(null);
        setSelectedRunDetail(null);
      }
      await fetchData();
    } catch (error) {
      console.error('Failed to delete run:', error);
    }
  };

  const saveTask = async () => {
    const payload = {
      name: createForm.name.trim(),
      description: createForm.description.trim(),
      agentId: createForm.agentId.trim() || undefined,
      schedule: createForm.schedule.trim() || undefined,
      workspaceId: createForm.workspaceId.trim() || 'default',
      toolIds: [],
    };

    if (!payload.name || !payload.description) {
      setCreateError('Task name and description are required.');
      return;
    }

    setCreating(true);
    setCreateError('');
    try {
      if (createForm.id) {
        await api.patch(`/tasks/${createForm.id}`, payload);
      } else {
        await api.post('/tasks', payload);
      }
      resetForm();
      await fetchData();
    } catch (error: any) {
      console.error('Failed to save task:', error);
      setCreateError(error?.response?.data?.message || 'Failed to save task.');
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setCreateForm(EMPTY_FORM);
    setShowCreateForm(false);
    setCreateError('');
    setSchedulePreview(null);
  };

  const openEditForm = (task: Task) => {
    setCreateError('');
    setShowCreateForm(true);
    setCreateForm({
      id: task.id,
      name: task.name,
      description: task.description,
      agentId: task.agentId || '',
      schedule: task.schedule || '',
      workspaceId: task.workspaceId || 'default',
    });
    if (task.schedule) {
      void previewSchedule(task.schedule);
    } else {
      setSchedulePreview(null);
    }
  };

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const query = searchQuery.toLowerCase();
        return (
          task.name.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query) ||
          (task.schedule || '').toLowerCase().includes(query)
        );
      }),
    [tasks, searchQuery],
  );

  const selectedTask = useMemo(() => {
    const taskId = selectedRunDetail?.definition?.id || selectedRun?.taskId || (selectedRun as any)?.definitionId;
    return tasks.find((task) => task.id === taskId) || null;
  }, [selectedRun, selectedRunDetail, tasks]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="mono pulse-text" style={{ fontSize: '0.8rem', letterSpacing: '2px' }}>[ INITIALIZING_TASK_ENGINE ]</div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '0.5rem' }}>Task Matrix</h1>
          <p className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            // DEFINITIONS: {tasks.length} | RUNS: {runs.length} | AGENTS: {agents.length}
          </p>
        </div>
        <button
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => {
            if (showCreateForm && !createForm.id) {
              resetForm();
              return;
            }
            setShowCreateForm(true);
            if (createForm.id) {
              resetForm();
              setShowCreateForm(true);
            }
          }}
        >
          <FiPlus /> {showCreateForm && !createForm.id ? 'CLOSE' : 'CREATE_TASK'}
        </button>
      </div>

      {showCreateForm && (
        <div className="glass-card" style={{ marginBottom: '2rem', display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{createForm.id ? 'Edit Task' : 'Create Task'}</h2>
            <button className="btn-ghost" onClick={resetForm}>
              CLOSE
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <label className="mono" style={fieldStyle}>
              TASK_NAME
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="Daily Workspace Scan"
                style={inputStyle}
              />
            </label>

            <label className="mono" style={fieldStyle}>
              AGENT
              <select
                value={createForm.agentId}
                onChange={(e) => setCreateForm((current) => ({ ...current, agentId: e.target.value }))}
                style={inputStyle}
              >
                <option value="">Default agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}{agent.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="mono" style={fieldStyle}>
              SCHEDULE_OPTIONAL
              <input
                value={createForm.schedule}
                onChange={(e) => setCreateForm((current) => ({ ...current, schedule: e.target.value }))}
                placeholder="0 */6 * * *"
                style={inputStyle}
              />
            </label>

            <label className="mono" style={fieldStyle}>
              WORKSPACE_ID
              <input
                value={createForm.workspaceId}
                onChange={(e) => setCreateForm((current) => ({ ...current, workspaceId: e.target.value }))}
                placeholder="default"
                style={inputStyle}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Hourly', value: '0 * * * *' },
              { label: 'Every 6 Hours', value: '0 */6 * * *' },
              { label: 'Daily 9 AM', value: '0 9 * * *' },
              { label: 'Weekdays 9 AM', value: '0 9 * * 1-5' },
            ].map((preset) => (
              <button
                key={preset.label}
                className="btn-ghost"
                onClick={() => setCreateForm((current) => ({ ...current, schedule: preset.value }))}
                style={{ fontSize: '0.75rem' }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <label className="mono" style={fieldStyle}>
            DESCRIPTION
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((current) => ({ ...current, description: e.target.value }))}
              placeholder="Describe what this task should do."
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'grid', gap: '0.35rem' }}>
            <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Schedule preview
            </div>
            {createForm.schedule.trim() ? (
              previewLoading ? (
                <div style={metaCardStyle}>Checking schedule...</div>
              ) : schedulePreview?.valid ? (
                <div style={metaCardStyle}>
                  Next run: {schedulePreview.nextRun ? new Date(schedulePreview.nextRun).toLocaleString() : 'Unavailable'}
                </div>
              ) : (
                <div style={{ ...metaCardStyle, color: 'var(--error)' }}>
                  {schedulePreview?.error || 'Invalid schedule'}
                </div>
              )
            ) : (
              <div style={metaCardStyle}>No schedule. This task will run manually only.</div>
            )}
          </div>

          {createError && (
            <div className="mono" style={{ color: 'var(--error)', fontSize: '0.75rem' }}>
              {createError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button className="btn-ghost" onClick={resetForm} disabled={creating}>
              CANCEL
            </button>
            <button className="btn-primary" onClick={saveTask} disabled={creating} style={{ opacity: creating ? 0.7 : 1 }}>
              {creating ? 'SAVING...' : createForm.id ? 'UPDATE_TASK' : 'SAVE_TASK'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(340px, 0.9fr)', gap: '2rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card" style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <FiSearch style={{ color: 'var(--text-muted)' }} />
            <input
              className="mono"
              type="text"
              placeholder="SEARCH_TASK_REGISTRY..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ background: 'none', border: 'none', color: 'var(--text-primary)', outline: 'none', width: '100%', fontSize: '0.85rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
            {filteredTasks.length === 0 ? (
              <div className="glass-card mono" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                NO_TASKS_DISCOVERED
              </div>
            ) : (
              filteredTasks.map((task) => {
                const agent = agents.find((candidate) => candidate.id === task.agentId);
                return (
                  <div key={task.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{task.name}</h3>
                        <div className="mono" style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {agent ? `AGENT: ${agent.name}` : 'AGENT: default routing'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button className="btn-ghost" style={{ padding: '6px' }} onClick={() => void runTask(task.id)} title="Run now">
                          <FiPlay size={16} style={{ color: 'var(--neon-cyan)' }} />
                        </button>
                        <button className="btn-ghost" style={{ padding: '6px' }} onClick={() => openEditForm(task)} title="Edit task">
                          <FiEdit2 size={15} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button className="btn-ghost" style={{ padding: '6px' }} onClick={() => void deleteTask(task.id)} title="Delete task">
                          <FiTrash2 size={15} style={{ color: 'var(--error)' }} />
                        </button>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{task.description}</p>

                    <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      <div>Workspace: <span className="mono">{task.workspaceId || 'default'}</span></div>
                      <div>Last run: <span className="mono">{task.lastRunStatus || 'never_run'}</span></div>
                      <div>
                        Next run:{' '}
                        <span className="mono">
                          {task.nextRun ? new Date(task.nextRun).toLocaleString() : task.schedule ? 'Unable to resolve' : 'manual only'}
                        </span>
                      </div>
                    </div>

                    {task.schedule && (
                      <div className="mono" style={pillStyle}>
                        <FiClock size={12} /> {task.schedule}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <aside className="glass-card" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', minHeight: '70vh', overflow: 'hidden', padding: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.02)' }}>
            <h2 className="mono" style={{ fontSize: '0.85rem', color: 'var(--neon-cyan)', margin: 0 }}>[ EXECUTION_LOG ]</h2>
          </div>

          <div style={{ overflowY: 'auto', padding: '1rem', display: 'grid', gap: '0.75rem', alignContent: 'start' }}>
            {runs.length === 0 ? (
              <div className="mono" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                WAITING_FOR_INPUT...
              </div>
            ) : (
              runs.map((run) => {
                const isActive = selectedRun?.id === run.id;
                const runTaskName = run.task?.name || (run as any).definition?.name || 'Background Task';
                return (
                  <button
                    key={run.id}
                    className="btn-ghost"
                    onClick={() => setSelectedRun(run)}
                    style={{
                      textAlign: 'left',
                      padding: '0.8rem',
                      borderRadius: '10px',
                      border: `1px solid ${isActive ? 'rgba(0, 240, 255, 0.35)' : 'var(--border-glass)'}`,
                      background: isActive ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.02)',
                      display: 'grid',
                      gap: '0.45rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{runTaskName}</div>
                      <StatusBadge status={run.status} />
                    </div>
                    <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><FiHash size={10} /> {run.id.slice(0, 8)}</span>
                      <span>{run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }).toUpperCase() : 'PENDING'}</span>
                    </div>
                    {run.errorMessage ? (
                      <div style={{ fontSize: '0.76rem', color: 'var(--error)' }}>{run.errorMessage}</div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border-glass)', padding: '1rem', background: 'rgba(255,255,255,0.015)' }}>
            {selectedRun ? (
              runDetailLoading ? (
                <div style={{ color: 'var(--text-muted)' }}>Loading run details...</div>
              ) : selectedRunDetail ? (
                <div style={{ display: 'grid', gap: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{selectedTask?.name || selectedRunDetail.definition?.name || 'Run Detail'}</div>
                      <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{selectedRunDetail.id}</div>
                    </div>
                    <StatusBadge status={selectedRunDetail.status} />
                  </div>

                  <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <div>Created: <span className="mono">{new Date(selectedRunDetail.createdAt).toLocaleString()}</span></div>
                    {selectedRunDetail.startedAt ? <div>Started: <span className="mono">{new Date(selectedRunDetail.startedAt).toLocaleString()}</span></div> : null}
                    {selectedRunDetail.finishedAt ? <div>Finished: <span className="mono">{new Date(selectedRunDetail.finishedAt).toLocaleString()}</span></div> : null}
                    {selectedRunDetail.resumedFromRunId ? <div>Resumed from: <span className="mono">{selectedRunDetail.resumedFromRunId}</span></div> : null}
                    {selectedTask?.description ? <div>Description: {selectedTask.description}</div> : null}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {selectedRunDetail.outputPath ? (
                      <>
                        <a className="btn-ghost" href={`/api/tasks/runs/${selectedRunDetail.id}/artifact`} style={smallButtonStyle}>
                          <FiDownload size={13} /> Download Artifact
                        </a>
                        <a className="btn-ghost" href={selectedRunDetail.outputPath} target="_blank" rel="noreferrer" style={smallButtonStyle}>
                          <FiExternalLink size={13} /> View Output
                        </a>
                      </>
                    ) : null}
                    <button className="btn-ghost" onClick={() => void deleteRun(selectedRunDetail.id)} style={smallButtonStyle}>
                      <FiTrash2 size={13} /> Delete Run
                    </button>
                  </div>

                  {selectedRunDetail.errorMessage ? (
                    <div style={{ ...metaCardStyle, color: 'var(--error)' }}>
                      {selectedRunDetail.errorMessage}
                    </div>
                  ) : null}

                  <div>
                    <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                      RUN STEPS
                    </div>
                    {selectedRunDetail.steps?.length ? (
                      <div style={{ display: 'grid', gap: '0.45rem', maxHeight: '180px', overflowY: 'auto' }}>
                        {selectedRunDetail.steps.map((step) => (
                          <div key={step.id} style={stepCardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                              <strong style={{ fontSize: '0.78rem' }}>{step.stepType}</strong>
                              <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{step.timestamp}</span>
                            </div>
                            {step.toolName ? <div style={{ fontSize: '0.76rem' }}>Tool: <code>{step.toolName}</code></div> : null}
                            {step.inputSummary ? <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{step.inputSummary}</div> : null}
                            {step.outputSummary ? <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{step.outputSummary}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={metaCardStyle}>No recorded steps.</div>
                    )}
                  </div>

                  <div>
                    <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                      PROVENANCE
                    </div>
                    <pre style={provenanceStyle}>
                      {JSON.stringify(selectedRunDetail.provenance || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>Run details unavailable.</div>
              )
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>Select a run to inspect provenance, steps, errors, and artifacts.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: '0.62rem',
        fontWeight: 700,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        padding: '1px 6px',
        borderRadius: '4px',
        color: getStatusTextColor(status),
        background: getStatusColor(status, 0.12),
      }}
    >
      {status}
    </span>
  );
}

function getStatusColor(status: string, opacity = 1) {
  switch (status) {
    case 'queued': return `rgba(180, 180, 180, ${opacity})`;
    case 'requeued': return `rgba(180, 180, 180, ${opacity * 0.9})`;
    case 'running': return `rgba(0, 240, 255, ${opacity})`;
    case 'done':
    case 'completed': return `rgba(0, 255, 150, ${opacity})`;
    case 'failed': return `rgba(255, 77, 77, ${opacity})`;
    case 'stale': return `rgba(255, 170, 0, ${opacity})`;
    case 'cancelled': return `rgba(255, 255, 255, ${opacity * 0.3})`;
    default: return `rgba(255, 255, 255, ${opacity})`;
  }
}

function getStatusTextColor(status: string) {
  switch (status) {
    case 'queued': return 'var(--text-muted)';
    case 'requeued': return 'var(--text-muted)';
    case 'running': return 'var(--neon-cyan)';
    case 'done':
    case 'completed': return 'var(--neon-green, #00ff96)';
    case 'failed': return 'var(--error, #ef4444)';
    case 'stale': return '#ffb84d';
    case 'cancelled': return 'var(--text-muted)';
    default: return 'var(--text-primary)';
  }
}

const fieldStyle: React.CSSProperties = { display: 'grid', gap: '0.5rem', fontSize: '0.75rem' };
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.85rem' };
const metaCardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' };
const provenanceStyle: React.CSSProperties = { margin: 0, padding: '0.75rem', maxHeight: '180px', overflow: 'auto', background: 'rgba(0,0,0,0.22)', border: '1px solid var(--border-glass)', borderRadius: '10px', fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const stepCardStyle: React.CSSProperties = { padding: '0.65rem', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', display: 'grid', gap: '0.3rem' };
const smallButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', padding: '0.45rem 0.7rem' };
const pillStyle: React.CSSProperties = { fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: '999px', background: 'rgba(0,200,200,0.06)', color: 'var(--accent-cyan)', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' };

export default Tasks;
