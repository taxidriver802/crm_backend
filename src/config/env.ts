// src/config/env.ts
function requireEnv(name: string, value?: string) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(value?: string) {
  return value?.trim() || undefined;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  port: Number(process.env.PORT || 4000),

  databaseUrl: requireEnv('DATABASE_URL', process.env.DATABASE_URL),
  jwtSecret: requireEnv('JWT_SECRET', process.env.JWT_SECRET),

  abc: {
    baseUrl: optionalEnv(process.env.ABC_API_BASE_URL),
    clientId: optionalEnv(process.env.ABC_CLIENT_ID),
    clientSecret: optionalEnv(process.env.ABC_CLIENT_SECRET),
    accessToken: optionalEnv(process.env.ABC_ACCESS_TOKEN),
    refreshToken: optionalEnv(process.env.ABC_REFRESH_TOKEN),
    webhookSecret: optionalEnv(process.env.ABC_WEBHOOK_SECRET),
    accountId: optionalEnv(process.env.ABC_ACCOUNT_ID),
  },
};
