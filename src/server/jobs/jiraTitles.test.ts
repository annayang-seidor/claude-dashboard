import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunFailure } from '../../shared/api';
import { JiraError } from '../jira/auth';
import type { JiraClient, JiraIssue } from '../jira/client';
import { openStateStore } from '../state';
import {
  KEYS_PER_RUN,
  RETRY_AFTER_FAILURE_MS,
  TITLE_TTL_MS,
  createJiraTitles,
  titlesJql,
} from './jiraTitles';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const START = new Date('2026-10-24T09:00:00.000Z');

interface Found {
  ok: true;
  data: { issues: { key: string; title: unknown; status?: string }[] };
}
type Result = Found | { ok: false; reason: RunFailure; status?: number };
type Reply = Result | ((req: { jql: string }) => Result);

/** A search reply as Jira sends it. */
const toIssue = (i: Found['data']['issues'][number]): JiraIssue => ({
  id: i.key,
  key: i.key,
  fields: { summary: i.title, status: { name: i.status ?? 'To Do' } },
});

async function setup(keys: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'jira-titles-test-'));
  tmpDirs.push(dir);
  const state = await openStateStore({ path: join(dir, 'state.json'), log: () => {} });
  let now = START;
  const replies: Reply[] = [];
  const requests: { jql: string }[] = [];
  /** Per-key reads after a 400; a key not listed here is a 404. */
  const single: Record<string, string> = {};
  const jira: Pick<JiraClient, 'search' | 'issue'> = {
    async search(req) {
      requests.push({ jql: req.jql });
      const reply = replies.shift() ?? { ok: false, reason: 'failed' };
      const result = typeof reply === 'function' ? reply(req) : reply;
      if (!result.ok) {
        const kind = result.reason === 'invalid' ? 'failed' : result.reason;
        throw new JiraError(kind, `fake ${kind}`, result.status);
      }
      return result.data.issues.map(toIssue);
    },
    async issue(key) {
      requests.push({ jql: `issue ${key}` });
      return single[key] ? toIssue({ key, title: single[key] }) : null;
    },
  };
  let changed = 0;
  const titles = createJiraTitles({
    jira,
    state,
    keys: async () => keys,
    onChanged: () => changed++,
    now: () => now,
    log: () => {},
  });
  return {
    state,
    titles,
    requests,
    replies,
    single,
    changed: () => changed,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const issues = (...list: [key: string, title: string, status?: string][]) => ({
  ok: true as const,
  data: { issues: list.map(([key, title, status = 'To Do']) => ({ key, title, status })) },
});

describe('titlesJql', () => {
  it('names every key in one search', () => {
    expect(titlesJql(['FA-1', 'ACME-642'])).toBe('key in (FA-1, ACME-642)');
  });
});

describe('jiraTitles', () => {
  it('fetches uncached keys once, caches them and serves them from the cache', async () => {
    const s = await setup(['FA-1', 'FA-2', 'FA-1']);
    s.replies.push(issues(['FA-1', 'Member discount'], ['FA-2', 'Gift card', 'Done']));
    const res = await s.titles.refresh();
    expect(res.titles).toEqual({
      'FA-1': { title: 'Member discount', status: 'To Do' },
      'FA-2': { title: 'Gift card', status: 'Done' },
    });
    expect(res.lastRun).toEqual({ at: START.toISOString(), ok: true });
    expect(s.requests).toEqual([{ jql: 'key in (FA-1, FA-2)' }]);
    expect(s.changed()).toBe(1);

    // Fresh: a background refresh runs nothing.
    await s.titles.refresh();
    expect(s.requests).toHaveLength(1);
  });

  it('fetches again after 24 h, or at once when forced', async () => {
    const s = await setup(['FA-1']);
    s.replies.push(issues(['FA-1', 'Old title']));
    await s.titles.refresh();

    s.replies.push(issues(['FA-1', 'Forced title']));
    expect((await s.titles.refresh({ force: true })).titles['FA-1']?.title).toBe('Forced title');

    s.advance(TITLE_TTL_MS - 1000);
    await s.titles.refresh();
    expect(s.requests).toHaveLength(2);
    s.advance(1000);
    s.replies.push(issues(['FA-1', 'New title']));
    expect((await s.titles.refresh()).titles['FA-1']?.title).toBe('New title');
    expect(s.requests).toHaveLength(3);
  });

  it('caches keys Jira returns no issue for as missing', async () => {
    const s = await setup(['FA-1', 'FA-404', 'FA-9']);
    s.replies.push({ ok: true, data: { issues: [{ key: 'FA-1', title: 'A', status: 'Done' }] } });
    const res = await s.titles.refresh();
    expect(Object.keys(res.titles)).toEqual(['FA-1']);
    expect(s.state.jiraTitles()['FA-404']).toEqual({
      missing: true,
      fetchedAt: START.toISOString(),
    });
    expect(s.state.jiraTitles()['FA-9']).toMatchObject({ missing: true });
    await s.titles.refresh();
    expect(s.requests).toHaveLength(1);
  });

  it('ignores an issue it did not ask for', async () => {
    const s = await setup(['FA-1']);
    s.replies.push(issues(['FA-1', 'A'], ['EVIL-1', 'Not asked for']));
    expect(Object.keys((await s.titles.refresh()).titles)).toEqual(['FA-1']);
    expect(s.state.jiraTitles()).not.toHaveProperty('EVIL-1');
  });

  it('counts an issue without a usable summary as missing', async () => {
    const s = await setup(['FA-1']);
    s.replies.push({ ok: true, data: { issues: [{ key: 'FA-1', title: 42 }] } });
    expect((await s.titles.refresh()).titles).toEqual({});
    expect(s.state.jiraTitles()['FA-1']).toMatchObject({ missing: true });
  });

  it('reads key by key when Jira refuses the search with 400, a 404 being missing', async () => {
    const s = await setup(['FA-1', 'FA-404']);
    s.replies.push({ ok: false, reason: 'failed', status: 400 });
    s.single['FA-1'] = 'One by one';
    const res = await s.titles.refresh();
    expect(res.titles).toEqual({ 'FA-1': { title: 'One by one', status: 'To Do' } });
    expect(s.state.jiraTitles()['FA-404']).toMatchObject({ missing: true });
    expect(s.requests.map((r) => r.jql)).toEqual([
      'key in (FA-1, FA-404)',
      'issue FA-1',
      'issue FA-404',
    ]);
  });

  it('keeps the cache when Jira fails', async () => {
    const s = await setup(['FA-1']);
    s.replies.push(issues(['FA-1', 'Good title']));
    await s.titles.refresh();
    const before = s.state.jiraTitles();

    s.replies.push({ ok: false, reason: 'failed', status: 500 });
    const res = await s.titles.refresh({ force: true });
    expect(res.lastRun).toMatchObject({ ok: false, reason: 'failed' });
    expect(res.titles).toEqual({ 'FA-1': { title: 'Good title', status: 'To Do' } });
    expect(s.state.jiraTitles()).toEqual(before);
    expect(s.changed()).toBe(1);
  });

  it('keeps the cache and reports auth when the Jira login is needed', async () => {
    const s = await setup(['FA-1']);
    s.replies.push({ ok: false, reason: 'auth' });
    const res = await s.titles.refresh();
    expect(res).toEqual({
      titles: {},
      lastRun: { at: START.toISOString(), ok: false, reason: 'auth' },
    });
    expect(s.state.jiraTitles()).toEqual({});
  });

  it('holds background refreshes back for a while after a failure, but not a forced one', async () => {
    const s = await setup(['FA-1']);
    s.replies.push({ ok: false, reason: 'timeout' });
    await s.titles.refresh();
    await s.titles.refresh();
    expect(s.requests).toHaveLength(1);

    s.replies.push(issues(['FA-1', 'A']));
    await s.titles.refresh({ force: true });
    expect(s.requests).toHaveLength(2);

    // After a success, a later failure holds back again, and lifts after the wait.
    s.advance(TITLE_TTL_MS);
    await s.titles.refresh(); // fails (no reply queued)
    await s.titles.refresh();
    expect(s.requests).toHaveLength(3);
    s.advance(RETRY_AFTER_FAILURE_MS);
    s.replies.push(issues(['FA-1', 'B']));
    expect((await s.titles.refresh()).titles['FA-1']?.title).toBe('B');
  });

  it(`asks for at most ${KEYS_PER_RUN} keys per run and stops at the first failed batch`, async () => {
    const keys = Array.from({ length: KEYS_PER_RUN + 5 }, (_, i) => `FA-${i + 1}`);
    const s = await setup(keys);
    s.replies.push((req) => {
      const asked = req.jql.match(/FA-\d+/g)!;
      return issues(...[...new Set(asked)].map((k): [string, string] => [k, `T ${k}`]));
    });
    s.replies.push({ ok: false, reason: 'failed' });
    const res = await s.titles.refresh();
    expect(s.requests).toHaveLength(2);
    expect(Object.keys(res.titles)).toHaveLength(KEYS_PER_RUN);
    expect(res.lastRun).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('skips strings that are not ticket keys and runs nothing when there are no keys', async () => {
    const s = await setup(['not a key', 'fa-1']);
    const res = await s.titles.refresh({ force: true });
    expect(s.requests).toHaveLength(0);
    expect(res).toEqual({ titles: {}, lastRun: null });
  });

  it('joins a background refresh already in flight instead of starting another', async () => {
    const s = await setup(['FA-1']);
    s.replies.push(issues(['FA-1', 'A']));
    await Promise.all([s.titles.refresh(), s.titles.refresh(), s.titles.refresh()]);
    expect(s.requests).toHaveLength(1);
  });

  it('stop: a refresh still listing its keys runs nothing, and later ones neither, forced or not', async () => {
    const s = await setup(['FA-1']);
    const pending = s.titles.refresh();
    s.titles.stop();
    await pending;
    await s.titles.refresh();
    await s.titles.refresh({ force: true });
    expect(s.requests).toEqual([]);
  });

  it('stop: an answer that arrives after stop is not cached and changes nothing', async () => {
    const s = await setup(['FA-1']);
    s.replies.push(() => {
      s.titles.stop();
      return issues(['FA-1', 'A']);
    });
    expect(await s.titles.refresh()).toEqual({ titles: {}, lastRun: null });
    expect(s.requests).toHaveLength(1);
    expect(s.state.jiraTitles()).toEqual({});
    expect(s.changed()).toBe(0);
  });
});
