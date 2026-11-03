import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { JiraOAuthStatusResponse } from '../../shared/api';
import { JIRA_OAUTH_CALLBACK_PATH, SERVER_HOST } from '../../shared/config';
import type { AtlassianApp } from './env';
import { readTokens, removeTokens, writeTokens, type StoredTokens } from './store';

export const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
export const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
export const RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
/** Read-only Jira, plus offline_access for a refresh token (ADR 0062). */
export const SCOPES = ['read:jira-work', 'read:jira-user', 'offline_access'] as const;

/** A consent left open longer than this has to start again. */
const STATE_TTL_MS = 10 * 60 * 1000;
/** Open consents kept at once; the oldest is dropped past this. */
const MAX_PENDING = 5;
/** Refreshed this long before it lapses, so no request starts with a token about to expire. */
const REFRESH_EARLY_MS = 60 * 1000;
export const REQUEST_TIMEOUT_MS = 30 * 1000;

/** Atlassian checks it against the app's callback URL exactly, so it is the page's own host
 * (ADR 0062). */
export const jiraRedirectUri = (port: number) =>
  `http://${SERVER_HOST}:${port}${JIRA_OAUTH_CALLBACK_PATH}`;

/** `auth`: no login, or Atlassian refused it; the user has to connect again. */
export class JiraError extends Error {
  override name = 'JiraError';
  constructor(
    readonly kind: 'auth' | 'timeout' | 'failed',
    message: string,
    /** Jira's HTTP status, when it answered. */
    readonly status?: number,
  ) {
    super(message);
  }
}

const TokenReply = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  /** Missing on a refresh when rotation is off; the old one then stays valid. */
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(''),
});

const Resources = z.array(
  z.looseObject({ id: z.string().min(1).max(100), url: z.string().min(1).max(300) }),
);

export interface JiraSession {
  accessToken: string;
  cloudId: string;
}

export interface JiraAuth {
  /** The .env names an Atlassian app. */
  readonly configured: boolean;
  status(): Promise<JiraOAuthStatusResponse>;
  /** The consent page URL with a new one-time state. Throws when not configured. */
  beginLogin(): string;
  /** Consumes the state: true once for a state beginLogin made in the last 10 minutes. */
  takeState(state: string): boolean;
  /** Swaps the callback's code for tokens and stores them. Throws JiraError. */
  finishLogin(code: string): Promise<void>;
  /** A usable access token, refreshed when near expiry or when `forceRefresh` (after a 401).
   * Null when not connected. Throws JiraError when a refresh fails. */
  session(opts?: { forceRefresh?: boolean }): Promise<JiraSession | null>;
  disconnect(): Promise<void>;
}

export interface JiraAuthOptions {
  app: AtlassianApp | null;
  /** ~/.claude-dashboard/jira-oauth.json */
  tokenPath: string;
  redirectUri: string;
  /** The config's jiraBaseUrl: picks the site when the login reaches more than one. */
  siteUrl: string | null;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export function createJiraAuth(opts: JiraAuthOptions): JiraAuth {
  const fetchFn = opts.fetch ?? fetch;
  const now = () => (opts.now ?? (() => new Date()))().getTime();
  const log = opts.log ?? ((m: string) => console.warn(`[jira-oauth] ${m}`));
  /** state → when it was made. */
  const pending = new Map<string, number>();
  // undefined: not read yet; null: no login.
  let tokens: StoredTokens | null | undefined;
  let refreshing: Promise<StoredTokens> | null = null;

  const app = () => {
    if (!opts.app) throw new JiraError('auth', 'no Atlassian app in .env');
    return opts.app;
  };

  async function load(): Promise<StoredTokens | null> {
    if (tokens === undefined) tokens = await readTokens(opts.tokenPath, log);
    return tokens;
  }

  async function post(url: string, body: Record<string, string>): Promise<Response> {
    try {
      return await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = (err as Error).name === 'TimeoutError';
      throw new JiraError(timedOut ? 'timeout' : 'failed', `${url}: ${(err as Error).message}`);
    }
  }

  /** Atlassian's error code (e.g. invalid_grant), never the body: it may echo the request. */
  async function errorCode(res: Response): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof body?.error === 'string' ? body.error.slice(0, 60) : `HTTP ${res.status}`;
  }

  async function tokenReply(res: Response): Promise<z.infer<typeof TokenReply>> {
    const reply = TokenReply.safeParse(await res.json().catch(() => null));
    if (!reply.success) throw new JiraError('failed', 'token reply is not the expected shape');
    return reply.data;
  }

