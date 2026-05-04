export default () => {
  const agentUrl = process.env.RAWCLAW_AGENT_URL || process.env.AGENT_URL;
  if (!agentUrl) {
    throw new Error('AGENT_URL environment variable is required');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const redisUrl = process.env.RAWCLAW_REDIS_URL || process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  const phase3Enabled = (process.env.RAWCLAW_PHASE3_ENABLED || 'true').toLowerCase() === 'true';
  const chromaUrl = process.env.RAWCLAW_CHROMA_URL
    || process.env.CHROMA_URL
    || `http://${process.env.CHROMA_HOST || process.env.CHROMA_SERVER_HOST || 'localhost'}:${process.env.CHROMA_PORT || process.env.CHROMA_SERVER_HTTP_PORT || '8010'}`;

  return {
    port: parseInt(process.env.API_PORT || '3000', 10),
    agentUrl: agentUrl as string,
    databaseUrl: databaseUrl as string,
    redisUrl: redisUrl as string,
    rawclawApiUrl: process.env.RAWCLAW_API_URL || `http://localhost:${process.env.API_PORT || '3000'}`,
    chromaUrl,
    chromaHost: process.env.CHROMA_HOST || process.env.CHROMA_SERVER_HOST || 'localhost',
    chromaPort: parseInt(process.env.CHROMA_PORT || process.env.CHROMA_SERVER_HTTP_PORT || '8010', 10),
    jwtSecret: process.env.JWT_SECRET || 'PLEASE_CHANGE_ME_TO_A_LONG_RANDOM_STRING',
    authSecret: process.env.AUTH_SECRET || 'A_STRONG_SECRET_FOR_BOOTSTRAP',
    internalWorkerBootstrapSecret: process.env.INTERNAL_WORKER_BOOTSTRAP_SECRET || process.env.AUTH_SECRET || 'A_STRONG_SECRET_FOR_BOOTSTRAP',
    internalWorkerSigningKey: process.env.INTERNAL_WORKER_SIGNING_KEY || process.env.JWT_SECRET || 'PLEASE_CHANGE_ME_TO_A_LONG_RANDOM_STRING',
    internalWorkerTokenTtlSeconds: parseInt(process.env.INTERNAL_WORKER_TOKEN_TTL_SECONDS || '300', 10),
    phase3Enabled,
    sandboxWorkerPoolEnabled: (process.env.SANDBOX_WORKER_POOL_ENABLED || (phase3Enabled ? 'true' : 'false')).toLowerCase() === 'true',
    allowDegradedStartup: (process.env.RAWCLAW_ALLOW_DEGRADED_STARTUP || 'false').toLowerCase() === 'true',
    allowLocalAuth: process.env.ALLOW_LOCAL_AUTH || 'true',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    allowCloudOcr: process.env.ALLOW_CLOUD_OCR === 'true',
  };
};
