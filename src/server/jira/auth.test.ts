import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createJiraAuth,
  jiraRedirectUri,
  RESOURCES_URL,
  TOKEN_URL,
  type JiraAuthOptions,
} from './auth';
import type { StoredTokens } from './store';

const dir = mkdtempSync(join(tmpdir(), 'jira-auth-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const APP = { clientId: 'client-1', clientSecret: 'secret-1' };
const SITE = 'https://example.atlassian.net';
const NOW = new Date('2026-11-03T10:00:00Z');
let n = 0;

interface Call {
  url: string;
  body: Record<string, string> | null;
}

/** A fake fetch answering from a queue, recording what was sent. */
function fakeFetch(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : null,
    });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected fetch ${String(input)}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

function setup(
  replies: Array<{ status?: number; body: unknown }>,
  over: Partial<JiraAuthOptions> = {},
) {
  const tokenPath = join(dir, `tokens-${++n}.json`);
  const f = fakeFetch(replies);
  const logs: string[] = [];
  const auth = createJiraAuth({
    app: APP,
    tokenPath,
    redirectUri: 'http://localhost:4317/api/jira/oauth/callback',
    siteUrl: SITE,
    fetch: f.fn,
    now: () => NOW,
    log: (m) => logs.push(m),
    ...over,
  });
  return { auth, tokenPath, calls: f.calls, logs };
}

const stored = (over: Partial<StoredTokens> = {}): StoredTokens => ({
  accessToken: 'access-old',
  refreshToken: 'refresh-old',
  expiresAt: NOW.getTime() + 30 * 60 * 1000,
  scope: 'read:jira-work',
  cloudId: 'cloud-1',
  site: SITE,
  ...over,
});

const tokenReply = {
  access_token: 'access-new',
  expires_in: 3600,
  refresh_token: 'refresh-new',
  scope: 'read:jira-work offline_access',
};
const sites = [
  { id: 'cloud-other', url: 'https://other.atlassian.net' },
  { id: 'cloud-1', url: `${SITE}/` },
];

describe('beginLogin and takeState', () => {
  it('builds the consent URL with read-only scopes and a one-time state', () => {
    const { auth } = setup([]);
    const url = new URL(auth.beginLogin());
    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('scope')).toBe('read:jira-work read:jira-user offline_access');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4317/api/jira/oauth/callback',
    );
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.toString()).not.toContain('secret-1');
    const state = url.searchParams.get('state')!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.takeState(state)).toBe(true);
    expect(auth.takeState(state)).toBe(false);
    expect(auth.takeState('made-up')).toBe(false);
  });

  it('refuses a state older than 10 minutes', () => {
    let now = NOW;
    const { auth } = setup([], { now: () => now });
    const state = new URL(auth.beginLogin()).searchParams.get('state')!;
    now = new Date(NOW.getTime() + 10 * 60 * 1000 + 1);
    expect(auth.takeState(state)).toBe(false);
  });

  it('throws when the .env names no app', () => {
    const { auth } = setup([], { app: null });
    expect(auth.configured).toBe(false);
    expect(() => auth.beginLogin()).toThrow(/no Atlassian app/);
  });
});

describe('finishLogin', () => {
  it('swaps the code, picks the configured site and stores the tokens mode 600', async () => {
    const { auth, tokenPath, calls } = setup([{ body: tokenReply }, { body: sites }]);
    await auth.finishLogin('code-1');
    expect(calls[0]).toEqual({
      url: TOKEN_URL,
      body: {
        grant_type: 'authorization_code',
        client_id: 'client-1',
        client_secret: 'secret-1',
        code: 'code-1',
        redirect_uri: 'http://localhost:4317/api/jira/oauth/callback',
      },
    });
    expect(calls[1]!.url).toBe(RESOURCES_URL);
    expect(JSON.parse(readFileSync(tokenPath, 'utf8'))).toEqual({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      expiresAt: NOW.getTime() + 3600 * 1000,
      scope: 'read:jira-work offline_access',
      cloudId: 'cloud-1',
      site: SITE,
    });
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    expect(await auth.status()).toEqual({ configured: true, connected: true, site: SITE });
  });

  it('stores nothing when the login cannot reach the configured site', async () => {
    const { auth, tokenPath } = setup([{ body: tokenReply }, { body: [sites[0]] }]);
    await expect(auth.finishLogin('code-1')).rejects.toThrow(/cannot reach https:\/\/example/);
    expect(() => statSync(tokenPath)).toThrow();
  });

  it('is an auth error when Atlassian refuses the code', async () => {
    const { auth } = setup([{ status: 403, body: { error: 'invalid_grant' } }]);
    await expect(auth.finishLogin('code-1')).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('session', () => {
  it('is null with no stored login', async () => {
    const { auth } = setup([]);
    expect(await auth.session()).toBeNull();
    expect(await auth.status()).toEqual({ configured: true, connected: false, site: null });
  });

  it('uses the stored token while it has more than a minute left', async () => {
    const { auth, tokenPath, calls } = setup([]);
    writeFileSync(tokenPath, JSON.stringify(stored()), { mode: 0o600 });
    expect(await auth.session()).toEqual({ accessToken: 'access-old', cloudId: 'cloud-1' });
    expect(calls).toEqual([]);
  });

  it('refreshes near expiry, once for parallel callers, and keeps the rotated refresh token', async () => {
    const { auth, tokenPath, calls } = setup([{ body: tokenReply }]);
    writeFileSync(tokenPath, JSON.stringify(stored({ expiresAt: NOW.getTime() + 30 * 1000 })));
    const [a, b] = await Promise.all([auth.session(), auth.session()]);
    expect(a).toEqual({ accessToken: 'access-new', cloudId: 'cloud-1' });
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-old',
    });
    expect(JSON.parse(readFileSync(tokenPath, 'utf8'))).toMatchObject({
      refreshToken: 'refresh-new',
      cloudId: 'cloud-1',
    });
  });

  it('drops the login when the refresh is refused, without logging the token', async () => {
    const { auth, tokenPath, logs } = setup([{ status: 403, body: { error: 'invalid_grant' } }]);
    writeFileSync(tokenPath, JSON.stringify(stored()));
    await expect(auth.session({ forceRefresh: true })).rejects.toMatchObject({ kind: 'auth' });
    expect(() => statSync(tokenPath)).toThrow();
    expect(await auth.session()).toBeNull();
    expect(logs.join('\n')).toContain('invalid_grant');
    expect(logs.join('\n')).not.toContain('refresh-old');
  });

  it('keeps the login when Atlassian fails with a 5xx', async () => {
    const { auth, tokenPath } = setup([{ status: 503, body: {} }]);
    writeFileSync(tokenPath, JSON.stringify(stored()));
    await expect(auth.session({ forceRefresh: true })).rejects.toMatchObject({ kind: 'failed' });
    expect(statSync(tokenPath).isFile()).toBe(true);
  });
});

describe('jiraRedirectUri', () => {
  it('is on the page host, as registered on the Atlassian app', () => {
    expect(jiraRedirectUri(4317)).toBe('http://127.0.0.1:4317/api/jira/oauth/callback');
  });
});
