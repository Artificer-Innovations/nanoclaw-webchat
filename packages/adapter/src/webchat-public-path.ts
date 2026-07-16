/**
 * Shared WEBCHAT_PUBLIC_PATH normalization for reverse-proxy path mounts.
 */

/** Normalize a raw public path to `/webchat` or `''` (bare `/` and empty → empty). */
export function normalizeWebchatPublicPath(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') : `/${trimmed.replace(/\/+$/, '')}`;
}

/** Resolve from process env and optional `.env` file values (exported for tests). */
export function resolveWebchatPublicPath(env: Record<string, string | undefined> = {}): string {
  return normalizeWebchatPublicPath(process.env.WEBCHAT_PUBLIC_PATH || env.WEBCHAT_PUBLIC_PATH);
}
