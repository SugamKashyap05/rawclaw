import {
  AgentRuntimeListResponse,
  OperatorSnapshot,
  OperatorTimelineResponse,
  RunActionResult,
} from '@rawclaw/shared';
import { api } from './api';

export async function fetchOperatorSnapshot(limit = 60): Promise<OperatorSnapshot> {
  const response = await api.get<OperatorSnapshot>('/operator/snapshot', {
    params: { limit },
  });
  return response.data;
}

export async function fetchOperatorTimeline(params?: {
  limit?: number;
  sessionId?: string;
  agentId?: string;
  memoryLayer?: string;
  eventType?: string;
}): Promise<OperatorTimelineResponse> {
  const response = await api.get<OperatorTimelineResponse>('/operator/timeline', {
    params,
  });
  return response.data;
}

export async function fetchActiveOperatorAgents(): Promise<AgentRuntimeListResponse> {
  const response = await api.get<AgentRuntimeListResponse>('/operator/agents');
  return response.data;
}

export async function pauseOperatorAgent(agentId: string): Promise<RunActionResult> {
  const response = await api.post<RunActionResult>(`/operator/agents/${encodeURIComponent(agentId)}/pause`);
  return response.data;
}

export async function resumeOperatorAgent(agentId: string): Promise<RunActionResult> {
  const response = await api.post<RunActionResult>(`/operator/agents/${encodeURIComponent(agentId)}/resume`);
  return response.data;
}

export async function cancelOperatorRun(runId: string): Promise<RunActionResult> {
  const response = await api.post<RunActionResult>(`/operator/runs/${encodeURIComponent(runId)}/cancel`);
  return response.data;
}

export async function retryOperatorRun(runId: string): Promise<RunActionResult> {
  const response = await api.post<RunActionResult>(`/operator/runs/${encodeURIComponent(runId)}/retry`);
  return response.data;
}
