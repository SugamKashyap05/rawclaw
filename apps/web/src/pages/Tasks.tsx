import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Task, TaskRun } from '@rawclaw/shared';
import { formatDistanceToNow } from 'date-fns';
import { 
  FiPlay, FiPlus, FiClock, FiMoreVertical, FiSearch 
} from 'react-icons/fi';

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    agentId: '',
    schedule: '',
    workspaceId: 'default',
  });

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [tasksRes, runsRes] = await Promise.all([
        api.get('/tasks'),
        api.get('/tasks/runs/recent')
      ]);
      setTasks(tasksRes.data);
      setRuns(runsRes.data);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const runTask = async (id: string) => {
    try {
      await api.post(`/tasks/${id}/run`);
      fetchData();
    } catch (error) {
      console.error('Failed to run task:', error);
    }
  };

  const createTask = async () => {
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
      await api.post('/tasks', payload);
      setCreateForm({
        name: '',
        description: '',
        agentId: '',
        schedule: '',
        workspaceId: 'default',
      });
      setShowCreateForm(false);
      await fetchData();
    } catch (error: any) {
      console.error('Failed to create task:', error);
      setCreateError(error?.response?.data?.message || 'Failed to create task.');
    } finally {
      setCreating(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'var(--accent-cyan)';
      case 'done': return 'var(--success)';
      case 'failed': return 'var(--error)';
      default: return 'var(--text-muted)';
    }
  };

  const filteredTasks = tasks.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div className="mono pulse-text" style={{ fontSize: '0.8rem', letterSpacing: '2px' }}>[ INITIALIZING_TASK_ENGINE ]</div>
    </div>
  );

  return (
    <div className="animate-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '3rem' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '0.5rem' }}>Task Matrix</h1>
          <p className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            // ACTIVE_AGENTS: {tasks.length} | TOTAL_EXECUTIONS: {runs.length}
          </p>
        </div>
        <button
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => {
            setCreateError('');
            setShowCreateForm((current) => !current);
          }}
        >
          <FiPlus /> CREATE_TASK
        </button>
      </div>

      {showCreateForm && (
        <div className="glass-card" style={{ marginBottom: '2rem', display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Create Task</h2>
            <button className="btn-ghost" onClick={() => setShowCreateForm(false)}>
              CLOSE
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <label className="mono" style={{ display: 'grid', gap: '0.5rem', fontSize: '0.75rem' }}>
              TASK_NAME
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="Daily Workspace Scan"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.85rem' }}
              />
            </label>

            <label className="mono" style={{ display: 'grid', gap: '0.5rem', fontSize: '0.75rem' }}>
              AGENT_ID_OPTIONAL
              <input
                value={createForm.agentId}
                onChange={(e) => setCreateForm((current) => ({ ...current, agentId: e.target.value }))}
                placeholder="Leave blank for default agent"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.85rem' }}
              />
            </label>

            <label className="mono" style={{ display: 'grid', gap: '0.5rem', fontSize: '0.75rem' }}>
              SCHEDULE_OPTIONAL
              <input
                value={createForm.schedule}
                onChange={(e) => setCreateForm((current) => ({ ...current, schedule: e.target.value }))}
                placeholder="0 */6 * * *"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.85rem' }}
              />
            </label>

            <label className="mono" style={{ display: 'grid', gap: '0.5rem', fontSize: '0.75rem' }}>
              WORKSPACE_ID
              <input
                value={createForm.workspaceId}
                onChange={(e) => setCreateForm((current) => ({ ...current, workspaceId: e.target.value }))}
                placeholder="default"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.85rem' }}
              />
            </label>
          </div>

          <label className="mono" style={{ display: 'grid', gap: '0.5rem', fontSize: '0.75rem' }}>
            DESCRIPTION
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((current) => ({ ...current, description: e.target.value }))}
              placeholder="Describe what this task should do."
              rows={4}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.85rem', resize: 'vertical' }}
            />
          </label>

          {createError && (
            <div className="mono" style={{ color: 'var(--error)', fontSize: '0.75rem' }}>
              {createError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button className="btn-ghost" onClick={() => setShowCreateForm(false)} disabled={creating}>
              CANCEL
            </button>
            <button className="btn-primary" onClick={createTask} disabled={creating} style={{ opacity: creating ? 0.7 : 1 }}>
              {creating ? 'CREATING...' : 'SAVE_TASK'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '2rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
            {filteredTasks.length === 0 ? (
              <div className="glass-card mono" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                NO_TASKS_DISCOVERED
              </div>
            ) : (
              filteredTasks.map(task => (
                <div key={task.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{task.name}</h3>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn-ghost" style={{ padding: '4px' }} onClick={() => runTask(task.id)} title="Manual Override">
                        <FiPlay size={16} style={{ color: 'var(--neon-cyan)' }} />
                      </button>
                      <button className="btn-ghost" style={{ padding: '4px' }}>
                        <FiMoreVertical size={16} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </div>
                  </div>
                  
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{task.description}</p>
                  
                  {task.schedule && (
                    <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', background: 'rgba(0,200,200,0.05)', padding: '4px 8px', borderRadius: '4px', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <FiClock size={12} /> {task.schedule.toUpperCase()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <aside className="glass-card" style={{ maxHeight: 'calc(100vh - 100px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}>
          <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.02)' }}>
            <h2 className="mono" style={{ fontSize: '0.85rem', color: 'var(--neon-cyan)', margin: 0 }}>[ EXECUTION_LOG ]</h2>
          </div>
          
          <div style={{ overflowY: 'auto', flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {runs.length === 0 ? (
              <div className="mono" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>WAITING_FOR_INPUT...</div>
            ) : (
              runs.map(run => (
                <div key={run.id} style={{ 
                  background: 'rgba(0,0,0,0.2)', 
                  border: '1px solid var(--border-glass)', 
                  borderRadius: '4px', 
                  padding: '0.75rem',
                  fontSize: '0.8rem',
                  borderLeft: `2px solid ${getStatusColor(run.status)}` 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600 }}>{run.task?.name || (run as any).definition?.name || 'UNKNOWN_TASK'}</span>
                    <span className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }).toUpperCase() : 'PENDING'}
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="mono" style={{ fontSize: '0.7rem', color: getStatusColor(run.status) }}>
                      {run.status.toUpperCase()}
                    </div>
                    {run.provenance && (
                      <div className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        TOOLS: {(run.provenance as any).tool_calls?.length || 0}
                      </div>
                    )}
                  </div>

                  {run.status === 'failed' && run.errorMessage && (
                    <div className="mono" style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--error)', background: 'rgba(255,0,0,0.05)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--error-faint)' }}>
                      {run.errorMessage}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};


export default Tasks;