  async function pickSite(accessToken: string): Promise<{ cloudId: string; site: string }> {
    let res: Response;
    try {
      res = await fetchFn(RESOURCES_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new JiraError('failed', `accessible-resources: ${(err as Error).message}`);
    }
    if (!res.ok) throw new JiraError('failed', `accessible-resources: HTTP ${res.status}`);
    const sites = Resources.safeParse(await res.json().catch(() => null));
    if (!sites.success) throw new JiraError('failed', 'accessible-resources: unexpected shape');
    const want = opts.siteUrl && trimSlash(opts.siteUrl);
    const site = want
      ? sites.data.find((s) => trimSlash(s.url) === want)
      : sites.data.length === 1
        ? sites.data[0]
        : undefined;
    if (!site) {
      throw new JiraError(
        'failed',
        want
          ? `the login cannot reach ${want}; it reaches ${sites.data.map((s) => s.url).join(', ') || 'no site'}`
          : `the login reaches ${sites.data.length} sites; set jiraBaseUrl to pick one`,
      );
    }
    return { cloudId: site.id, site: trimSlash(site.url) };
  }

  async function save(next: StoredTokens): Promise<StoredTokens> {
    await writeTokens(opts.tokenPath, next);
    tokens = next;
    return next;
  }

  async function refresh(current: StoredTokens): Promise<StoredTokens> {
    const { clientId, clientSecret } = app();
    const res = await post(TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: current.refreshToken,
    });
    if (res.status >= 400 && res.status < 500) {
      // invalid_grant: revoked, expired after 90 idle days, or already rotated away.
      const code = await errorCode(res);
      log(`refresh refused (${code}); connect Jira again`);
      await removeTokens(opts.tokenPath);
      tokens = null;
      throw new JiraError('auth', `refresh refused: ${code}`);
    }
    if (!res.ok) throw new JiraError('failed', `refresh: HTTP ${res.status}`);
    const reply = await tokenReply(res);
    return save({
      ...current,
      accessToken: reply.access_token,
      refreshToken: reply.refresh_token ?? current.refreshToken,
      expiresAt: now() + reply.expires_in * 1000,
      scope: reply.scope || current.scope,
    });
  }

  return {
    configured: !!opts.app,

    async status() {
      const t = opts.app ? await load() : null;
      return { configured: !!opts.app, connected: !!t, site: t?.site ?? null };
    },

    beginLogin() {
      const { clientId } = app();
      const at = now();
      for (const [s, made] of pending) if (at - made > STATE_TTL_MS) pending.delete(s);
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      const state = randomBytes(32).toString('base64url');
      pending.set(state, at);
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: clientId,
        scope: SCOPES.join(' '),
        redirect_uri: opts.redirectUri,
        state,
        response_type: 'code',
        prompt: 'consent',
      }).toString();
      return url.toString();
    },

    takeState(state) {
      const made = pending.get(state);
      pending.delete(state);
      return made !== undefined && now() - made <= STATE_TTL_MS;
    },

    async finishLogin(code) {
      const { clientId, clientSecret } = app();
      const res = await post(TOKEN_URL, {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: opts.redirectUri,
      });
      if (!res.ok) throw new JiraError('auth', `code exchange refused: ${await errorCode(res)}`);
      const reply = await tokenReply(res);
      if (!reply.refresh_token) {
        throw new JiraError('failed', 'no refresh token: the app needs the offline_access scope');
      }
      const site = await pickSite(reply.access_token);
      await save({
        accessToken: reply.access_token,
        refreshToken: reply.refresh_token,
        expiresAt: now() + reply.expires_in * 1000,
        scope: reply.scope,
        ...site,
      });
      log(`connected to ${site.site}`);
    },

    async session({ forceRefresh = false } = {}) {
      if (!opts.app) return null;
      const t = await load();
      if (!t) return null;
      let current = t;
      if (forceRefresh || current.expiresAt - REFRESH_EARLY_MS <= now()) {
        // One refresh at a time: a second one would send a refresh token the first just rotated.
        refreshing ??= refresh(current).finally(() => (refreshing = null));
        current = await refreshing;
      }
      return { accessToken: current.accessToken, cloudId: current.cloudId };
    },

    async disconnect() {
      await removeTokens(opts.tokenPath);
      tokens = null;
    },
  };
}
