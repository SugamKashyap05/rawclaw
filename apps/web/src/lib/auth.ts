import axios from 'axios';

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

export async function getBootstrapStatus(): Promise<{
  initialized: boolean;
  needsSetup: boolean;
  workspaceFiles: { user: boolean; soul: boolean; memory: boolean; tools: boolean };
}> {
  const response = await axios.get('/api/auth/bootstrap/status');
  return response.data;
}

export async function bootstrapWorkspace(payload: {
  user: string;
  soul?: string;
  memory?: string;
  tools?: string;
}): Promise<boolean> {
  try {
    const response = await axios.post('/api/auth/bootstrap/setup', payload);
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
