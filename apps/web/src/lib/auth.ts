import axios from 'axios';
import type {
  BootstrapAgentDraftRequest,
  BootstrapAgentDraftResponse,
  BootstrapPreflightResponse,
  BootstrapSetupRequest,
  BootstrapStatusResponse,
} from '@rawclaw/shared';

export const AUTH_TOKEN_KEY = 'rawclaw_access_token';
export const SESSION_ID_KEY = 'rawclaw_session_id';

export async function initializeAuth(): Promise<boolean> {
  const existingToken = localStorage.getItem(AUTH_TOKEN_KEY);
  if (existingToken) return true;

  try {
    const response = await axios.post('/api/auth/token', {
      secret: import.meta.env.VITE_AUTH_SECRET || '',
    });
    
    if (response.data && response.data.access_token) {
      localStorage.setItem(AUTH_TOKEN_KEY, response.data.access_token);
      localStorage.setItem(SESSION_ID_KEY, 'rawclaw-client');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to initialize auth', error);
    return false;
  }
}

export async function getBootstrapStatus(): Promise<BootstrapStatusResponse> {
  const response = await axios.get('/api/bootstrap/status');
  return response.data;
}

export async function getBootstrapPreflight(): Promise<BootstrapPreflightResponse> {
  const response = await axios.get('/api/bootstrap/preflight');
  return response.data;
}

export async function createBootstrapAgentDraft(payload: BootstrapAgentDraftRequest): Promise<BootstrapAgentDraftResponse> {
  const response = await axios.post('/api/bootstrap/agent-draft', payload);
  return response.data;
}

export async function bootstrapWorkspace(payload: BootstrapSetupRequest): Promise<boolean> {
  try {
    const response = await axios.post('/api/bootstrap/setup', payload);
    if (response.data?.access_token) {
      localStorage.setItem(AUTH_TOKEN_KEY, response.data.access_token);
      localStorage.setItem(SESSION_ID_KEY, 'rawclaw-client');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to bootstrap workspace', error);
    return false;
  }
}

export async function resetRawClaw(): Promise<boolean> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) return false;
  try {
    await axios.post(
      '/api/bootstrap/reset',
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return true;
  } catch (error) {
    console.error('Failed to reset RawClaw', error);
    return false;
  }
}

export async function bootstrapAuth(authSecret: string): Promise<boolean> {
  try {
    const response = await axios.post('/api/auth/token', {
      secret: authSecret,
    });
    
    if (response.data && response.data.access_token) {
      localStorage.setItem(AUTH_TOKEN_KEY, response.data.access_token);
      localStorage.setItem(SESSION_ID_KEY, 'rawclaw-client');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to bootstrap auth', error);
    return false;
  }
}

export function logout() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(SESSION_ID_KEY);
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getSessionId(): string | null {
  return localStorage.getItem(SESSION_ID_KEY);
}
