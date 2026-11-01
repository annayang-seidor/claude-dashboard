import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import type { HealthResponse, TokenRefreshResponse } from '../shared/api';
import { TOKEN_REFRESH_PATH } from '../shared/config';
import { registerApi, type ApiDeps } from './routes';
import { security, type SecurityOptions } from './security';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Sets Cache-Control on a 200 from the handlers after it. serveStatic's onFound runs after it has
 * built the response, too late to add a header. */
const cacheControl =
  (value: string): MiddlewareHandler =>
  async (c, next) => {
    await next();
    if (c.res.status === 200) c.res.headers.set('Cache-Control', value);
  };

export interface AppOptions extends SecurityOptions {
  /** Built web app to serve (dist/web). Omitted in dev, where Vite serves the page. */
  webRoot?: string;
  /** Session routes and live updates. Omitted in tests that only check the middleware. */
  api?: ApiDeps;
}

/** Host and Origin allow-lists for a server on `port`, plus the Vite dev origin when given. */
export function allowLists(
  port: number,
  webOrigin?: string,
): Omit<SecurityOptions, 'token' | 'previousToken'> {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedOrigins = allowedHosts.map((h) => `http://${h}`);
  if (webOrigin) allowedOrigins.push(webOrigin);
  return { allowedHosts, allowedOrigins };
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  app.use('*', security(opts));

  app.get('/api/health', (c) => c.json({ ok: true } satisfies HealthResponse));
  // The security check has already accepted the current or the previous token.
  app.post(TOKEN_REFRESH_PATH, (c) => c.json({ token: opts.token } satisfies TokenRefreshResponse));
  if (opts.api) registerApi(app, opts.api);

  if (opts.webRoot) {
    // Vite puts a content hash in every asset name, so a file never changes once built. A missing
    // one is a 404, not the app shell, which the browser would refuse to run (ADR 0050).
    app.use('/assets/*', cacheControl(IMMUTABLE), serveStatic({ root: opts.webRoot }));
    app.get('/assets/*', (c) => c.notFound());
    // The shell names the current assets, so the browser checks it on every load.
    app.use('*', cacheControl('no-cache'), serveStatic({ root: opts.webRoot }));
    // Client-side routes (/work, /personal) fall back to the app shell.
    app.get('*', serveStatic({ root: opts.webRoot, path: 'index.html' }));
  }

  return app;
}
