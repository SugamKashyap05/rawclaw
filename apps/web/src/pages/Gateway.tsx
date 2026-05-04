import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AppRegistryRecord,
  AutomationJob,
  BindingRule,
  GatewayEvent,
  GraphIngestionRecord,
  KnowledgeGraphLineageView,
  KnowledgeEdge,
  KnowledgeNode,
  QueueJobSummary,
  ReflectionProposalView,
  SimulationRun,
  WorkerStatusSnapshot,
} from '@rawclaw/shared';
import { FiActivity, FiAlertTriangle, FiArrowRight, FiCpu, FiGitBranch, FiRefreshCw, FiShield, FiZap } from 'react-icons/fi';
import { useGatewayRuntime } from '../hooks/useGatewayRuntime';
import {
  approveReflectionProposal,
  fetchGatewayAutomationJobs,
  fetchGatewayKnowledgeGraph,
  fetchGatewayRules,
  fetchGatewayWorkers,
  fetchRecentGraphIngestions,
  fetchRecentQueueJobs,
  fetchReflectionProposals,
  fetchSimulations,
  getProposalSimulationEligibility,
  publishReflectionProposal,
  queueSimulation,
  rejectReflectionProposal,
} from '../lib/gateway';
import { fetchAppRegistryRecords } from '../lib/app-builder';

const EMPTY_LINEAGE: KnowledgeGraphLineageView = {
  supportingSources: [],
  workerIds: [],
  referencedEntities: [],
  priorRunIds: [],
};

