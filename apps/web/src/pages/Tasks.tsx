import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentProfile, RunStep, Task, TaskRun, TaskRunListResponse, TaskRunStatus, ToolInfo } from '@rawclaw/shared';
import { formatDistanceToNow } from 'date-fns';
import {
  FiClock,
  FiDownload,
  FiEdit2,
  FiExternalLink,
  FiHash,
  FiPlay,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiSlash,
  FiTrash2,
} from 'react-icons/fi';
import { api } from '../lib/api';
import { RunSummaryCard } from '../components/tasks/RunSummaryCard';

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
  enabled: boolean;
  toolMode: 'all' | 'selected';
  toolIds: string[];
};

type RunFilters = {
  status: 'all' | TaskRunStatus;
  agentId: string;
  sessionId: string;
};

type RunDetail = TaskRun & {
  definition?: Task;
  provenance?: any;
  steps: RunStep[];
};

type AsyncActionState =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'error'; id: string; message: string };

const EMPTY_FORM: TaskFormState = {
  name: '',
  description: '',
  agentId: '',
  schedule: '',
  workspaceId: 'default',
  enabled: true,
  toolMode: 'all',
  toolIds: [],
};

const DEFAULT_RUN_FILTERS: RunFilters = {
  status: 'all',
  agentId: '',
  sessionId: '',
};

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [toolOptions, setToolOptions] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState<TaskFormState>(EMPTY_FORM);
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<TaskRun | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<RunDetail | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [runsPage, setRunsPage] = useState(1);
  const [runsMeta, setRunsMeta] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [runFilters, setRunFilters] = useState<RunFilters>(DEFAULT_RUN_FILTERS);
  const [resumeState, setResumeState] = useState<AsyncActionState>({ status: 'idle' });
  const [cancelState, setCancelState] = useState<AsyncActionState>({ status: 'idle' });
  const [toggleState, setToggleState] = useState<AsyncActionState>({ status: 'idle' });

  const fetchRegistry = useCallback(async () => {
    const [tasksRes, agentsRes, toolsRes] = await Promise.all([
      api.get<Task[]>('/tasks'),
      api.get<AgentProfile[]>('/agents'),
      api.get<{ tools: ToolInfo[]; count: number }>('/tools/info'),
    ]);
    setTasks(tasksRes.data);
    setAgents(agentsRes.data);
    setToolOptions(toolsRes.data.tools || []);
  }, []);

  const fetchRuns = useCallback(async () => {
    const response = await api.get<TaskRunListResponse>('/tasks/runs', {
      params: {
        page: runsPage,
        limit: runsMeta.limit,
        status: runFilters.status !== 'all' ? runFilters.status : undefined,
        agentId: runFilters.agentId || undefined,
        sessionId: runFilters.sessionId.trim() || undefined,
      },
    });

    setRuns(response.data.items || []);
    setRunsMeta({
      page: response.data.page,
      limit: response.data.limit,
      total: response.data.total,
      totalPages: response.data.totalPages,
    });
  }, [runFilters, runsMeta.limit, runsPage]);

  const fetchAll = useCallback(async () => {
    try {
      await Promise.all([fetchRegistry(), fetchRuns()]);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [fetchRegistry, fetchRuns]);

  useEffect(() => {
    void fetchAll();
    const interval = window.setInterval(() => void fetchAll(), 5000);
    return () => window.clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    if (!selectedRun) {
      setSelectedRunDetail(null);
      return;
    }
    void loadRunDetail(selectedRun.id);
  }, [selectedRun]);

  useEffect(() => {
    if (!selectedRun) {
      return;
    }

    const freshRun = runs.find((candidate) => candidate.id === selectedRun.id);
    if (!freshRun) {
      return;
    }

    if (freshRun.status !== selectedRun.status || freshRun.errorMessage !== selectedRun.errorMessage || freshRun.finishedAt !== selectedRun.finishedAt) {
      setSelectedRun(freshRun);
      void loadRunDetail(freshRun.id);
    }
  }, [runs, selectedRun]);

  useEffect(() => {
    if (cancelState.status !== 'loading') {
      return;
    }

    const matchingRun = runs.find((run) => run.id === cancelState.id);
    if (!matchingRun || !['queued', 'running', 'cancelling'].includes(matchingRun.status)) {
      setCancelState({ status: 'idle' });
    }
  }, [cancelState, runs]);

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
      const response = await api.get<RunDetail>(`/tasks/runs/${runId}`);
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
      await fetchAll();
    } catch (error) {
      console.error('Failed to run task:', error);
    }
  };

  const resumeRun = async (runId: string) => {
    setResumeState({ status: 'loading', id: runId });
    try {
      await api.post(`/tasks/runs/${runId}/resume`, {});
      setResumeState({ status: 'idle' });
      await fetchAll();
    } catch (error: any) {
      setResumeState({
        status: 'error',
        id: runId,
        message: error?.response?.data?.message || error?.message || 'Resume failed',
      });
    }
  };

  const cancelRun = async (runId: string) => {
    setCancelState({ status: 'loading', id: runId });
    try {
      await api.post(`/tasks/runs/${runId}/cancel`, {});
      await fetchAll();
      if (selectedRun?.id === runId) {
        void loadRunDetail(runId);
      }
    } catch (error: any) {
      setCancelState({
        status: 'error',
        id: runId,
        message: error?.response?.data?.message || error?.message || 'Cancel failed',
      });
    }
  };

  const deleteTask = async (id: string) => {
    if (!window.confirm('Delete this task definition?')) {
      return;
    }
    try {
      await api.delete(`/tasks/${id}`);
      if (createForm.id === id) {
        resetForm();
      }
      await fetchAll();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const deleteRun = async (runId: string) => {
    if (!window.confirm('Delete this task run?')) {
      return;
    }
    try {
      await api.delete(`/tasks/runs/${runId}`);
      if (selectedRun?.id === runId) {
        setSelectedRun(null);
        setSelectedRunDetail(null);
      }
      await fetchAll();
    } catch (error) {
      console.error('Failed to delete run:', error);
    }
  };

  const toggleTaskEnabled = async (task: Task) => {
    setToggleState({ status: 'loading', id: task.id });
    try {
      await api.patch(`/tasks/${task.id}`, { enabled: !task.enabled });
      setToggleState({ status: 'idle' });
      await fetchAll();
    } catch (error: any) {
      setToggleState({
        status: 'error',
        id: task.id,
        message: error?.response?.data?.message || error?.message || 'Failed to update task schedule state.',
      });
    }
  };

  const saveTask = async () => {
    const payload = {
      name: createForm.name.trim(),
      description: createForm.description.trim(),
      agentId: createForm.agentId.trim() || undefined,
      schedule: createForm.schedule.trim() || undefined,
      workspaceId: createForm.workspaceId.trim() || 'default',
      enabled: createForm.enabled,
      toolIds: createForm.toolMode === 'selected' ? createForm.toolIds : [],
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
      await fetchAll();
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
      enabled: task.enabled ?? true,
      toolMode: task.toolIds?.length ? 'selected' : 'all',
      toolIds: task.toolIds || [],
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
        const query = searchQuery.toLowerCase().trim();
        if (!query) {
          return true;
        }
        return (
          task.name.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query) ||
          (task.schedule || '').toLowerCase().includes(query) ||
          (task.agentId || '').toLowerCase().includes(query)
        );
      }),
    [searchQuery, tasks],
  );

  const selectedTask = useMemo(() => {
    const taskId = selectedRunDetail?.definition?.id || selectedRun?.taskId;
    return tasks.find((task) => task.id === taskId) || null;
  }, [selectedRun, selectedRunDetail, tasks]);

  const actionError = (runId: string) => {
    if (resumeState.status === 'error' && resumeState.id === runId) {
      return resumeState.message;
    }
    if (cancelState.status === 'error' && cancelState.id === runId) {
      return cancelState.message;
    }
    return null;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="mono pulse-text" style={{ fontSize: '0.8rem', letterSpacing: '2px' }}>[ INITIALIZING_TASK_ENGINE ]</div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '0.5rem' }}>Task Matrix</h1>
          <p className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            // DEFINITIONS: {tasks.length} | RUNS: {runsMeta.total} | AGENTS: {agents.length}
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

      {showCreateForm ? (
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

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Tool scope
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn-ghost"
                onClick={() => setCreateForm((current) => ({ ...current, toolMode: 'all', toolIds: [] }))}
                style={createForm.toolMode === 'all' ? activePillStyle : inactivePillStyle}
              >
                All tools
              </button>
              <button
                className="btn-ghost"
                onClick={() => setCreateForm((current) => ({ ...current, toolMode: 'selected' }))}
                style={createForm.toolMode === 'selected' ? activePillStyle : inactivePillStyle}
              >
                Selected tools
              </button>
            </div>

            {createForm.toolMode === 'selected' ? (
              <div style={toolPickerStyle}>
                {toolOptions.map((tool) => {
                  const checked = createForm.toolIds.includes(tool.name);
                  return (
                    <label key={tool.name} style={toolOptionStyle}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCreateForm((current) => ({
                            ...current,
                            toolIds: e.target.checked
                              ? [...current.toolIds, tool.name]
                              : current.toolIds.filter((entry) => entry !== tool.name),
                          }))
                        }
                      />
                      <div style={{ display: 'grid', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tool.name}</span>
                          <span className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                            {tool.health_status?.status || 'unknown'}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {tool.description}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div style={metaCardStyle}>This task can use any available tool.</div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ display: 'grid', gap: '0.35rem', flex: 1, minWidth: '260px' }}>
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

            <div style={toggleGroupStyle}>
              <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Scheduled task state
              </div>
              <button
                className="btn-ghost"
                onClick={() => setCreateForm((current) => ({ ...current, enabled: !current.enabled }))}
                style={createForm.enabled ? activePillStyle : inactivePillStyle}
              >
                {createForm.enabled ? 'Enabled' : 'Paused'}
              </button>
            </div>
          </div>

          {createError ? (
            <div className="mono" style={{ color: 'var(--error)', fontSize: '0.75rem' }}>
              {createError}
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button className="btn-ghost" onClick={resetForm} disabled={creating}>
              CANCEL
            </button>
            <button className="btn-primary" onClick={saveTask} disabled={creating} style={{ opacity: creating ? 0.7 : 1 }}>
              {creating ? 'SAVING...' : createForm.id ? 'UPDATE_TASK' : 'SAVE_TASK'}
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(360px, 0.9fr)', gap: '2rem', alignItems: 'start' }}>
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
                const isToggling = toggleState.status === 'loading' && toggleState.id === task.id;

                return (
                  <div key={task.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{task.name}</h3>
                        <div className="mono" style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {agent ? `AGENT: ${agent.name}` : 'AGENT: default routing'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {task.schedule ? (
                          <button
                            className="btn-ghost"
                            style={task.enabled ? activePillStyle : inactivePillStyle}
                            onClick={() => void toggleTaskEnabled(task)}
                            disabled={isToggling}
                            title={task.enabled ? 'Pause scheduled task' : 'Enable scheduled task'}
                          >
                            {isToggling ? 'Saving...' : task.enabled ? 'Enabled' : 'Paused'}
                          </button>
                        ) : null}
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
                      <div>Tools: <span className="mono">{task.toolIds.length ? `${task.toolIds.length} selected` : 'all tools'}</span></div>
                      <div>Last run: <span className="mono">{task.lastRunStatus || 'never_run'}</span></div>
                      <div>
                        Next run:{' '}
                        <span className="mono">
                          {task.schedule
                            ? task.enabled
                              ? (task.nextRun ? new Date(task.nextRun).toLocaleString() : 'Unable to resolve')
                              : 'paused'
                            : 'manual only'}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {task.schedule ? (
                        <div className="mono" style={pillStyle}>
                          <FiClock size={12} /> {task.schedule}
                        </div>
                      ) : (
                        <div className="mono" style={pillStyle}>
                          <FiPlay size={12} /> manual only
                        </div>
                      )}
                    </div>

                    {toggleState.status === 'error' && toggleState.id === task.id ? (
                      <div className="mono" style={{ color: 'var(--error)', fontSize: '0.72rem' }}>
                        {toggleState.message}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <aside className="glass-card" style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr) auto', minHeight: '72vh', overflow: 'hidden', padding: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.02)' }}>
            <h2 className="mono" style={{ fontSize: '0.85rem', color: 'var(--neon-cyan)', margin: 0 }}>[ EXECUTION_LOG ]</h2>
          </div>

          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-glass)', display: 'grid', gap: '0.75rem' }}>
            <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>RUN FILTERS</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.6rem' }}>
              <select
                value={runFilters.status}
                onChange={(e) => {
                  setRunsPage(1);
                  setRunFilters((current) => ({ ...current, status: e.target.value as RunFilters['status'] }));
                }}
                style={filterInputStyle}
              >
                <option value="all">All statuses</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="cancelling">Cancelling</option>
                <option value="done">Done</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <select
                value={runFilters.agentId}
                onChange={(e) => {
                  setRunsPage(1);
                  setRunFilters((current) => ({ ...current, agentId: e.target.value }));
                }}
                style={filterInputStyle}
              >
                <option value="">All agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>

              <input
                value={runFilters.sessionId}
                onChange={(e) => {
                  setRunsPage(1);
                  setRunFilters((current) => ({ ...current, sessionId: e.target.value }));
                }}
                placeholder="Session ID"
                style={filterInputStyle}
              />
            </div>
          </div>

          <div style={{ overflowY: 'auto', padding: '1rem', display: 'grid', gap: '0.75rem', alignContent: 'start' }}>
            {runs.length === 0 ? (
              <div className="mono" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                NO_RUNS_MATCH_THE_CURRENT_FILTERS
              </div>
            ) : (
              runs.map((run) => {
                const isActive = selectedRun?.id === run.id;
                const runTaskName = resolveRunTaskName(run);
                const isResuming = resumeState.status === 'loading' && resumeState.id === run.id;
                const isCancelling = cancelState.status === 'loading' && cancelState.id === run.id;
                const message = actionError(run.id);

                return (
                  <div
                    key={run.id}
                    className="btn-ghost"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRun(run)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedRun(run);
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '0.8rem',
                      borderRadius: '10px',
                      border: `1px solid ${isActive ? 'rgba(0, 240, 255, 0.35)' : 'var(--border-glass)'}`,
                      background: isActive ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.02)',
                      display: 'grid',
                      gap: '0.5rem',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{runTaskName}</div>
                      <StatusBadge status={run.status} />
                    </div>

                    <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><FiHash size={10} /> {run.id.slice(0, 8)}</span>
                      <span>{run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }).toUpperCase() : 'QUEUED'}</span>
                      {run.sessionId ? <span>SESSION: {run.sessionId.slice(0, 8)}</span> : null}
                    </div>

                    {run.errorMessage ? (
                      <div style={{ fontSize: '0.76rem', color: 'var(--error)' }}>{run.errorMessage}</div>
                    ) : null}

                    {message ? (
                      <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--error)' }}>
                        {message}
                      </div>
                    ) : null}

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                        {run.selectedAgent ? `Agent: ${run.selectedAgent}` : 'Agent: default'}
                      </div>

                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {(run.status === 'failed' || run.status === 'cancelled') ? (
                          <button
                            className="btn-ghost"
                            style={rowActionStyle}
                            disabled={isResuming}
                            onClick={(event) => {
                              event.stopPropagation();
                              void resumeRun(run.id);
                            }}
                          >
                            {isResuming ? <FiRefreshCw className="spin" size={11} /> : <FiPlay size={11} />}
                            {isResuming ? 'Resuming...' : 'Resume'}
                          </button>
                        ) : null}

                        {(run.status === 'queued' || run.status === 'running') ? (
                          <button
                            className="btn-ghost"
                            style={rowActionStyle}
                            disabled={isCancelling}
                            onClick={(event) => {
                              event.stopPropagation();
                              void cancelRun(run.id);
                            }}
                          >
                            {isCancelling ? <FiRefreshCw className="spin" size={11} /> : <FiSlash size={11} />}
                            {isCancelling ? 'Cancelling...' : 'Cancel'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border-glass)', padding: '1rem', background: 'rgba(255,255,255,0.015)', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                PAGE {runsMeta.page} / {runsMeta.totalPages} • {runsMeta.total} TOTAL RUNS
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn-ghost"
                  style={smallButtonStyle}
                  onClick={() => setRunsPage((current) => Math.max(1, current - 1))}
                  disabled={runsMeta.page <= 1}
                >
                  Previous
                </button>
                <button
                  className="btn-ghost"
                  style={smallButtonStyle}
                  onClick={() => setRunsPage((current) => Math.min(runsMeta.totalPages, current + 1))}
                  disabled={runsMeta.page >= runsMeta.totalPages}
                >
                  Next
                </button>
              </div>
            </div>

            {selectedRun ? (
              runDetailLoading ? (
                <div style={{ color: 'var(--text-muted)' }}>Loading run details...</div>
              ) : selectedRunDetail ? (
                <div style={{ display: 'grid', gap: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{selectedTask?.name || selectedRunDetail.definition?.name || resolveRunTaskName(selectedRunDetail)}</div>
                      <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{selectedRunDetail.id}</div>
                    </div>
                    <StatusBadge status={selectedRunDetail.status} />
                  </div>

                  <RunSummaryCard
                    run={{
                      ...selectedRunDetail,
                      task: selectedTask || selectedRunDetail.definition || undefined,
                    }}
                  />

                  <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <div>Created: <span className="mono">{new Date(selectedRunDetail.createdAt).toLocaleString()}</span></div>
                    {selectedRunDetail.startedAt ? <div>Started: <span className="mono">{new Date(selectedRunDetail.startedAt).toLocaleString()}</span></div> : null}
                    {selectedRunDetail.finishedAt ? <div>Finished: <span className="mono">{new Date(selectedRunDetail.finishedAt).toLocaleString()}</span></div> : null}
                    {selectedRunDetail.resumedFromRunId ? <div>Resumed from: <span className="mono">{selectedRunDetail.resumedFromRunId}</span></div> : null}
                    {selectedRunDetail.sessionId ? (
                      <div>
                        Originating chat:{' '}
                        <a href={`/chat/${selectedRunDetail.sessionId}`} style={{ color: 'var(--accent-cyan)' }}>
                          Open session
                        </a>
                      </div>
                    ) : null}
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                              <strong style={{ fontSize: '0.78rem' }}>{humanizeStepType(step.stepType)}</strong>
                              <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{new Date(step.timestamp).toLocaleString()}</span>
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

                  <details style={{ display: 'grid', gap: '0.5rem' }}>
                    <summary className="mono" style={{ cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      TECHNICAL DETAILS
                    </summary>
                    <pre style={provenanceStyle}>
                      {JSON.stringify(selectedRunDetail.provenance || {}, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>Run details unavailable.</div>
              )
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>Select a run to inspect what happened, decide whether to retry, and open the raw trace only if you need it.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

function resolveRunTaskName(run: TaskRun | RunDetail) {
  return run.task?.name || (run as RunDetail).definition?.name || 'Background Task';
}

function humanizeStepType(stepType: RunStep['stepType']) {
  return stepType.replace(/_/g, ' ');
}

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
    case 'running': return `rgba(0, 240, 255, ${opacity})`;
    case 'cancelling': return `rgba(245, 158, 11, ${opacity})`;
    case 'done': return `rgba(0, 255, 150, ${opacity})`;
    case 'failed': return `rgba(255, 77, 77, ${opacity})`;
    case 'cancelled': return `rgba(255, 255, 255, ${opacity * 0.3})`;
    default: return `rgba(255, 255, 255, ${opacity})`;
  }
}

function getStatusTextColor(status: string) {
  switch (status) {
    case 'queued': return 'var(--text-muted)';
    case 'running': return 'var(--neon-cyan)';
    case 'cancelling': return '#f59e0b';
    case 'done': return 'var(--neon-green, #00ff96)';
    case 'failed': return 'var(--error, #ef4444)';
    case 'cancelled': return 'var(--text-muted)';
    default: return 'var(--text-primary)';
  }
}

const fieldStyle: React.CSSProperties = { display: 'grid', gap: '0.5rem', fontSize: '0.75rem' };
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.85rem' };
const filterInputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.7rem', fontSize: '0.78rem' };
const metaCardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '10px', padding: '0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' };
const provenanceStyle: React.CSSProperties = { margin: 0, padding: '0.75rem', maxHeight: '220px', overflow: 'auto', background: 'rgba(0,0,0,0.22)', border: '1px solid var(--border-glass)', borderRadius: '10px', fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const stepCardStyle: React.CSSProperties = { padding: '0.65rem', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', display: 'grid', gap: '0.3rem' };
const smallButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', padding: '0.45rem 0.7rem' };
const rowActionStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', padding: '0.35rem 0.6rem' };
const pillStyle: React.CSSProperties = { fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: '999px', background: 'rgba(0,200,200,0.06)', color: 'var(--accent-cyan)', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' };
const activePillStyle: React.CSSProperties = { fontSize: '0.72rem', padding: '0.35rem 0.7rem', borderRadius: '999px', color: 'var(--neon-cyan)', border: '1px solid rgba(0, 240, 255, 0.24)', background: 'rgba(0, 240, 255, 0.06)' };
const inactivePillStyle: React.CSSProperties = { fontSize: '0.72rem', padding: '0.35rem 0.7rem', borderRadius: '999px', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' };
const toolPickerStyle: React.CSSProperties = { display: 'grid', gap: '0.55rem', maxHeight: '220px', overflowY: 'auto', padding: '0.8rem', border: '1px solid var(--border-glass)', borderRadius: '10px', background: 'rgba(255,255,255,0.02)' };
const toolOptionStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gap: '0.65rem', alignItems: 'start' };
const toggleGroupStyle: React.CSSProperties = { display: 'grid', gap: '0.5rem', minWidth: '180px' };

export default Tasks;
