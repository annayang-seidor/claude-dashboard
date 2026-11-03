import type { Hono } from 'hono';
import {
  JiraOAuthCallbackQuery,
  type ErrorResponse,
  type JiraOAuthDisconnectResponse,
  type JiraOAuthResult,
  type JiraOAuthStartResponse,
  type JiraOAuthStatusResponse,
} from '../../shared/api';
import { JIRA_OAUTH_CALLBACK_PATH, JIRA_OAUTH_RESULT_PATH } from '../../shared/config';
import type { JiraAuth } from './auth';

export interface JiraOAuthRouteDeps {
  auth: JiraAuth;
  /** Where the page is served: the callback sends the browser back there. */
  pageOrigin: string;
  /** After a connect or disconnect, so open pages refetch the status. */
  onChanged(): void;
  log?: (message: string) => void;
}

const bad = (error: string): ErrorResponse => ({ error });

/** The OAuth routes (ADR 0062). Only the callback skips the token check; its one-time `state`
 * stands in for it. */
export function registerJiraOAuth(app: Hono, deps: JiraOAuthRouteDeps): void {
  const log = deps.log ?? ((m: string) => console.warn(`[jira-oauth] ${m}`));

  app.get('/api/jira/oauth/status', async (c) =>
    c.json((await deps.auth.status()) satisfies JiraOAuthStatusResponse),
  );

  app.post('/api/jira/oauth/start', (c) => {
    if (!deps.auth.configured) return c.json(bad('no Atlassian app in .env'), 409);
    return c.json({ url: deps.auth.beginLogin() } satisfies JiraOAuthStartResponse);
  });

  app.post('/api/jira/oauth/disconnect', async (c) => {
    await deps.auth.disconnect();
    deps.onChanged();
    return c.json({ ok: true } satisfies JiraOAuthDisconnectResponse);
  });

  app.get(JIRA_OAUTH_CALLBACK_PATH, async (c) => {
    // The query holds the code: never cache it, never pass it on as a Referer.
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    const query = JiraOAuthCallbackQuery.safeParse(c.req.query());
    if (!query.success || !deps.auth.takeState(query.data.state)) {
      return c.json(bad('invalid or expired state; start the Jira login again'), 400);
    }
    const back = (result: JiraOAuthResult) =>
      c.redirect(`${deps.pageOrigin}${JIRA_OAUTH_RESULT_PATH}?result=${result}`, 302);
    if (query.data.error || !query.data.code) return back('denied');
    try {
      await deps.auth.finishLogin(query.data.code);
    } catch (err) {
      log(`login failed: ${(err as Error).message}`);
      return back('failed');
    }
    deps.onChanged();
    return back('connected');
  });
}
