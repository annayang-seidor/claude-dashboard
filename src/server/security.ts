import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { TOKEN_HEADER, TOKEN_REFRESH_PATH } from '../shared/config';

export interface SecurityOptions {
  /** Exact Host header values accepted, e.g. "127.0.0.1:4317". Blocks DNS rebinding. */
  allowedHosts: readonly string[];
  /** Exact Origin values accepted on non-GET requests. Blocks CSRF from other pages. */
  allowedOrigins: readonly string[];
  /** Secret kept across restarts (ADR 0032), required on every /api request. */
  token: string;
  /** The token before the last rotation: accepted only by POST TOKEN_REFRESH_PATH (ADR 0048). */
  previousToken?: string | null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Host check on every request; Origin check on non-GET; token check on /api, where the refresh
 * route also takes the previous token. */
export function security(opts: SecurityOptions): MiddlewareHandler {
  const hosts = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const origins = new Set(opts.allowedOrigins.map((o) => o.toLowerCase()));

  return async (c, next) => {
    const host = c.req.header('host')?.toLowerCase();
    if (!host || !hosts.has(host)) {
      return c.json({ error: 'forbidden host' }, 403);
    }

    if (!SAFE_METHODS.has(c.req.method)) {
      // A missing Origin is rejected too: browsers always send it on non-GET requests.
      const origin = c.req.header('origin')?.toLowerCase();
      if (!origin || !origins.has(origin)) {
        return c.json({ error: 'forbidden origin' }, 403);
      }
    }

    if (c.req.path.startsWith('/api/')) {
      const given = c.req.header(TOKEN_HEADER);
      const refresh = c.req.method === 'POST' && c.req.path === TOKEN_REFRESH_PATH;
      const ok =
        tokenMatches(given, opts.token) ||
        (refresh && !!opts.previousToken && tokenMatches(given, opts.previousToken));
      if (!ok) return c.json({ error: 'forbidden token' }, 403);
    }

    await next();
  };
}
