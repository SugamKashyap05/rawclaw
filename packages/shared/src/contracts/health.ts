export interface ServiceStatus {
  status: 'ok' | 'down';
  version?: string;
  details?: string;
}

/**
 * Interface for the API Health response.
 */
export interface ApiHealth extends HealthStatus {
  services: {
    db: 'ok' | 'down';
    redis: 'ok' | 'down';
    agent: 'ok' | 'down';
  };
}

/**
 * Interface for the Agent Health response.
 */
export interface AgentHealth {
  status: 'ok' | 'down';
  version: string;
  uptime: number;
}

/**
 * Represents the universal health check payload structure.
 */
export interface HealthStatus {
  /** Overall system health status */
  status: 'ok' | 'degraded' | 'down';
  /** Status mapped per dependent service in the system */
  services: Record<string, 'ok' | 'down'>;
  /** Current API or Agent execution version */
  version: string;
  /** The ISO 8601 timestamp representing the last ping */
  timestamp: string;
}
