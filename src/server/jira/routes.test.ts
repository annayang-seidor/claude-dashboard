import { describe, expect, it } from 'vitest';
import { TOKEN_HEADER } from '../../shared/config';
import { allowLists, createApp } from '../app';
import type { JiraAuth } from './auth';

const PORT = 4317;
const TOKEN = 'test-token-0123456789abcdefghijklmnop';
const PAGE = 'http://127.0.0.1:4317';

function setup(over: Partial<JiraAuth> = {}) {
  const events: string[] = [];
  const codes: string[] = [];
  const auth: JiraAuth = {
    configured: true,
    status: async () => ({ configured: true, connected: false, site: null }),
    beginLogin: () => 'https://auth.atlassian.com/authorize?state=good',
    takeState: (state) => state === 'good',
    finishLogin: async (code) => void codes.push(code),
    session: async () => null,
    disconnect: async () => {},
    ...over,
  };
  const app = createApp({
    ...allowLists(PORT),
    token: TOKEN,
    jira: { auth, pageOrigin: PAGE, onChanged: () => events.push('changed'), log: () => {} },
  });
  const send = (method: string, path: string, headers: Record<string, string> = {}) =>
    app.request(`http://localhost:${PORT}${path}`, {
      method,
      headers: { host: `localhost:${PORT}`, ...headers },
    });
  return { send, events, codes };
}

const withToken = { [TOKEN_HEADER]: TOKEN, origin: PAGE };

describe('Jira OAuth routes (ADR 0062)', () => {
  it('needs the token for status, start and disconnect', async () => {
    const s = setup();
    expect((await s.send('GET', '/api/jira/oauth/status')).status).toBe(403);
    expect((await s.send('POST', '/api/jira/oauth/start', { origin: PAGE })).status).toBe(403);
    expect((await s.send('GET', '/api/jira/oauth/status', withToken)).status).toBe(200);
  });

  it('start gives the consent URL, or 409 with no app in .env', async () => {
    expect(await (await setup().send('POST', '/api/jira/oauth/start', withToken)).json()).toEqual({
      url: 'https://auth.atlassian.com/authorize?state=good',
    });
    const res = await setup({ configured: false }).send('POST', '/api/jira/oauth/start', withToken);
    expect(res.status).toBe(409);
  });

  it('the callback needs no token, stores the login and sends the browser back', async () => {
    const s = setup();
    const res = await s.send('GET', '/api/jira/oauth/callback?state=good&code=c1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${PAGE}/jira-oauth?result=connected`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(s.codes).toEqual(['c1']);
    expect(s.events).toEqual(['changed']);
  });

  it('the callback refuses an unknown state and still checks Host', async () => {
    const s = setup();
    expect((await s.send('GET', '/api/jira/oauth/callback?state=bad&code=c1')).status).toBe(400);
    expect((await s.send('GET', '/api/jira/oauth/callback?code=c1')).status).toBe(400);
    const foreign = await s.send('GET', '/api/jira/oauth/callback?state=good&code=c1', {
      host: `evil.example:${PORT}`,
    });
    expect(foreign.status).toBe(403);
    expect(s.codes).toEqual([]);
  });

  it('only the callback path skips the token', async () => {
    const s = setup();
    expect((await s.send('GET', '/api/jira/oauth/callback/x?state=good')).status).toBe(403);
    expect(
      (await s.send('POST', '/api/jira/oauth/callback?state=good', { origin: PAGE })).status,
    ).toBe(403);
  });

  it('reports denied and failed logins on the page', async () => {
    const denied = await setup().send(
      'GET',
      '/api/jira/oauth/callback?state=good&error=access_denied',
    );
    expect(denied.headers.get('location')).toBe(`${PAGE}/jira-oauth?result=denied`);
    const s = setup({ finishLogin: () => Promise.reject(new Error('nope')) });
    const failed = await s.send('GET', '/api/jira/oauth/callback?state=good&code=c1');
    expect(failed.headers.get('location')).toBe(`${PAGE}/jira-oauth?result=failed`);
    expect(s.events).toEqual([]);
  });
});
