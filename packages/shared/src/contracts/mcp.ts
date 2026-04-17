export type MCPTransportType = 'stdio' | 'sse';
export type MCPServerRuntimeStatus = 'running' | 'stopped' | 'error';

export interface MCPServerTool {
  name: string;
  description?: string | null;
  input_schema?: Record<string, unknown>;
}

export interface MCPServerRecord {
  id: string;
  name: string;
  type: MCPTransportType;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: MCPServerRuntimeStatus;
  lastError?: string | null;
  tools: MCPServerTool[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMCPServerRequest {
  name: string;
  type: MCPTransportType;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface UpdateMCPServerRequest {
  name?: string;
  type?: MCPTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface TestMCPConnectionRequest extends CreateMCPServerRequest {}

export interface TestMCPConnectionResponse {
  success: boolean;
  message: string;
  discoveredTools: MCPServerTool[];
}
