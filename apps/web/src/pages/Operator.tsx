import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ActiveAgentRuntimeState,
  OperatorRunSummary,
  OperatorSnapshot,
  OperatorSubagentNode,
} from '@rawclaw/shared';
import { FiActivity, FiPauseCircle, FiPlayCircle, FiRefreshCw, FiRotateCcw, FiStopCircle } from 'react-icons/fi';
import { useGatewayRuntime } from '../hooks/useGatewayRuntime';
import {
  cancelOperatorRun,
  fetchOperatorSnapshot,
  pauseOperatorAgent,
  resumeOperatorAgent,
  retryOperatorRun,
} from '../lib/operator';

const EMPTY_SNAPSHOT: OperatorSnapshot = {
  summary: {
    activeAgents: 0,
    activeSessions: 0,
    activeRoutes: 0,
    currentRuns: 0,
    toolEvents: 0,
    memoryEvents: 0,
    degradedCount: 0,
    subagentCount: 0,
  },
  activeAgents: [],
  activeSessions: [],
  currentRuns: [],
  toolActivity: [],
  timeline: [],
  provenance: [],
  subagentTree: [],
  routes: [],
};

export default function Operator() {
  const gateway = useGatewayRuntime({ enableStream: true });
  const [snapshot, setSnapshot] = useState<OperatorSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadSnapshot = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchOperatorSnapshot(80);
      setSnapshot(next);
    } catch (loadError) {
      console.error('Failed to load operator snapshot', loadError);
      setError('Unable to load the unified operator surface right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSnapshot();
  }, []);

  useEffect(() => {
    if (gateway.lastEventAt) {
      void loadSnapshot();
    }
  }, [gateway.lastEventAt]);

  useEffect(() => {
    if (selectedSessionId && snapshot.activeSessions.some((session) => session.sessionId === selectedSessionId)) {
      return;
    }
    setSelectedSessionId(snapshot.activeSessions[0]?.sessionId || null);
  }, [snapshot.activeSessions, selectedSessionId]);

  useEffect(() => {
    if (selectedRunId && snapshot.currentRuns.some((run) => run.id === selectedRunId)) {
      return;
    }
    const nextRun =
      snapshot.currentRuns.find((run) => run.sessionId === selectedSessionId)
      || snapshot.currentRuns[0]
      || null;
    setSelectedRunId(nextRun?.id || null);
  }, [snapshot.currentRuns, selectedRunId, selectedSessionId]);

  const selectedSession = snapshot.activeSessions.find((session) => session.sessionId === selectedSessionId) || null;
  const selectedRun = snapshot.currentRuns.find((run) => run.id === selectedRunId) || null;

  const selectedAgent = useMemo(() => {
    if (!selectedSession?.agentId) return null;
    return snapshot.activeAgents.find((agent) => agent.agentId === selectedSession.agentId) || null;
  }, [selectedSession, snapshot.activeAgents]);

  const sessionRuns = useMemo(() => {
    if (!selectedSessionId) return snapshot.currentRuns;
    return snapshot.currentRuns.filter((run) => run.sessionId === selectedSessionId || run.parentSessionId === selectedSessionId || run.bindingId === selectedSession?.bindingId);
  }, [selectedSessionId, selectedSession?.bindingId, snapshot.currentRuns]);

  const sessionTimeline = useMemo(() => {
    if (!selectedSessionId) return snapshot.timeline;
    return snapshot.timeline.filter((item) => item.sessionId === selectedSessionId || item.parentSessionId === selectedSessionId);
  }, [selectedSessionId, snapshot.timeline]);

  const sessionToolActivity = useMemo(() => {
    if (!selectedSessionId) return snapshot.toolActivity;
    return snapshot.toolActivity.filter((item) => item.sessionId === selectedSessionId);
  }, [selectedSessionId, snapshot.toolActivity]);

  const sessionProvenance = useMemo(() => {
    if (!selectedSessionId) return snapshot.provenance;
    return snapshot.provenance.filter((item) => item.sessionId === selectedSessionId);
  }, [selectedSessionId, snapshot.provenance]);

  const sessionSubagentTree = useMemo(() => {
    if (!selectedSessionId) return snapshot.subagentTree;
    const includeNode = (node: OperatorSubagentNode): boolean =>
      node.sessionId === selectedSessionId
      || node.parentSessionId === selectedSessionId
      || node.children.some(includeNode);
    return snapshot.subagentTree.filter(includeNode);
  }, [selectedSessionId, snapshot.subagentTree]);

  const runSupportsRetry =
    selectedRun?.kind === 'automation'
    || selectedRun?.kind === 'task'
    || selectedRun?.kind === 'app_builder';
  const runSupportsCancel = selectedRun?.status === 'running' || selectedRun?.status === 'queued';

  const performAgentAction = async (agent: ActiveAgentRuntimeState, mode: 'pause' | 'resume') => {
    setBusyAction(`${mode}:${agent.agentId}`);
    setActionMessage(null);
    try {
      const result = mode === 'pause'
        ? await pauseOperatorAgent(agent.agentId)
        : await resumeOperatorAgent(agent.agentId);
      setActionMessage(result.message);
      await loadSnapshot();
    } catch (actionError: any) {
      console.error(`Failed to ${mode} agent`, actionError);
      setActionMessage(extractApiError(actionError, `Unable to ${mode} the agent right now.`));
    } finally {
      setBusyAction(null);
    }
  };

  const performRunAction = async (run: OperatorRunSummary, mode: 'cancel' | 'retry') => {
    setBusyAction(`${mode}:${run.id}`);
    setActionMessage(null);
    try {
      const result = mode === 'cancel'
        ? await cancelOperatorRun(run.id)
        : await retryOperatorRun(run.id);
      setActionMessage(result.message);
      await loadSnapshot();
    } catch (actionError: any) {
      console.error(`Failed to ${mode} run`, actionError);
      setActionMessage(extractApiError(actionError, `Unable to ${mode} this run right now.`));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Unified Operator Surface</h1>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '920px', lineHeight: 1.65 }}>
              Watch active agents, live sessions, current runs, tool activity, provenance, memory signals, and delegated child work from one runtime surface without collapsing the system into a swarm of free-form agents.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <Link to="/gateway" className="btn-ghost" style={{ textDecoration: 'none' }}>Gateway Runtime</Link>
            <Link to="/app-builder" className="btn-ghost" style={{ textDecoration: 'none' }}>App Builder</Link>
            <Link to="/provenance" className="btn-ghost" style={{ textDecoration: 'none' }}>Provenance</Link>
            <button className="btn-ghost" onClick={() => void loadSnapshot()} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <FiRefreshCw /> {loading ? 'Refreshing...' : 'Refresh operator'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.85rem' }}>
          <MetricCard label="Active Agents" value={snapshot.summary.activeAgents} tone="info" />
          <MetricCard label="Active Sessions" value={snapshot.summary.activeSessions} />
          <MetricCard label="Active Routes" value={snapshot.summary.activeRoutes} tone="info" />
          <MetricCard label="Current Runs" value={snapshot.summary.currentRuns} tone="good" />
          <MetricCard label="Tool Events" value={snapshot.summary.toolEvents} tone="warn" />
          <MetricCard label="Memory Events" value={snapshot.summary.memoryEvents} tone="warn" />
          <MetricCard label="Degraded" value={snapshot.summary.degradedCount} tone={snapshot.summary.degradedCount > 0 ? 'bad' : 'good'} />
          <MetricCard label="Subagent Roots" value={snapshot.summary.subagentCount} tone="warn" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ color: gateway.isStreamLive ? 'var(--text-secondary)' : '#ffd26a' }}>
            {gateway.isStreamLive ? 'Gateway stream is live.' : gateway.streamError || 'Gateway stream is reconnecting.'}
          </div>
          {actionMessage ? <div style={{ color: 'var(--text-secondary)' }}>{actionMessage}</div> : null}
        </div>
      </section>

      {error ? <WarningCard title="Operator snapshot unavailable" message={error} /> : null}

      <section style={{ display: 'grid', gridTemplateColumns: '320px 360px minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Panel title="Active Sessions">
            {snapshot.activeSessions.length === 0 ? (
              <EmptyState message="No active sessions are visible right now." />
            ) : (
              <div style={{ display: 'grid', gap: '0.7rem' }}>
                {snapshot.activeSessions.map((session) => (
                  <button
                    key={session.sessionId}
                    onClick={() => setSelectedSessionId(session.sessionId)}
                    style={selectableCardStyle(selectedSessionId === session.sessionId)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <strong>{session.title || session.sessionId.slice(0, 10)}</strong>
                      <StatusPill status={session.routeStatus || 'idle'} />
                    </div>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                      {session.workspaceId} | {session.surfaceType || 'chat'} | {session.agentId || 'main'}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                      {session.currentRunIds.length} tracked run{session.currentRunIds.length === 1 ? '' : 's'} | heartbeat {session.lastHeartbeatAt ? formatTimestamp(session.lastHeartbeatAt) : 'n/a'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Active Agents">
            {snapshot.activeAgents.length === 0 ? (
              <EmptyState message="No agents currently hold runtime ownership." />
            ) : (
              <div style={{ display: 'grid', gap: '0.7rem' }}>
                {snapshot.activeAgents.map((agent) => (
                  <div key={agent.agentId} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <strong>{agent.name}</strong>
                      <StatusPill status={agent.status} />
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                      {agent.activeRouteCount} routes | {agent.currentRunCount} runs | {agent.activeSessionCount} sessions
                    </div>
                    <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.75rem' }}>
                      {agent.status === 'paused' ? (
                        <button className="btn-ghost" disabled={busyAction === `resume:${agent.agentId}`} onClick={() => void performAgentAction(agent, 'resume')}>
                          <FiPlayCircle style={{ marginRight: '0.35rem' }} /> Resume
                        </button>
                      ) : (
                        <button className="btn-ghost" disabled={busyAction === `pause:${agent.agentId}`} onClick={() => void performAgentAction(agent, 'pause')}>
                          <FiPauseCircle style={{ marginRight: '0.35rem' }} /> Pause
                        </button>
                      )}
                      <Link to="/agents" className="btn-ghost" style={{ textDecoration: 'none' }}>Open</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <Panel title="Current Runs">
            {sessionRuns.length === 0 ? (
              <EmptyState message="No current or recent runs are attached to the selected session." />
            ) : (
              <div style={{ display: 'grid', gap: '0.7rem' }}>
                {sessionRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    style={selectableCardStyle(selectedRunId === run.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <strong>{run.title}</strong>
                      <StatusPill status={run.status} />
                    </div>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.3rem' }}>
                      {run.kind} | {run.id}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                      {[
                        run.executionMode ? `mode ${run.executionMode}` : null,
                        run.queueType ? `queue ${run.queueType}` : null,
                        run.workerId ? `worker ${run.workerId}` : null,
                        run.guardianOutcome ? `guardian ${run.guardianOutcome.status}` : null,
                      ].filter(Boolean).join(' | ') || 'Foreground route without worker assignment yet.'}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                      {run.summary || 'No run summary captured yet.'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Subagent Tree">
            {sessionSubagentTree.length === 0 ? (
              <EmptyState message="No child-run lineage is attached to the current selection." />
            ) : (
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {sessionSubagentTree.map((node) => (
                  <SubagentTreeNode key={node.id} node={node} depth={0} />
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <Panel title="Session-Centric Runtime Detail">
            {!selectedSession ? (
              <EmptyState message="Select a session to pivot the operator surface." />
            ) : (
              <div style={{ display: 'grid', gap: '0.95rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem' }}>
                  <MetricCard label="Runs" value={sessionRuns.length} tone="good" />
                  <MetricCard label="Timeline Items" value={sessionTimeline.length} tone="info" />
                  <MetricCard label="Tool Activity" value={sessionToolActivity.length} tone="warn" />
                  <MetricCard label="Provenance" value={sessionProvenance.length} tone="info" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem' }}>
                  <DetailCluster title="Selected Session">
                    <DetailRow label="Session" value={selectedSession.sessionId} mono />
                    <DetailRow label="Workspace" value={selectedSession.workspaceId} />
                    <DetailRow label="Surface" value={selectedSession.surfaceType || 'chat'} />
                    <DetailRow label="Sender" value={selectedSession.senderIdentifier} mono />
                    <DetailRow label="Binding" value={selectedSession.bindingId || 'n/a'} mono />
                  </DetailCluster>
                  <DetailCluster title="Agent Ownership">
                    <DetailRow label="Agent" value={selectedSession.agentId || 'main'} mono />
                    <DetailRow label="Route Status" value={selectedSession.routeStatus || 'idle'} />
                    <DetailRow label="Last Heartbeat" value={selectedSession.lastHeartbeatAt ? formatTimestamp(selectedSession.lastHeartbeatAt) : 'n/a'} />
                    <DetailRow label="Children" value={String(selectedSession.childSessionIds.length)} />
                  </DetailCluster>
                  <DetailCluster title="Controls">
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <Link to={`/chat/${selectedSession.sessionId}`} className="btn-ghost" style={{ textDecoration: 'none' }}>
                        Open Session
                      </Link>
                      {selectedSession.bindingId ? (
                        <Link to={`/gateway?route=${encodeURIComponent(selectedSession.bindingId)}`} className="btn-ghost" style={{ textDecoration: 'none' }}>
                          Open Route
                        </Link>
                      ) : null}
                      <Link to="/provenance" className="btn-ghost" style={{ textDecoration: 'none' }}>
                        Open Provenance
                      </Link>
                    </div>
                    {selectedAgent ? (
                      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.55rem' }}>
                        {selectedAgent.status === 'paused' ? (
                          <button className="btn-ghost" disabled={busyAction === `resume:${selectedAgent.agentId}`} onClick={() => void performAgentAction(selectedAgent, 'resume')}>
                            <FiPlayCircle style={{ marginRight: '0.35rem' }} /> Resume Agent
                          </button>
                        ) : (
                          <button className="btn-ghost" disabled={busyAction === `pause:${selectedAgent.agentId}`} onClick={() => void performAgentAction(selectedAgent, 'pause')}>
                            <FiPauseCircle style={{ marginRight: '0.35rem' }} /> Pause Agent
                          </button>
                        )}
                      </div>
                    ) : null}
                  </DetailCluster>
                </div>

                {selectedRun ? (
                  <div className="glass-card" style={{ padding: '1rem', display: 'grid', gap: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '1rem', fontWeight: 700 }}>{selectedRun.title}</div>
                        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{selectedRun.kind} | {selectedRun.id}</div>
                      </div>
                      <StatusPill status={selectedRun.status} />
                    </div>
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      {selectedRun.summary || 'No run summary captured.'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                      <DetailCluster title="Execution">
                        <DetailRow label="Mode" value={selectedRun.executionMode || 'foreground'} />
                        <DetailRow label="Queue" value={selectedRun.queueType || 'none'} />
                        <DetailRow label="Worker" value={selectedRun.workerId || 'none'} mono />
                        <DetailRow label="Heartbeat" value={selectedRun.heartbeatAt ? formatTimestamp(selectedRun.heartbeatAt) : 'n/a'} />
                      </DetailCluster>
                      <DetailCluster title="Guardian">
                        <DetailRow label="Outcome" value={selectedRun.guardianOutcome?.status || 'pending'} />
                        <DetailRow label="Reviewer" value={selectedRun.guardianOutcome?.reviewer || 'n/a'} mono />
                        <DetailRow label="Reason" value={selectedRun.guardianOutcome?.reason || 'No explicit guardian note captured.'} />
                      </DetailCluster>
                      <DetailCluster title="Queue Metadata">
                        <DetailRow label="Queued Roles" value={selectedRun.queueMetadata?.queuedRoles?.length ? selectedRun.queueMetadata.queuedRoles.join(', ') : 'none'} />
                        <DetailRow label="Worker Assignments" value={selectedRun.queueMetadata?.workerAssignments?.length ? selectedRun.queueMetadata.workerAssignments.join(', ') : 'none'} mono />
                        <DetailRow label="Fallback Used" value={selectedRun.queueMetadata?.queueFallbackUsed ? 'yes' : 'no'} />
                      </DetailCluster>
                    </div>
                    {selectedRun.provenance ? (
                      <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.8rem', display: 'grid', gap: '0.25rem' }}>
                        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>PROVENANCE SUMMARY</div>
                        <div style={{ color: 'var(--text-secondary)' }}>
                          {selectedRun.provenance.promptPackId || 'no prompt pack'} | review {selectedRun.provenance.reviewState || 'unknown'} | {selectedRun.provenance.toolBacked ? 'tool-backed' : 'model-only'}
                        </div>
                        {selectedRun.provenance.answerabilityMode ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                            answerability {selectedRun.provenance.answerabilityMode}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {runSupportsCancel ? (
                        <button className="btn-ghost" disabled={busyAction === `cancel:${selectedRun.id}`} onClick={() => void performRunAction(selectedRun, 'cancel')}>
                          <FiStopCircle style={{ marginRight: '0.35rem' }} /> Cancel Run
                        </button>
                      ) : null}
                      {runSupportsRetry ? (
                        <button className="btn-ghost" disabled={busyAction === `retry:${selectedRun.id}`} onClick={() => void performRunAction(selectedRun, 'retry')}>
                          <FiRotateCcw style={{ marginRight: '0.35rem' }} /> Retry Run
                        </button>
                      ) : null}
                      {selectedRun.bindingId ? (
                        <Link to={`/gateway?route=${encodeURIComponent(selectedRun.bindingId)}`} className="btn-ghost" style={{ textDecoration: 'none' }}>
                          Reveal Route
                        </Link>
                      ) : null}
                      {selectedRun.kind === 'app_builder' ? (
                        <Link to="/app-builder" className="btn-ghost" style={{ textDecoration: 'none' }}>
                          Open App Builder
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>

          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
            <Panel title="Recent Tool Activity">
              {sessionToolActivity.length === 0 ? (
                <EmptyState message="No tool activity is attached to this session yet." />
              ) : (
                <div style={{ display: 'grid', gap: '0.65rem' }}>
                  {sessionToolActivity.slice(0, 8).map((item) => (
                    <div key={item.id} style={cardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <strong>{item.toolName}</strong>
                        <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{formatTimestamp(item.timestamp)}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{item.summary}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Provenance Highlights">
              {sessionProvenance.length === 0 ? (
                <EmptyState message="No high-signal provenance summaries were captured for this session." />
              ) : (
                <div style={{ display: 'grid', gap: '0.65rem' }}>
                  {sessionProvenance.slice(0, 6).map((item) => (
                    <div key={item.messageId} style={cardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <strong>{item.promptPackId || 'Unknown prompt pack'}</strong>
                        <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{item.reviewState || 'unknown'}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        {item.toolBacked ? 'Tool-backed response' : 'Model-only response'}{item.answerabilityMode ? ` | answerability ${item.answerabilityMode}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <Panel title="Unified Timeline">
            {sessionTimeline.length === 0 ? (
              <EmptyState message="No timeline items match the current selection." />
            ) : (
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {sessionTimeline.slice(0, 14).map((item) => (
                  <div key={item.id} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <strong>{humanize(item.kind)}</strong>
                      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{formatTimestamp(item.timestamp)}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', lineHeight: 1.55 }}>{item.summary}</div>
                    {item.detail ? <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem' }}>{item.detail}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
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

function EmptyState({ message }: { message: string }) {
  return <div style={{ color: 'var(--text-muted)' }}>{message}</div>;
}

function DetailCluster({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: '0.1rem' }}>
      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{label.toUpperCase()}</span>
      <span className={mono ? 'mono' : ''} style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

function SubagentTreeNode({ node, depth }: { node: OperatorSubagentNode; depth: number }) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem', marginLeft: depth ? `${depth * 14}px` : 0 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
          <strong>{node.agentId || 'main'} / {node.runId}</strong>
          <StatusPill status={node.status} />
        </div>
        <div style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{node.summary || 'No child summary captured yet.'}</div>
      </div>
      {node.children.map((child) => (
        <SubagentTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
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
    <div style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: color }}>
      <div style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '0.25rem' }}>{value}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = (status || 'idle').toLowerCase();
  const palette =
    normalized === 'running'
      ? { bg: 'rgba(0, 240, 255, 0.16)', border: 'rgba(0, 240, 255, 0.32)', text: '#9defff' }
      : normalized === 'completed' || normalized === 'done' || normalized === 'idle'
        ? { bg: 'rgba(24, 201, 100, 0.16)', border: 'rgba(24, 201, 100, 0.32)', text: '#a6f4c5' }
        : normalized === 'paused' || normalized === 'queued'
          ? { bg: 'rgba(255, 184, 0, 0.16)', border: 'rgba(255, 184, 0, 0.32)', text: '#ffd26a' }
          : { bg: 'rgba(255, 90, 90, 0.16)', border: 'rgba(255, 90, 90, 0.32)', text: '#ffb3b3' };

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

function WarningCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="glass-card" style={{ border: '1px solid rgba(255, 184, 0, 0.25)', background: 'rgba(255, 184, 0, 0.08)' }}>
      <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
        <FiActivity style={{ marginTop: '0.1rem' }} />
        <div>
          <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{title}</div>
          <div style={{ color: 'var(--text-secondary)' }}>{message}</div>
        </div>
      </div>
    </div>
  );
}

function selectableCardStyle(selected: boolean) {
  return {
    ...cardStyle,
    textAlign: 'left' as const,
    cursor: 'pointer',
    color: 'inherit',
    background: selected ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.03)',
    border: selected ? '1px solid rgba(0, 240, 255, 0.3)' : '1px solid var(--border-glass)',
  };
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function humanize(value: string) {
  return (value || 'unknown')
    .split(/[_\-.]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractApiError(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string | string[] } } }).response;
    const message = response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

const cardStyle = {
  border: '1px solid var(--border-glass)',
  borderRadius: '14px',
  padding: '0.85rem',
  background: 'rgba(255,255,255,0.03)',
};