export default function Gateway() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rules, setRules] = useState<BindingRule[]>([]);
  const [automationJobs, setAutomationJobs] = useState<AutomationJob[]>([]);
  const [workers, setWorkers] = useState<WorkerStatusSnapshot[]>([]);
  const [subagentQueueJobs, setSubagentQueueJobs] = useState<QueueJobSummary[]>([]);
  const [automationQueueJobs, setAutomationQueueJobs] = useState<QueueJobSummary[]>([]);
  const [sandboxQueueJobs, setSandboxQueueJobs] = useState<QueueJobSummary[]>([]);
  const [builderQueueJobs, setBuilderQueueJobs] = useState<QueueJobSummary[]>([]);
  const [appRegistryRecords, setAppRegistryRecords] = useState<AppRegistryRecord[]>([]);
  const [graphNodes, setGraphNodes] = useState<KnowledgeNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<KnowledgeEdge[]>([]);
  const [graphIngestions, setGraphIngestions] = useState<GraphIngestionRecord[]>([]);
  const [graphLineage, setGraphLineage] = useState<KnowledgeGraphLineageView>(EMPTY_LINEAGE);
  const [reflectionProposals, setReflectionProposals] = useState<ReflectionProposalView[]>([]);
  const [simulationRuns, setSimulationRuns] = useState<SimulationRun[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [phase3Error, setPhase3Error] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const selectedRouteId = searchParams.get('route');
  const selectedSessionId = searchParams.get('session');
  const workspaceFilter = searchParams.get('workspace') || 'all';
  const agentFilter = searchParams.get('agent') || 'all';
  const surfaceFilter = searchParams.get('surface') || 'all';
  const statusFilter = searchParams.get('status') || 'all';

  const {
    routes,
    summary,
    recentEvents,
    selectedDetail,
    loading,
    detailLoading,
    error,
    streamError,
    isStreamLive,
    lastEventAt,
    refresh,
  } = useGatewayRuntime({ selectedRouteId });

  const filterOptions = useMemo(() => {
    return {
      workspaces: uniqueValues(routes.map((route) => route.workspaceId)),
      agents: uniqueValues(routes.map((route) => route.agentId || 'main')),
      surfaces: uniqueValues(routes.map((route) => route.surfaceType || 'chat')),
      statuses: uniqueValues(routes.map((route) => route.status || 'idle')),
    };
  }, [routes]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((route) => {
      if (workspaceFilter !== 'all' && route.workspaceId !== workspaceFilter) return false;
      if (agentFilter !== 'all' && (route.agentId || 'main') !== agentFilter) return false;
      if (surfaceFilter !== 'all' && (route.surfaceType || 'chat') !== surfaceFilter) return false;
      if (statusFilter !== 'all' && (route.status || 'idle') !== statusFilter) return false;
      return true;
    });
  }, [routes, workspaceFilter, agentFilter, surfaceFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;

    const loadSidebarData = async () => {
      try {
        const [nextRules, nextJobs] = await Promise.all([
          fetchGatewayRules(),
          fetchGatewayAutomationJobs(),
        ]);
        if (!cancelled) {
          setRules(nextRules);
          setAutomationJobs(nextJobs);
          setRulesError(null);
          setAutomationError(null);
        }
      } catch (loadError) {
        console.error('Failed to load gateway sidebar data', loadError);
        if (!cancelled) {
          setRulesError('Unable to load routing rules right now.');
          setAutomationError('Unable to load automation jobs right now.');
        }
      }
    };

    void loadSidebarData();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPhase3Data = async (runId?: string | null) => {
    try {
      const [nextWorkers, nextSubagentQueue, nextAutomationQueue, nextSandboxQueue, nextBuilderQueue, nextProposals, nextSimulations, nextRegistry] =
        await Promise.all([
          fetchGatewayWorkers(12),
          fetchRecentQueueJobs('subagent', 8),
          fetchRecentQueueJobs('automation', 8),
          fetchRecentQueueJobs('sandbox', 8),
          fetchRecentQueueJobs('builder', 8),
          fetchReflectionProposals({ limit: 8 }),
          fetchSimulations(8),
          fetchAppRegistryRecords(),
        ]);

      setWorkers(nextWorkers);
      setSubagentQueueJobs(nextSubagentQueue);
      setAutomationQueueJobs(nextAutomationQueue);
      setSandboxQueueJobs(nextSandboxQueue);
      setBuilderQueueJobs(nextBuilderQueue);
      setReflectionProposals(nextProposals);
      setSimulationRuns(nextSimulations);
      setAppRegistryRecords(nextRegistry.slice(0, 8));

      if (runId) {
        const graph = await fetchGatewayKnowledgeGraph({ runId, limit: 12 });
        setGraphNodes(graph.nodes);
        setGraphEdges(graph.edges);
        setGraphIngestions(graph.ingestions);
        setGraphLineage(graph.lineage || EMPTY_LINEAGE);
      } else {
        const ingestions = await fetchRecentGraphIngestions(8);
        setGraphNodes([]);
        setGraphEdges([]);
        setGraphIngestions(ingestions);
        setGraphLineage(EMPTY_LINEAGE);
      }
      setPhase3Error(null);
    } catch (loadError) {
      console.error('Failed to load Phase 3 runtime data', loadError);
      setPhase3Error('Phase 3 worker, graph, or reflection data is temporarily unavailable.');
    }
  };

  useEffect(() => {
    if (selectedRouteId || !routes.length) {
      return;
    }

    if (selectedSessionId) {
      const matching = routes.find((route) => route.sessionId === selectedSessionId);
      if (matching) {
        const next = new URLSearchParams(searchParams);
        next.set('route', matching.id);
        next.delete('session');
        setSearchParams(next, { replace: true });
        return;
      }
    }

    const fallback = filteredRoutes[0] || routes[0];
    if (fallback) {
      const next = new URLSearchParams(searchParams);
      next.set('route', fallback.id);
      setSearchParams(next, { replace: true });
    }
  }, [selectedRouteId, selectedSessionId, routes, filteredRoutes, searchParams, setSearchParams]);

  useEffect(() => {
    const candidateRunId =
      selectedDetail?.liveState?.runId
      || selectedDetail?.childRunSummaries?.[0]?.id
      || null;
    void loadPhase3Data(candidateRunId);
  }, [selectedDetail?.liveState?.runId, selectedDetail?.childRunSummaries, lastEventAt]);

  const selectedRoute = selectedDetail?.route || routes.find((route) => route.id === selectedRouteId) || null;
  const globalAlerts = recentEvents.filter((event) =>
    event.type === 'run.failed'
    || event.type === 'health.degraded'
    || event.type === 'subagent.failed'
    || event.type === 'automation.run.failed',
  );
  const selectedGraphRunId =
    selectedDetail?.liveState?.runId
    || selectedDetail?.childRunSummaries?.[0]?.id
    || null;
  const busyWorkers = workers.filter((worker) => worker.status === 'busy').length;
  const offlineWorkers = workers.filter((worker) => worker.status === 'offline').length;

  const reviewProposal = async (proposalView: ReflectionProposalView, action: 'approve' | 'reject') => {
    const proposal = proposalView.proposal;
    setActionMessage(null);
    setBusyAction(`${action}:${proposal.id}`);
    try {
      if (action === 'approve') {
        await approveReflectionProposal(proposal.id, 'Approved from Gateway runtime surface.');
      } else {
        await rejectReflectionProposal(proposal.id, 'Rejected from Gateway runtime surface.');
      }
      setActionMessage(`Proposal ${action}d: ${proposal.title}`);
      await loadPhase3Data(selectedGraphRunId);
    } catch (actionError: any) {
      console.error(`Failed to ${action} proposal`, actionError);
      setActionMessage(extractApiError(actionError, `Unable to ${action} that proposal right now.`));
    } finally {
      setBusyAction(null);
    }
  };

  const publishProposalAction = async (proposalView: ReflectionProposalView) => {
    const proposal = proposalView.proposal;
    setActionMessage(null);
    setBusyAction(`publish:${proposal.id}`);
    try {
      await publishReflectionProposal(proposal.id, 'Published from Gateway runtime surface.');
      setActionMessage(`Proposal published: ${proposal.title}`);
      await loadPhase3Data(selectedGraphRunId);
    } catch (actionError: any) {
      console.error('Failed to publish proposal', actionError);
      setActionMessage(extractApiError(actionError, 'Unable to publish that proposal right now.'));
    } finally {
      setBusyAction(null);
    }
  };

  const runProposalSimulation = async (proposalView: ReflectionProposalView) => {
    const proposal = proposalView.proposal;
    setActionMessage(null);
    setBusyAction(`simulate:${proposal.id}`);
    try {
      await queueSimulation({
        runId: proposal.runId ?? selectedGraphRunId,
        proposalId: proposal.id,
        inputEnvelope: {
          proposalId: proposal.id,
          runId: proposal.runId ?? selectedGraphRunId,
        },
      });
      setActionMessage(`Simulation queued for ${proposal.title}`);
      await loadPhase3Data(selectedGraphRunId);
    } catch (actionError: any) {
      console.error('Failed to queue simulation', actionError);
      setActionMessage(extractApiError(actionError, 'Unable to queue that simulation right now.'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Gateway Runtime</h1>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '920px', lineHeight: 1.6 }}>
              Watch route bindings, run state, control-plane events, and delegated subagent activity as one live operating surface.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <Link to="/provenance" className="btn-ghost" style={{ textDecoration: 'none' }}>
              Open Provenance
            </Link>
            <button className="btn-ghost" onClick={() => void refresh()} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <FiRefreshCw /> {loading ? 'Refreshing...' : 'Refresh runtime'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem' }}>
          <MetricCard label="Active Sessions" value={summary.activeSessions} tone="info" />
          <MetricCard label="Active Routes" value={summary.activeRoutes} />
          <MetricCard label="In-flight Runs" value={summary.inflightRuns} tone="good" />
          <MetricCard label="Degraded Routes" value={summary.degradedRoutes} tone={summary.degradedRoutes > 0 ? 'bad' : 'good'} />
          <MetricCard label="Active Subagents" value={summary.activeSubagents} tone="warn" />
          <MetricCard label="Auto Jobs" value={summary.activeAutomationJobs || 0} tone="info" />
          <MetricCard label="Auto Runs" value={summary.inflightAutomationRuns || 0} tone="warn" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', color: 'var(--text-secondary)' }}>
            <FiActivity />
            <span>{isStreamLive ? 'Live stream connected' : 'Live stream reconnecting'}</span>
            {lastEventAt ? <span className="mono" style={{ color: 'var(--text-muted)' }}>{formatTimestamp(lastEventAt)}</span> : null}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {actionMessage ? <span style={{ color: 'var(--text-secondary)' }}>{actionMessage}</span> : null}
            {streamError ? <span style={{ color: '#ffd26a' }}>{streamError}</span> : null}
          </div>
        </div>
      </section>

      {error ? <WarningCard title="Gateway runtime unavailable" message={error} /> : null}
      {!error && globalAlerts.length > 0 ? (
        <WarningCard
          title="Operator attention needed"
          message={`${globalAlerts.length} recent failure or degraded runtime signal${globalAlerts.length === 1 ? '' : 's'} surfaced in the control plane.`}
        />
      ) : null}

      <section style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="glass-card" style={{ display: 'grid', gap: '0.8rem' }}>
            <SectionTitle icon={<FiShield />} title="Route Filters" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <FilterSelect
                label="Workspace"
                value={workspaceFilter}
                onChange={(value) => updateFilter(searchParams, setSearchParams, 'workspace', value)}
                options={filterOptions.workspaces}
              />
              <FilterSelect
                label="Agent"
                value={agentFilter}
                onChange={(value) => updateFilter(searchParams, setSearchParams, 'agent', value)}
                options={filterOptions.agents}
              />
              <FilterSelect
                label="Surface"
                value={surfaceFilter}
                onChange={(value) => updateFilter(searchParams, setSearchParams, 'surface', value)}
                options={filterOptions.surfaces}
              />
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={(value) => updateFilter(searchParams, setSearchParams, 'status', value)}
                options={filterOptions.statuses}
              />
            </div>
          </div>

          <div className="glass-card" style={{ display: 'grid', gap: '0.8rem', maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
            <SectionTitle icon={<FiCpu />} title={`Routes (${filteredRoutes.length})`} />
            {loading ? (
              <div style={{ color: 'var(--text-muted)' }}>Loading gateway routes...</div>
            ) : filteredRoutes.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No routes match the current filters.</div>
            ) : (
              filteredRoutes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set('route', route.id);
                    next.delete('session');
                    setSearchParams(next);
                  }}
                  style={{
                    textAlign: 'left',
                    border: selectedRouteId === route.id ? '1px solid rgba(0, 240, 255, 0.35)' : '1px solid var(--border-glass)',
                    borderRadius: '14px',
                    background: selectedRouteId === route.id ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.03)',
                    padding: '0.95rem',
                    display: 'grid',
                    gap: '0.45rem',
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                    <strong>{route.agentId || 'main'} / {route.surfaceType}</strong>
                    <StatusPill status={route.status} />
                  </div>
                  <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{route.id}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                    session {route.resolvedSessionId || route.sessionId} | workspace {route.workspaceId}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                    <span>{humanize(route.resolutionSource)} | affinity {route.affinityMode}</span>
                    <span>{route.lastHeartbeatAt ? formatTimestamp(route.lastHeartbeatAt) : 'no heartbeat'}</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                    {route.matchedRuleName ? `rule ${route.matchedRuleName}` : route.parentSessionId ? 'subagent route' : 'primary route'}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {!selectedRoute ? (
            <div className="glass-card" style={{ color: 'var(--text-muted)' }}>
              Select a route to inspect live state, recent control-plane events, and delegated subagent activity.
            </div>
          ) : (
            <>
              <section className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Route Detail</h2>
                    <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{selectedRoute.id}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <StatusPill status={selectedRoute.status} />
                    {selectedDetail?.liveState?.runId ? <StatusPill status="live run" /> : null}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem' }}>
                  <MetricCard label="Surface" value={selectedRoute.surfaceType || 'chat'} tone="info" />
                  <MetricCard label="Agent" value={selectedRoute.agentId || 'main'} />
                  <MetricCard label="Affinity" value={humanize(selectedRoute.affinityMode)} tone="info" />
                  <MetricCard label="Resolution" value={humanize(selectedRoute.resolutionSource)} tone="info" />
                  <MetricCard label="Delegation Depth" value={selectedRoute.delegationDepth} tone={selectedRoute.delegationDepth > 0 ? 'warn' : 'default'} />
                  <MetricCard label="Child Routes" value={selectedDetail?.childRoutes.length || 0} tone={selectedDetail?.childRoutes.length ? 'warn' : 'default'} />
                  <MetricCard label="Auto Runs" value={selectedDetail?.automationRuns?.length || 0} tone={selectedDetail?.automationRuns?.length ? 'warn' : 'default'} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <DetailCluster title="Binding Identity">
                    <DetailRow label="Workspace" value={selectedRoute.workspaceId} />
                    <DetailRow label="Requested Session" value={selectedRoute.requestedSessionId || selectedRoute.sessionId} mono />
                    <DetailRow label="Resolved Session" value={selectedRoute.resolvedSessionId || selectedRoute.sessionId} mono />
                    <DetailRow label="Sender" value={selectedRoute.senderIdentifier} mono />
                    <DetailRow label="Routing Key" value={selectedRoute.routingKey} mono />
                  </DetailCluster>
                  <DetailCluster title="Routing Decision">
                    <DetailRow label="Resolution Source" value={humanize(selectedRoute.resolutionSource)} />
                    <DetailRow label="Affinity Mode" value={selectedRoute.affinityMode} mono />
                    <DetailRow label="Matched Rule" value={selectedRoute.matchedRuleName || selectedRoute.matchedRuleId || 'n/a'} mono={!!(selectedRoute.matchedRuleName || selectedRoute.matchedRuleId)} />
                    <DetailRow label="Reused Route" value={selectedRoute.reused ? 'yes' : 'no'} />
                  </DetailCluster>
                  <DetailCluster title="Live Runtime">
                    <DetailRow label="Run Id" value={selectedDetail?.liveState?.runId || 'n/a'} mono />
                    <DetailRow label="Last Heartbeat" value={selectedDetail?.liveState?.lastHeartbeatAt ? formatTimestamp(selectedDetail.liveState.lastHeartbeatAt) : 'n/a'} />
                    <DetailRow label="Thread Key" value={selectedRoute.threadKey || 'n/a'} mono />
                    <DetailRow label="Channel Key" value={selectedRoute.channelKey || 'n/a'} mono />
                  </DetailCluster>
                </div>

                {selectedRoute.lastError || selectedDetail?.liveState?.lastError ? (
                  <WarningCard title="Last runtime error" message={selectedDetail?.liveState?.lastError || selectedRoute.lastError || 'Unknown gateway runtime error.'} />
                ) : null}
              </section>

              <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '1rem', alignItems: 'start' }}>
                <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
                  <SectionTitle icon={<FiZap />} title="Recent Event Timeline" />
                  {detailLoading ? (
                    <div style={{ color: 'var(--text-muted)' }}>Loading route detail...</div>
                  ) : !(selectedDetail?.recentEvents.length) ? (
                    <div style={{ color: 'var(--text-muted)' }}>No recent route events were captured for this binding yet.</div>
                  ) : (
                    selectedDetail!.recentEvents.map((event) => <EventCard key={event.id} event={event} />)
                  )}
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div className="glass-card" style={{ display: 'grid', gap: '0.8rem' }}>
                    <SectionTitle icon={<FiGitBranch />} title="Subagent Chain" />
                    {selectedDetail?.childRoutes.length ? (
                      selectedDetail.childRoutes.map((route) => (
                        <button
                          key={route.id}
                          onClick={() => {
                            const next = new URLSearchParams(searchParams);
                            next.set('route', route.id);
                            setSearchParams(next);
                          }}
                          style={{
                            textAlign: 'left',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '12px',
                            background: 'rgba(255,255,255,0.03)',
                            padding: '0.85rem',
                            cursor: 'pointer',
                            color: 'inherit',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                            <strong>{route.agentId || 'main'}</strong>
                            <StatusPill status={route.status} />
                          </div>
                          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                            depth {route.delegationDepth} | {route.resolvedSessionId || route.sessionId}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div style={{ color: 'var(--text-muted)' }}>No delegated child routes are attached to this binding.</div>
                    )}
                    {selectedDetail?.childRunSummaries?.length ? (
                      <div style={{ display: 'grid', gap: '0.65rem' }}>
                        {selectedDetail.childRunSummaries.slice(0, 4).map((run) => (
                          <div key={run.id} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.65rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                              <strong style={{ fontSize: '0.84rem' }}>{humanize(run.mode)} / {humanize(run.contextForkMode)}</strong>
                              <StatusPill status={run.status} />
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
                              {run.summary || 'No child summary captured yet.'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="glass-card" style={{ display: 'grid', gap: '0.8rem' }}>
                    <SectionTitle icon={<FiActivity />} title="Automation Activity" />
                    {selectedDetail?.automationRuns?.length ? (
                      selectedDetail.automationRuns.slice(0, 6).map((run) => (
                        <div key={run.id} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.7rem', display: 'grid', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                            <strong style={{ fontSize: '0.84rem' }}>{run.jobId}</strong>
                            <StatusPill status={run.status} />
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            {run.summary || 'No automation summary captured yet.'}
                          </div>
                          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                            attempt {run.attempt} | {run.startedAt ? formatTimestamp(run.startedAt) : 'queued'}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--text-muted)' }}>No automation runs are linked to this route yet.</div>
                    )}
                  </div>

                  <div className="glass-card" style={{ display: 'grid', gap: '0.8rem' }}>
                    <SectionTitle icon={<FiArrowRight />} title="Global Event Feed" />
                    {recentEvents.slice(0, 8).map((event: GatewayEvent) => (
                      <div key={event.id} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.7rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <strong style={{ fontSize: '0.86rem' }}>{humanize(event.type)}</strong>
                          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{formatTimestamp(event.timestamp)}</span>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.83rem', marginTop: '0.2rem' }}>
                          {event.summary || 'No summary captured.'}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="glass-card" style={{ display: 'grid', gap: '0.8rem' }}>
                    <SectionTitle icon={<FiShield />} title={`Routing Rules (${rules.length})`} />
                    {rulesError ? (
                      <div style={{ color: '#ffd26a' }}>{rulesError}</div>
                    ) : rules.length ? (
                      rules.slice(0, 8).map((rule) => (
                        <div key={rule.id} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.7rem', display: 'grid', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                            <strong style={{ fontSize: '0.86rem' }}>{rule.name}</strong>
                            <StatusPill status={rule.active ? 'active' : 'paused'} />
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            {describeRuleScope(rule)}
                          </div>
                          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                            priority {rule.priority} | affinity {rule.affinityMode} | target {rule.targetAgentId || 'default agent'}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--text-muted)' }}>No routing rules are stored yet. Routes are currently resolving through explicit agents, existing sessions, or the global default.</div>
                    )}
                  </div>

                  <div className="glass-card" style={{ display: 'grid', gap: '0.8rem' }}>
                    <SectionTitle icon={<FiCpu />} title={`Automation Jobs (${automationJobs.length})`} />
                    {automationError ? (
                      <div style={{ color: '#ffd26a' }}>{automationError}</div>
                    ) : automationJobs.length ? (
                      automationJobs.slice(0, 8).map((job) => (
                        <div key={job.id} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.7rem', display: 'grid', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                            <strong style={{ fontSize: '0.86rem' }}>{job.name}</strong>
                            <StatusPill status={job.status} />
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            {humanize(job.kind)} | next {job.nextRunAt ? formatTimestamp(job.nextRunAt) : 'n/a'}
                          </div>
                          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                            {job.workspaceId} | {job.agentId || 'main'} | {job.contextForkMode}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--text-muted)' }}>No automation jobs are registered yet.</div>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </section>

      {phase3Error ? <WarningCard title="Phase 3 runtime data unavailable" message={phase3Error} /> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>
        <div className="glass-card" style={{ display: 'grid', gap: '0.85rem' }}>
          <SectionTitle icon={<FiCpu />} title="Worker Swarm" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.7rem' }}>
            <MetricCard label="Workers" value={workers.length} tone="info" />
            <MetricCard label="Busy" value={busyWorkers} tone={busyWorkers > 0 ? 'warn' : 'default'} />
            <MetricCard label="Offline" value={offlineWorkers} tone={offlineWorkers > 0 ? 'bad' : 'good'} />
          </div>
          {workers.length ? (
            workers.map((worker) => (
              <div key={worker.workerId} style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.85rem', background: 'rgba(255,255,255,0.03)', display: 'grid', gap: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                  <strong>{worker.workerId}</strong>
                  <StatusPill status={worker.status} />
                </div>
                <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  {worker.workerType} | {worker.hostname} | pid {worker.pid}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  queues {worker.queues.join(', ')} | roles {worker.roles.join(', ')}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                  {worker.currentJobId ? `current job ${worker.currentJobId}` : 'idle'} | heartbeat {formatTimestamp(worker.lastHeartbeatAt)}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>No Phase 3 workers are registered yet.</div>
          )}
        </div>

        <div className="glass-card" style={{ display: 'grid', gap: '0.85rem' }}>
          <SectionTitle icon={<FiActivity />} title="Queue Activity" />
          <QueuePanel title="Scout / Analyst Queue" jobs={subagentQueueJobs} />
          <QueuePanel title="Automation Queue" jobs={automationQueueJobs} />
          <QueuePanel title="Sandbox Pool" jobs={sandboxQueueJobs} />
          <QueuePanel title="App Builder Queue" jobs={builderQueueJobs} />
        </div>

        <div className="glass-card" style={{ display: 'grid', gap: '0.85rem' }}>
          <SectionTitle icon={<FiGitBranch />} title="Graph Trace" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.7rem' }}>
            <MetricCard label="Run Nodes" value={graphNodes.length} tone="info" />
            <MetricCard label="Run Edges" value={graphEdges.length} tone="warn" />
            <MetricCard label="Ingestions" value={graphIngestions.length} tone="good" />
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
            {selectedGraphRunId ? `Showing lineage for run ${selectedGraphRunId}` : 'No selected run yet, showing recent ingestion history.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
            <LineageList title="Supporting Sources" items={graphLineage.supportingSources} />
            <LineageList title="Workers" items={graphLineage.workerIds} mono />
            <LineageList title="Referenced Entities" items={graphLineage.referencedEntities} />
            <LineageList title="Prior Runs" items={graphLineage.priorRunIds} mono />
          </div>
          {graphNodes.length ? (
            <div style={{ display: 'grid', gap: '0.55rem' }}>
              {graphNodes.slice(0, 6).map((node) => (
                <div key={node.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <strong>{node.label}</strong>
                    <StatusPill status={node.kind} />
                  </div>
                  <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.25rem' }}>{node.ref}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>No graph nodes captured for the current selection yet.</div>
          )}
          {graphIngestions.length ? (
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              {graphIngestions.slice(0, 4).map((ingestion) => (
                <div key={ingestion.id} style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  {ingestion.runId} | {ingestion.status} | {ingestion.nodeCount} nodes / {ingestion.edgeCount} edges
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="glass-card" style={{ display: 'grid', gap: '0.85rem' }}>
          <SectionTitle icon={<FiShield />} title="Registered Apps" />
          {appRegistryRecords.length ? (
            <div style={{ display: 'grid', gap: '0.7rem' }}>
              {appRegistryRecords.map((record) => (
                <div key={record.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <strong>{record.appId}</strong>
                    <StatusPill status={record.status} />
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.25rem', fontSize: '0.82rem' }}>{record.version}</div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>{record.controlEndpoint}</div>
                  <div style={{ marginTop: '0.45rem' }}>
                    <Link to="/app-builder" className="btn-ghost" style={{ textDecoration: 'none' }}>Open App Builder</Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>No App Builder registry records are available yet.</div>
          )}
        </div>

        <div className="glass-card" style={{ display: 'grid', gap: '0.85rem' }}>
          <SectionTitle icon={<FiShield />} title="Reflection Review" />
          {reflectionProposals.length ? (
            reflectionProposals.map((proposalView) => {
              const proposal = proposalView.proposal;
              const eligibility = getProposalSimulationEligibility(proposalView, simulationRuns);
              const canApprove = proposal.status === 'proposed' && eligibility.canApprove;

              return (
              <div key={proposal.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.9rem', background: 'rgba(255,255,255,0.03)', display: 'grid', gap: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                  <strong>{proposal.title}</strong>
                  <StatusPill status={proposal.status} />
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.55 }}>{proposal.rationale}</div>
                <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  {proposal.kind} | run {proposal.runId || 'n/a'}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.5 }}>
                  {eligibility.canApprove
                    ? `Simulation gate passed${eligibility.latestSimulationId ? ` via ${eligibility.latestSimulationId}` : ''}.`
                    : eligibility.reasons.join(' ')}
                </div>
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {proposal.status === 'proposed' ? (
                    <>
                      <button className="btn-ghost" disabled={busyAction === `approve:${proposal.id}` || !canApprove} onClick={() => void reviewProposal(proposalView, 'approve')}>
                        Approve
                      </button>
                      <button className="btn-ghost" disabled={busyAction === `reject:${proposal.id}`} onClick={() => void reviewProposal(proposalView, 'reject')}>
                        Reject
                      </button>
                    </>
                  ) : null}
                  {proposal.status === 'approved' ? (
                    <button className="btn-ghost" disabled={busyAction === `publish:${proposal.id}`} onClick={() => void publishProposalAction(proposalView)}>
                      Publish
                    </button>
                  ) : null}
                  <button className="btn-ghost" disabled={busyAction === `simulate:${proposal.id}`} onClick={() => void runProposalSimulation(proposalView)}>
                    Simulate
                  </button>
                </div>
              </div>
            )})
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>No reflection proposals have been generated yet.</div>
          )}
          <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.8rem', display: 'grid', gap: '0.45rem' }}>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>RECENT SIMULATIONS</div>
            {simulationRuns.length ? (
              simulationRuns.map((run) => (
                <div key={run.id} style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  {run.id} | {run.status} | {run.proposalId || 'no proposal'}
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>No simulations have run yet.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function QueuePanel({ title, jobs }: { title: string; jobs: QueueJobSummary[] }) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{title.toUpperCase()}</div>
      {jobs.length ? (
        jobs.map((job) => (
          <div key={`${title}-${job.id}`} style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
              <strong>{job.title}</strong>
              <StatusPill status={job.status} />
            </div>
            {job.summary ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.3rem', lineHeight: 1.45 }}>
                {job.summary}
              </div>
            ) : null}
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
              {[job.id, job.runId || null, job.workerId ? `worker ${job.workerId}` : null].filter(Boolean).join(' | ')}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
              {job.queueType} | updated {formatTimestamp(job.updatedAt || job.createdAt)}
            </div>
          </div>
        ))
      ) : (
        <div style={{ color: 'var(--text-muted)' }}>No recent jobs recorded.</div>
      )}
    </div>
  );
}

function LineageList({
  title,
  items,
  mono = false,
}: {
  title: string;
  items: string[];
  mono?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem', padding: '0.75rem', border: '1px solid var(--border-glass)', borderRadius: '12px', background: 'rgba(255,255,255,0.03)' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{title.toUpperCase()}</div>
      {items.length ? (
        items.slice(0, 4).map((item) => (
          <div key={`${title}-${item}`} className={mono ? 'mono' : ''} style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>
            {item}
          </div>
        ))
      ) : (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No lineage captured yet.</div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label style={{ display: 'grid', gap: '0.35rem' }}>
      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{label.toUpperCase()}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle}>
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
      {icon}
      <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{title}</h2>
    </div>
  );
}

function DetailCluster({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: '0.55rem' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: '0.12rem' }}>
      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{label.toUpperCase()}</span>
      <span className={mono ? 'mono' : ''} style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}>{value}</span>
    </div>
  );
}

function EventCard({ event }: { event: GatewayEvent }) {
  return (
    <div style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.9rem', background: 'rgba(255,255,255,0.03)', display: 'grid', gap: '0.35rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
        <strong>{humanize(event.type)}</strong>
        <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{formatTimestamp(event.timestamp)}</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{event.summary || 'No summary captured.'}</div>
      {(event.bindingId || event.runId) ? (
        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          {[event.bindingId ? `binding ${event.bindingId}` : null, event.runId ? `run ${event.runId}` : null].filter(Boolean).join(' | ')}
        </div>
      ) : null}
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
    normalized === 'running' || normalized === 'live run'
      ? { bg: 'rgba(0, 240, 255, 0.16)', border: 'rgba(0, 240, 255, 0.32)', text: '#9defff' }
      : normalized === 'idle'
        ? { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.16)', text: '#d9dce7' }
        : normalized === 'error'
          ? { bg: 'rgba(255, 90, 90, 0.16)', border: 'rgba(255, 90, 90, 0.32)', text: '#ffb3b3' }
          : normalized === 'paused'
            ? { bg: 'rgba(255, 184, 0, 0.16)', border: 'rgba(255, 184, 0, 0.32)', text: '#ffd26a' }
            : { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.16)', text: '#d9dce7' };

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
    <div
      className="glass-card"
      style={{
        border: '1px solid rgba(255, 184, 0, 0.25)',
        background: 'rgba(255, 184, 0, 0.08)',
        display: 'flex',
        gap: '0.65rem',
        alignItems: 'flex-start',
      }}
    >
      <FiAlertTriangle style={{ marginTop: '0.1rem' }} />
      <div>
        <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{title}</div>
        <div style={{ color: 'var(--text-secondary)' }}>{message}</div>
      </div>
    </div>
  );
}

function updateFilter(
  searchParams: URLSearchParams,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  key: string,
  value: string,
) {
  const next = new URLSearchParams(searchParams);
  if (!value || value === 'all') {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  setSearchParams(next);
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function humanize(value: string): string {
  return (value || 'unknown')
    .split(/[_\-.]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeRuleScope(rule: BindingRule): string {
  const selectors = [
    rule.workspaceId ? `workspace=${rule.workspaceId}` : null,
    rule.surfaceType ? `surface=${rule.surfaceType}` : null,
    rule.senderIdentifier ? `sender=${rule.senderIdentifier}` : null,
    rule.threadKey ? `thread=${rule.threadKey}` : null,
    rule.channelKey ? `channel=${rule.channelKey}` : null,
  ].filter(Boolean);

  return selectors.length ? selectors.join(' | ') : 'global fallback rule';
}

function extractApiError(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return fallback;
}

const fieldStyle = {
  width: '100%',
  padding: '0.72rem 0.82rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};
