import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStateStore } from '../state';
import {
  KEYS_PER_RUN,
  RETRY_AFTER_FAILURE_MS,
  TITLE_TTL_MS,
  createJiraTitles,
  jiraTitlesPrompt,
} from './jiraTitles';
import type { RunRequest, RunResult, Runner } from './runner';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const START = new Date('2026-10-24T09:00:00.000Z');

type Reply = RunResult<unknown> | ((req: RunRequest<unknown>) => RunResult<unknown>);

async function setup(keys: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'jira-titles-test-'));
  tmpDirs.push(dir);
  const state = await openStateStore({ path: join(dir, 'state.json'), log: () => {} });
  let now = START;
  const replies: Reply[] = [];
  const requests: RunRequest<unknown>[] = [];
  const runner: Runner = {
    async run<T>(req: RunRequest<T>) {
      requests.push(req as RunRequest<unknown>);
      const reply = replies.shift() ?? { ok: false, reason: 'failed' };
      const result = typeof reply === 'function' ? reply(req as RunRequest<unknown>) : reply;
      if (!result.ok) return result;
      // Validate like the real runner does.
      const parsed = req.schema.safeParse(result.data);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, reason: 'invalid' as const };
    },
  };
  let changed = 0;
  const titles = createJiraTitles({
    runner,
    state,
    keys: async () => keys,
    onChanged: () => changed++,
    now: () => now,
  });
  return {
    state,
    titles,
    requests,
    replies,
    changed: () => changed,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const issues = (...list: [key: string, title: string, status?: string][]) => ({
  ok: true as const,
  data: { issues: list.map(([key, title, status = 'To Do']) => ({ key, title, status })) },
});

describe('jiraTitlesPrompt', () => {
  it('names every key and the read-only tools, and asks for bare JSON', () => {
    const p = jiraTitlesPrompt(['FA-1', 'ACME-642']);
    expect(p).toContain('key in (FA-1, ACME-642)');
    expect(p).toContain('searchJiraIssuesUsingJql');
    expect(p).toContain('{"authRequired":true}');
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
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]!.job).toBe('jira-titles');
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

  it('caches keys Jira has no issue for, and keys left out of the answer, as missing', async () => {
    const s = await setup(['FA-1', 'FA-404', 'FA-9']);
    s.replies.push({
      ok: true,
      data: { issues: [{ key: 'FA-1', title: 'A', status: 'Done' }], missing: ['FA-404'] },
    });
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

  it('keeps the cache when the answer fails its schema', async () => {
    const s = await setup(['FA-1']);
    s.replies.push(issues(['FA-1', 'Good title']));
    await s.titles.refresh();
    const before = s.state.jiraTitles();

    s.replies.push({ ok: true, data: { issues: [{ key: 'FA-1', title: 42 }] } });
    const res = await s.titles.refresh({ force: true });
    expect(res.lastRun).toMatchObject({ ok: false, reason: 'invalid' });
    expect(res.titles).toEqual({ 'FA-1': { title: 'Good title', status: 'To Do' } });
    expect(s.state.jiraTitles()).toEqual(before);
    expect(s.changed()).toBe(1);
  });

  it('keeps the cache and reports auth when the Rovo login is needed', async () => {
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
      const asked = req.prompt.match(/FA-\d+/g)!;
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
