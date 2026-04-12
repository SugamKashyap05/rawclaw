import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Task, TaskRun } from '@rawclaw/shared';
import { formatDistanceToNow } from 'date-fns';
import { 
  FiPlay, FiPlus, FiClock, FiCheckCircle, 
  FiXCircle, FiLoader, FiMoreVertical, FiSearch 
} from 'react-icons/fi';
import './Tasks.css';

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [tasksRes, runsRes] = await Promise.all([
        axios.get('/api/tasks'),
        axios.get('/api/tasks/runs/recent')
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
      await axios.post(`/api/tasks/${id}/run`);
      fetchData();
    } catch (error) {
      console.error('Failed to run task:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <FiLoader className="icon-spin text-blue" />;
      case 'done': return <FiCheckCircle className="text-green" />;
      case 'failed': return <FiXCircle className="text-red" />;
      default: return <FiClock className="text-gray" />;
    }
  };

  const filteredTasks = tasks.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="tasks-container">
      <header className="tasks-header">
        <div className="header-left">
          <h1>Automated Tasks</h1>
          <p>Manage and monitor your background AI agents</p>
        </div>
        <button className="btn-primary">
          <FiPlus /> New Task
        </button>
      </header>

      {loading ? (
        <div className="loading-state">Initializing Task Engine...</div>
      ) : (
        <div className="tasks-grid">
        <section className="tasks-list-section">
          <div className="section-header">
            <h2>Active Tasks</h2>
            <div className="search-bar">
              <FiSearch />
              <input 
                type="text" 
                placeholder="Search tasks..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="tasks-list">
            {filteredTasks.length === 0 ? (
              <div className="empty-state">No tasks found</div>
            ) : (
              filteredTasks.map(task => (
                <div key={task.id} className="task-card">
                  <div className="task-info">
                    <h3>{task.name}</h3>
                    <p>{task.description}</p>
                    {task.schedule && (
                      <span className="task-schedule">
                        <FiClock /> {task.schedule}
                      </span>
                    )}
                  </div>
                  <div className="task-actions">
                    <button 
                      className="btn-icon" 
                      onClick={() => runTask(task.id)}
                      title="Run now"
                    >
                      <FiPlay />
                    </button>
                    <button className="btn-icon">
                      <FiMoreVertical />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="runs-history-section">
          <div className="section-header">
            <h2>Recent Runs</h2>
          </div>
          <div className="runs-list">
            {runs.length === 0 ? (
              <div className="empty-state">No recent activity</div>
            ) : (
              runs.map(run => (
                <div key={run.id} className={`run-item ${run.status}`}>
                  <div className="run-header">
                    {getStatusIcon(run.status)}
                    <span className="run-name">{run.task?.name || 'Unknown Task'}</span>
                    <span className="run-time">
                      {run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }) : 'Pending'}
                    </span>
                  </div>
                  {run.provenance && (
                    <div className="run-stats">
                      <span>Tools: {(run.provenance as any).tool_calls?.length || 0}</span>
                    </div>
                  )}
                  {run.status === 'failed' && run.errorMessage && (
                    <div className="run-error">{run.errorMessage}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
        </div>
      )}
    </div>
  );
};

export default Tasks;
