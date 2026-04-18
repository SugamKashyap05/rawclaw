export default () => {
  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) {
    throw new Error('AGENT_URL environment variable is required');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  return {
    port: parseInt(process.env.API_PORT || '3000', 10),
    agentUrl: agentUrl as string,
    databaseUrl: databaseUrl as string,
    redisUrl: redisUrl as string,
    chromaHost: process.env.CHROMA_HOST || process.env.CHROMA_SERVER_HOST || 'localhost',
    chromaPort: parseInt(process.env.CHROMA_PORT || process.env.CHROMA_SERVER_HTTP_PORT || '8010', 10),
    jwtSecret: process.env.JWT_SECRET || 'PLEASE_CHANGE_ME_TO_A_LONG_RANDOM_STRING',
    authSecret: process.env.AUTH_SECRET || 'A_STRONG_SECRET_FOR_BOOTSTRAP',
    allowLocalAuth: process.env.ALLOW_LOCAL_AUTH || 'true',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    allowCloudOcr: process.env.ALLOW_CLOUD_OCR === 'true',
  };
};
