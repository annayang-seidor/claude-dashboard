import { describe, expect, it } from 'vitest';
import type { JiraSession } from './auth';
import { createJiraClient } from './client';

interface Call {
  url: string;
  auth: string | null;
  body: Record<string, unknown> | null;
}

function setup(
  replies: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>,
) {
  const calls: Call[] = [];
  const sessions: Array<{ forceRefresh?: boolean }> = [];
  const waits: number[] = [];
  let token = 'access-1';
  const client = createJiraClient({
    auth: {
      async session(opts = {}): Promise<JiraSession> {
        sessions.push(opts);
        if (opts.forceRefresh) token = 'access-2';
        return { accessToken: token, cloudId: 'cloud-1' };
      },
    },
    fetch: (async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        auth: new Headers(init?.headers).get('authorization'),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      const reply = replies.shift();
      if (!reply) throw new Error('unexpected fetch');
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: reply.headers,
      });
    }) as typeof fetch,
    sleep: async (ms) => void waits.push(ms),
  });
  return { client, calls, sessions, waits };
}

const issue = (key: string) => ({ id: key, key, fields: { summary: `about ${key}` } });

describe('search', () => {
  it('pages with nextPageToken until isLast, through the cloud id', async () => {
    const s = setup([
      { body: { issues: [issue('FA-1'), issue('FA-2')], nextPageToken: 'p2' } },
      { body: { issues: [issue('FA-3')], isLast: true } },
    ]);
    const found = await s.client.search({ jql: 'project = FA', fields: ['summary'], max: 50 });
    expect(found.map((i) => i.key)).toEqual(['FA-1', 'FA-2', 'FA-3']);
    expect(s.calls[0]).toEqual({
      url: 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/search/jql',
      auth: 'Bearer access-1',
      body: { jql: 'project = FA', fields: ['summary'], maxResults: 50 },
    });
    expect(s.calls[1]!.body).toMatchObject({ nextPageToken: 'p2', maxResults: 48 });
  });

  it('stops at max', async () => {
    const s = setup([{ body: { issues: [issue('FA-1'), issue('FA-2')], nextPageToken: 'p2' } }]);
    expect(await s.client.search({ jql: 'x', fields: [], max: 2 })).toHaveLength(2);
    expect(s.calls).toHaveLength(1);
  });

  it('refreshes once after a 401 and retries', async () => {
    const s = setup([{ status: 401, body: {} }, { body: { issues: [], isLast: true } }]);
    await s.client.search({ jql: 'x', fields: [], max: 10 });
    expect(s.sessions).toEqual([{ forceRefresh: false }, { forceRefresh: true }]);
    expect(s.calls[1]!.auth).toBe('Bearer access-2');
  });

  it('is an auth error when the retry is refused too', async () => {
    const s = setup([
      { status: 401, body: {} },
      { status: 401, body: {} },
    ]);
    await expect(s.client.search({ jql: 'x', fields: [], max: 10 })).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('waits out a 429 once, capped at 10 s', async () => {
    const s = setup([
      { status: 429, body: {}, headers: { 'retry-after': '60' } },
      { body: { issues: [], isLast: true } },
    ]);
    await s.client.search({ jql: 'x', fields: [], max: 10 });
    expect(s.waits).toEqual([10_000]);
  });

  it('fails on a reply that is not a search page, naming the path', async () => {
    const s = setup([{ body: { issues: [{ id: '1', key: 'not a key', fields: {} }] } }]);
    await expect(s.client.search({ jql: 'x', fields: [], max: 10 })).rejects.toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('issues.0.key'),
    });
  });
});

describe('myself', () => {
  it('reads the logged-in user', async () => {
    const s = setup([{ body: { accountId: 'acc-1', displayName: 'Anna', extra: true } }]);
    expect(await s.client.myself()).toMatchObject({ accountId: 'acc-1', displayName: 'Anna' });
    expect(s.calls[0]!.url).toBe('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself');
  });
});

describe('issue', () => {
  it('reads one issue, and is null when Jira has none', async () => {
    const s = setup([{ body: issue('FA-1') }, { status: 404, body: {} }]);
    expect(await s.client.issue('FA-1', ['summary', 'status'])).toMatchObject({ key: 'FA-1' });
    expect(s.calls[0]!.url).toBe(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/FA-1?fields=summary%2Cstatus',
    );
    expect(await s.client.issue('FA-2', ['summary'])).toBeNull();
  });

  it('keeps the status on other errors', async () => {
    const s = setup([{ status: 400, body: {} }]);
    await expect(s.client.search({ jql: 'bad', fields: [], max: 1 })).rejects.toMatchObject({
      kind: 'failed',
      status: 400,
    });
  });
});
