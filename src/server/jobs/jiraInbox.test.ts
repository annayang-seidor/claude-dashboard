import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JiraInboxItem } from '../../shared/state';
import { openStateStore } from '../state';
import {
  MENTION_DAYS,
  PROMPT_PATH,
  SYNC_INTERVAL_MS,
  createJiraInbox,
  inSyncWindow,
  parsePromptFile,
  renderPrompt,
  windowStart,
} from './jiraInbox';
import type { RunRequest, RunResult, Runner } from './runner';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Local times: the window is the user's working day. 2026-10-26 is a Monday.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const MONDAY_10 = at(26, 10);

const PROMPT = `---
version: 3
---
since {{since}} ({{changedMinutes}} min), mentions {{mentionDays}} d, now {{now}}, last {{lastSyncedAt}}`;

const item = (key: string, extra: Partial<JiraInboxItem> = {}): JiraInboxItem => ({
  key,
  title: `Title of ${key}`,
  status: 'To Do',
  assignee: 'Anna Yang',
  bucket: 'action',
  kind: 'assigned',
  reason: 'PM asked after your last comment',
  lastRelevantAt: '2026-10-26T09:40:00+08:00',
  ...extra,
});

type Reply = RunResult<unknown> | Promise<RunResult<unknown>>;

async function setup(opts: { now?: Date; prompt?: string; dir?: string } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'jira-inbox-test-'));
  if (!opts.dir) tmpDirs.push(dir);
  const state = await openStateStore({ path: join(dir, 'state.json'), log: () => {} });
  let now = opts.now ?? MONDAY_10;
  const replies: Reply[] = [];
  const requests: RunRequest<unknown>[] = [];
  const runner: Runner = {
    async run<T>(req: RunRequest<T>) {
      requests.push(req as RunRequest<unknown>);
      const result = await (replies.shift() ?? { ok: false, reason: 'failed' });
      if (!result.ok) return result;
      // Validate like the real runner does.
      const parsed = req.schema.safeParse(result.data);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, reason: 'invalid' as const, detail: parsed.error.issues[0]?.message };
    },
  };
  let changed = 0;
  const inbox = createJiraInbox({
    runner,
    state,
    readPrompt: async () => opts.prompt ?? PROMPT,
    onChanged: () => changed++,
    now: () => now,
    log: () => {},
  });
  return {
    dir,
    state,
    inbox,
    requests,
    replies,
    changed: () => changed,
    setNow: (d: Date) => (now = d),
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const answer = (...items: JiraInboxItem[]) => ({
  ok: true as const,
  data: { syncedAt: '2026-01-01T00:00:00Z', items },
});

describe('inSyncWindow', () => {
  it.each([
    ['Monday 09:00', at(26, 9), true],
    ['Monday 08:59', at(26, 8, 59), false],
    ['Wednesday 13:30', at(28, 13, 30), true],
    ['Friday 18:59', at(30, 18, 59), true],
    ['Friday 19:00', at(30, 19), false],
    ['Saturday 10:00', at(31, 10), false],
    ['Sunday 10:00', at(32, 10), false],
  ])('%s → %s', (_, d, expected) => {
    expect(inSyncWindow(d)).toBe(expected);
  });
});

describe('windowStart', () => {
  const now = MONDAY_10;
  it('is 2 days back with no earlier sync', () => {
    expect(windowStart(now)).toEqual(new Date(now.getTime() - 2 * DAY));
    expect(windowStart(now, new Date(now.getTime() - HOUR).toISOString())).toEqual(
      new Date(now.getTime() - 2 * DAY),
    );
  });

  it('reaches back to the last good sync when that is earlier: Monday covers Friday evening', () => {
    const friday = at(23, 18, 50);
    expect(windowStart(now, friday.toISOString())).toEqual(friday);
  });

  it('never reaches back more than 7 days', () => {
    const old = new Date(now.getTime() - 20 * DAY).toISOString();
    expect(windowStart(now, old)).toEqual(new Date(now.getTime() - 7 * DAY));
  });
});

describe('prompt file', () => {
  it('reads the version and strips the front matter', () => {
    expect(parsePromptFile(PROMPT)).toEqual({ version: 3, body: expect.stringMatching(/^since/) });
    expect(() => parsePromptFile('no front matter')).toThrow(/version/);
    expect(() => parsePromptFile('---\nauthor: me\n---\nhi')).toThrow(/version/);
  });

  it('fills slots and rejects unknown ones', () => {
    expect(renderPrompt('a {{x}} b {{x}}', { x: '1' })).toBe('a 1 b 1');
    expect(() => renderPrompt('{{typo}}', { x: '1' })).toThrow(/\{\{typo\}\}/);
  });

  it('the shipped prompt parses, uses only known slots and keeps the auth answer', async () => {
    const s = await setup({ prompt: readFileSync(PROMPT_PATH, 'utf8') });
    s.replies.push(answer());
    const res = await s.inbox.sync();
    expect(res.lastAttempt).toMatchObject({ ok: true });
    const prompt = s.requests[0]!.prompt;
    expect(prompt).not.toMatch(/\{\{|^---/);
    expect(prompt).toContain('{"authRequired":true}');
    expect(prompt).toContain('atlassianUserInfo');
    expect(prompt).toContain(`updated >= -${MENTION_DAYS}d`);
    expect(prompt).toContain(`updated >= -${2 * 24 * 60}m`);
  });
});

describe('jiraInbox sync', () => {
  it('stores a valid answer with the server clock as syncedAt and records the prompt version', async () => {
    const s = await setup();
    s.replies.push(answer(item('ACME-642'), item('FA-554', { bucket: 'fyi', kind: 'mention' })));
    const res = await s.inbox.sync();
    expect(res.result).toEqual({
      syncedAt: MONDAY_10.toISOString(),
      items: [item('ACME-642'), item('FA-554', { bucket: 'fyi', kind: 'mention' })],
    });
    expect(res.lastAttempt).toEqual({ at: MONDAY_10.toISOString(), ok: true, promptVersion: 3 });
    expect(s.requests[0]!.job).toBe('jira-inbox');
    expect(s.requests[0]!.prompt).toContain(`last none`);
    expect(s.changed()).toBe(1);
  });

  it('widens the next window back to the last good sync', async () => {
    const s = await setup({ now: at(23, 18, 30) }); // Friday evening
    s.replies.push(answer());
    await s.inbox.sync();
    s.setNow(MONDAY_10);
    s.replies.push(answer());
    await s.inbox.sync();
    const minutes = (MONDAY_10.getTime() - at(23, 18, 30).getTime()) / MINUTE;
    expect(s.requests[1]!.prompt).toContain(`(${minutes} min)`);
    expect(s.requests[1]!.prompt).toContain(`last ${at(23, 18, 30).toISOString()}`);
  });

  it.each([
    ['a bad reason', item('FA-1', { reason: 'x'.repeat(141) })],
    ['a bad key', item('fa-1')],
    ['a date without a zone', item('FA-1', { lastRelevantAt: '2026-10-26 09:40' })],
    ['an unknown bucket', { ...item('FA-1'), bucket: 'later' } as never],
  ])('keeps the last good result on invalid output: %s', async (_, bad) => {
    const s = await setup();
    s.replies.push(answer(item('ACME-642')));
    const good = (await s.inbox.sync()).result;

    s.advance(SYNC_INTERVAL_MS);
    s.replies.push(answer(item('FA-2'), bad));
    const res = await s.inbox.sync();
    expect(res.result).toEqual(good);
    expect(res.lastAttempt).toMatchObject({
      at: s.state.sync().jira!.lastAttempt!.at,
      ok: false,
      reason: 'invalid',
      detail: expect.any(String),
      promptVersion: 3,
    });
    expect(s.changed()).toBe(2);
  });

  it('rejects more than 100 items and duplicate keys', async () => {
    const s = await setup();
    const many = Array.from({ length: 101 }, (_, i) => item(`FA-${i + 1}`));
    s.replies.push(answer(...many), answer(item('FA-1'), item('FA-1')));
    expect((await s.inbox.sync()).lastAttempt).toMatchObject({ ok: false, reason: 'invalid' });
    expect((await s.inbox.sync()).lastAttempt).toMatchObject({
      ok: false,
      detail: 'duplicate keys',
    });
    expect(s.inbox.snapshot().result).toBeNull();
  });

  it('records a needed login and keeps the result', async () => {
    const s = await setup();
    s.replies.push(answer(item('ACME-642')), { ok: false, reason: 'auth' });
    await s.inbox.sync();
    const res = await s.inbox.sync();
    expect(res.lastAttempt).toMatchObject({ ok: false, reason: 'auth' });
    expect(res.result?.items).toHaveLength(1);
  });

  it('fails without running when the prompt file is broken', async () => {
    const s = await setup({ prompt: '---\nversion: 1\n---\n{{nope}}' });
    const res = await s.inbox.sync();
    expect(s.requests).toEqual([]);
    expect(res.lastAttempt).toMatchObject({ ok: false, reason: 'failed', detail: /nope/ });
  });

  it('joins a run already in flight', async () => {
    const s = await setup();
    let release!: (r: RunResult<unknown>) => void;
    s.replies.push(new Promise((r) => (release = r)));
    const a = s.inbox.sync();
    const b = s.inbox.sync();
    release(answer(item('FA-1')));
    expect(await a).toEqual(await b);
    expect(s.requests).toHaveLength(1);
  });

  it('stop: a sync still reading its prompt runs nothing; start() lets the next one run', async () => {
    const s = await setup();
    const pending = s.inbox.sync();
    s.inbox.stop();
    expect(await pending).toEqual({ result: null, lastAttempt: null });
    expect(s.requests).toEqual([]);
    expect(s.changed()).toBe(0);

    s.inbox.start(); // the first tick runs: inside the window, never synced
    await vi.waitFor(() => expect(s.requests).toHaveLength(1));
    s.inbox.stop();
  });

  it('stop: an answer that arrives after stop is not stored and changes nothing', async () => {
    const s = await setup();
    let release!: (r: RunResult<unknown>) => void;
    s.replies.push(new Promise((r) => (release = r)));
    const pending = s.inbox.sync();
    await vi.waitFor(() => expect(s.requests).toHaveLength(1));
    s.inbox.stop();
    release(answer(item('FA-1')));
    expect(await pending).toEqual({ result: null, lastAttempt: null });
    expect(s.state.sync().jira).toBeUndefined();
    expect(s.changed()).toBe(0);
  });

  it('keeps the result and the error across a restart', async () => {
    const s = await setup();
    s.replies.push(answer(item('FA-1')), { ok: false, reason: 'timeout' });
    await s.inbox.sync();
    await s.inbox.sync();
    const reopened = await setup({ dir: s.dir });
    expect(reopened.inbox.snapshot()).toMatchObject({
      result: { items: [item('FA-1')] },
      lastAttempt: { ok: false, reason: 'timeout' },
    });
  });
});

describe('jiraInbox schedule', () => {
  it('runs on the first tick inside the window, and not outside it', async () => {
    const s = await setup({ now: at(31, 10) }); // Saturday
    await s.inbox.tick();
    s.setNow(at(26, 8, 55)); // Monday before 09:00
    await s.inbox.tick();
    expect(s.requests).toHaveLength(0);

    s.setNow(at(26, 9, 0));
    s.replies.push(answer());
    await s.inbox.tick();
    expect(s.requests).toHaveLength(1);
  });

  it('skips while the cache is fresh and syncs again once it is 45 min old', async () => {
    const s = await setup();
    s.replies.push(answer(item('FA-1')), answer(item('FA-2')));
    await s.inbox.tick();
    s.advance(SYNC_INTERVAL_MS - MINUTE);
    await s.inbox.tick();
    expect(s.requests).toHaveLength(1);
    expect(s.inbox.snapshot().result?.items[0]?.key).toBe('FA-1');

    s.advance(MINUTE);
    await s.inbox.tick();
    expect(s.requests).toHaveLength(2);
    expect(s.inbox.snapshot().result?.items[0]?.key).toBe('FA-2');
  });

  it('a restart with a fresh cache does not run again', async () => {
    const s = await setup();
    s.replies.push(answer(item('FA-1')));
    await s.inbox.tick();
    const reopened = await setup({ dir: s.dir, now: new Date(MONDAY_10.getTime() + 10 * MINUTE) });
    await reopened.inbox.tick();
    expect(reopened.requests).toHaveLength(0);
    expect(reopened.inbox.snapshot().result?.items).toEqual([item('FA-1')]);
  });

  it('a failed run also waits 45 min before the next background try', async () => {
    const s = await setup();
    s.replies.push({ ok: false, reason: 'failed' });
    await s.inbox.tick();
    s.advance(10 * MINUTE);
    await s.inbox.tick();
    expect(s.requests).toHaveLength(1);
  });

  it('Sync on demand runs outside the window and with a fresh cache', async () => {
    const s = await setup({ now: at(31, 22) }); // Saturday night
    s.replies.push(answer(), answer(item('FA-1')));
    await s.inbox.sync();
    await s.inbox.sync();
    expect(s.requests).toHaveLength(2);
    expect(s.inbox.snapshot().result?.items).toHaveLength(1);
  });
});
