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
  };
};
