export interface WebchatMcpConfig {
  apiBase: string;
  secret: string;
}

export const DEFAULT_API_BASE = 'http://127.0.0.1:3200';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WebchatMcpConfig {
  const secret = env.WEBCHAT_SECRET?.trim();
  if (!secret) {
    throw new Error('WEBCHAT_SECRET is required');
  }
  return {
    apiBase: (env.WEBCHAT_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/$/, ''),
    secret,
  };
}
