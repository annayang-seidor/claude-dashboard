import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PENDING_GRACE_MS, openStateStore, type StateStoreOptions } from './index';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-24T03:04:05.678Z');
const BACKUP = 'state.json.bak-2026-10-24T03-04-05-678Z';

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'state-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(contents?: string) {
  const dir = tmp();
  const path = join(dir, 'state.json');
  if (contents !== undefined) writeFileSync(path, contents);
  const logs: string[] = [];
  const open = (extra: Partial<StateStoreOptions> = {}) =>
    openStateStore({ path, now: () => NOW, log: (m) => logs.push(m), ...extra });
  const onDisk = () => JSON.parse(readFileSync(path, 'utf8'));
  return { dir, path, logs, open, onDisk };
}

const trashed = {
  originalPath: `/Users/x/.claude/projects/-Users-x-o-repo/${B}.jsonl`,
  hadFolder: true,
  trashedAt: '2026-10-23T00:00:00.000Z',
};

describe('state store', () => {
  it('reads an auto-archive record from before configurable workspaces into the new shape', async () => {
    const at = '2026-10-23T00:00:00.000Z';
    const { open } = setup(
      JSON.stringify({
        version: 1,
        sessions: {},
        sync: {},
        autoArchive: { at, work: [A], personal: [B] },
      }),
    );
    const store = await open();
    expect(store.autoArchive()).toEqual({ at, moved: { work: [A], personal: [B] } });
  });

  it('starts empty without creating a file and returns defaults', async () => {
    const { dir, open } = setup();
    const store = await open();
    expect(store.get(A)).toEqual({ status: 'todo', bookmarked: false });
    expect(store.all()).toEqual({});
    expect(readdirSync(dir)).toEqual([]);
  });

  it('persists updates as a versioned file and reloads them', async () => {
    const { open, onDisk } = setup();
    const store = await open();
    await store.update(A, { status: 'done' });
    await store.update(A, { bookmarked: true, categoryOverride: 'ops', envOverride: 'S1' });
    await store.setSync('jira', { result: { syncedAt: '2026-10-24T00:00:00Z', items: [] } });

    expect(onDisk()).toEqual({
      version: 1,
      sessions: {
        [A]: { status: 'done', bookmarked: true, categoryOverride: 'ops', envOverride: 'S1' },
      },
      sync: { jira: { result: { syncedAt: '2026-10-24T00:00:00Z', items: [] } } },
      jobs: {},
      jiraTitles: {},
    });
    const reopened = await open();
    expect(reopened.get(A)).toEqual(store.get(A));
    expect(reopened.sync()).toEqual(store.sync());
  });

  it('applies defaults to the fields a first patch leaves out, and never resets them later', async () => {
    const { open } = setup();
    const store = await open();
    expect(await store.update(A, { bookmarked: true })).toEqual({
      status: 'todo',
      bookmarked: true,
    });
    await store.update(A, { status: 'done' });
    expect(await store.update(A, { bookmarked: false })).toEqual({
      status: 'done',
      bookmarked: false,
    });
  });

  it('clears an optional field patched to undefined', async () => {
    const { open, onDisk } = setup();
    const store = await open();
    await store.update(A, { ticketOverride: 'FA-554' });
    await store.update(A, { ticketOverride: undefined });
    expect(onDisk().sessions[A]).toEqual({ status: 'todo', bookmarked: false });
  });

  it('rejects a non-UUID id, an invalid value and an unknown field without writing', async () => {
    const { dir, open } = setup();
    const store = await open();
    expect(() => store.update('../../etc/passwd', { status: 'done' })).toThrow();
    expect(() => store.update(A, { status: 'maybe' as 'done' })).toThrow();
    expect(() => store.update(A, { colour: 'red' } as object)).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  describe('daily job days (ADR 0031)', () => {
    it('loads a version-1 file written before jobs existed', async () => {
      const { open } = setup(JSON.stringify({ version: 1, sessions: { [A]: {} }, sync: {} }));
      const store = await open();
      expect(store.get(A).status).toBe('todo');
      expect(store.jobDay('trash-purge')).toBeUndefined();
    });

    it('records the day per job and reloads it', async () => {
      const { open, onDisk } = setup();
      const store = await open();
      await store.setJobDay('trash-purge', '2026-10-24');
      expect(store.jobDay('trash-purge')).toBe('2026-10-24');
      expect(store.jobDay('scratch-archive')).toBeUndefined();
      expect(onDisk().jobs).toEqual({ 'trash-purge': '2026-10-24' });
      expect((await open()).jobDay('trash-purge')).toBe('2026-10-24');
    });

    it('rejects a day that is not YYYY-MM-DD', async () => {
      const { open } = setup();
      const store = await open();
      await expect(store.setJobDay('trash-purge', '2026-10-24T08:00:00Z')).rejects.toThrow();
    });
  });

  describe('concurrency', () => {
    it('loses no update when many calls run at once', async () => {
      const { dir, open, onDisk } = setup();
      const store = await open();
      const ids = Array.from({ length: 50 }, () => crypto.randomUUID());
      await Promise.all([
        ...ids.map((id) => store.update(id, { status: 'done' })),
        // Interleaved patches to one id that each touch a different field.
        store.update(A, { status: 'done' }),
        store.update(A, { bookmarked: true }),
        store.update(A, { envOverride: 'P1' }),
        store.update(A, { releaseLabel: '2026.10' }),
        store.setSync('github', { prs: 3 }),
      ]);

      const disk = onDisk();
      expect(Object.keys(disk.sessions)).toHaveLength(51);
      for (const id of ids) expect(disk.sessions[id].status).toBe('done');
      expect(disk.sessions[A]).toEqual({
        status: 'done',
        bookmarked: true,
        envOverride: 'P1',
        releaseLabel: '2026.10',
      });
      expect(disk.sync).toEqual({ github: { prs: 3 } });
      expect((await open()).all()).toEqual(disk.sessions);
      // Every temp file was renamed into place.
      expect(readdirSync(dir)).toEqual(['state.json']);
    });

    it('keeps memory unchanged when a write fails, and later calls still run', async () => {
      const dir = tmp();
      writeFileSync(join(dir, 'not-a-dir'), '');
      const logs: string[] = [];
      // The parent is a file, so every read and write fails.
      const store = await openStateStore({
        path: join(dir, 'not-a-dir', 'state.json'),
        log: (m) => logs.push(m),
      });
      expect(logs[0]).toMatch(/cannot read/);

      const results = await Promise.allSettled([
        store.update(A, { status: 'done' }),
        store.update(B, { status: 'done' }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      expect(store.get(A)).toEqual({ status: 'todo', bookmarked: false });
      expect(store.all()).toEqual({});
    });
  });

  describe('bad file on disk', () => {
    it.each([
      ['corrupt JSON', '{"version": 1, "sessions": {', /not valid JSON/],
      ['a non-object', '[1, 2, 3]', /not a JSON object/],
      ['an unknown version', JSON.stringify({ version: 99, sessions: {}, sync: {} }), /99/],
      ['a missing version', JSON.stringify({ sessions: {}, sync: {} }), /unknown version/],
      [
        'a schema mismatch',
        JSON.stringify({ version: 1, sessions: { [A]: { status: 'maybe' } }, sync: {} }),
        /schema/,
      ],
      [
        'a non-UUID session key',
        JSON.stringify({ version: 1, sessions: { 'not-a-uuid': {} }, sync: {} }),
        /schema/,
      ],
    ])('backs up %s and starts empty', async (_, contents, reason) => {
      const { dir, path, logs, open } = setup(contents);
      const store = await open();

      expect(store.all()).toEqual({});
      expect(readdirSync(dir)).toEqual([BACKUP]);
      expect(readFileSync(join(dir, BACKUP), 'utf8')).toBe(contents);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(reason);
      expect(logs[0]).toContain(BACKUP);

      await store.update(A, { bookmarked: true });
      expect(readdirSync(dir).sort()).toEqual(['state.json', BACKUP]);
      expect(JSON.parse(readFileSync(path, 'utf8')).sessions[A].bookmarked).toBe(true);
    });

    it('fills defaults for fields missing from a stored entry', async () => {
      const { open } = setup(JSON.stringify({ version: 1, sessions: { [A]: {} }, sync: {} }));
      expect((await open()).get(A)).toEqual({ status: 'todo', bookmarked: false });
    });
  });

  describe('migrations', () => {
    const v0 = JSON.stringify({ version: 0, done: [A], sync: {} });
    const from0 = (raw: Record<string, unknown>) => ({
      version: 1,
      sessions: Object.fromEntries(
        (raw.done as string[]).map((id) => [id, { status: 'done', bookmarked: false }]),
      ),
      sync: raw.sync,
    });

    it('upgrades an old version, saves it and keeps no backup', async () => {
      const { dir, open, onDisk } = setup(v0);
      const store = await open({ migrations: { 0: from0 } });
      expect(store.get(A).status).toBe('done');
      expect(onDisk()).toEqual({
        version: 1,
        sessions: { [A]: { status: 'done', bookmarked: false } },
        sync: {},
        jobs: {},
        jiraTitles: {},
      });
      expect(readdirSync(dir)).toEqual(['state.json']);
    });

    it('backs up an old version that has no migration', async () => {
      const { dir, open } = setup(v0);
      const store = await open({ migrations: {} });
      expect(store.all()).toEqual({});
      expect(readdirSync(dir)).toEqual([BACKUP]);
    });

    it('backs up when a migration output fails the schema or does not advance', async () => {
      const bad = setup(v0);
      await bad.open({ migrations: { 0: () => ({ version: 1, sessions: 'x' }) } });
      expect(readdirSync(bad.dir)).toEqual([BACKUP]);

      const stuck = setup(v0);
      await stuck.open({ migrations: { 0: (raw) => raw } });
      expect(stuck.logs[0]).toMatch(/migration from version 0 failed/);
      expect(readdirSync(stuck.dir)).toEqual([BACKUP]);
    });
  });

  describe('pruneOrphans', () => {
    it('drops entries with no live session but keeps trashed ones', async () => {
      const { open, onDisk } = setup();
      const store = await open();
      await store.update(A, { bookmarked: true });
      await store.update(B, { status: 'done', trashed });
      await store.update(C, { status: 'done' });

      expect(await store.pruneOrphans([A])).toEqual([C]);
      expect(Object.keys(onDisk().sessions).sort()).toEqual([A, B]);
      expect(store.get(B).trashed).toEqual(trashed);
    });

    it('drops a restored entry once it is neither live nor trashed', async () => {
      const { open } = setup();
      const store = await open();
      await store.update(B, { trashed });
      expect(await store.pruneOrphans([])).toEqual([]);
      await store.update(B, { trashed: undefined }); // undo
      expect(await store.pruneOrphans([])).toEqual([B]);
    });

    it('keeps a pending entry for 24 h, then drops it', async () => {
      const { open } = setup();
      const store = await open();
      const since = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
      await store.update(A, {
        ticketOverride: 'FA-1',
        pendingSince: since(PENDING_GRACE_MS - 1000),
      });
      await store.update(B, {
        ticketOverride: 'FA-1',
        pendingSince: since(PENDING_GRACE_MS + 1000),
      });
      expect(await store.pruneOrphans([])).toEqual([B]);
      expect(store.get(A).ticketOverride).toBe('FA-1');
    });

    it('clears pendingSince once the session is live, so normal pruning applies again', async () => {
      const { open, onDisk } = setup();
      const store = await open();
      await store.update(A, { ticketOverride: 'FA-1', pendingSince: NOW.toISOString() });
      expect(await store.pruneOrphans([A])).toEqual([]);
      expect(onDisk().sessions[A]).toEqual({
        status: 'todo',
        bookmarked: false,
        ticketOverride: 'FA-1',
      });
      expect(await store.pruneOrphans([])).toEqual([A]);
    });

    it('does not write when nothing is removed', async () => {
      const { dir, open } = setup();
      const store = await open();
      expect(await store.pruneOrphans([A])).toEqual([]);
      expect(readdirSync(dir)).toEqual([]);
    });
  });

  describe('dashboard titles (ADR 0056)', () => {
    it('trims a title, rejects an empty or 121-character one, and loads a file without titles', async () => {
      const { open, onDisk } = setup(
        JSON.stringify({ version: 1, sessions: { [A]: { status: 'done' } }, sync: {} }),
      );
      const store = await open();
      expect(store.get(A)).toEqual({ status: 'done', bookmarked: false });
      await store.update(A, { title: '  Fix login  ', titleSnapshot: null });
      expect(onDisk().sessions[A]).toEqual({
        status: 'done',
        bookmarked: false,
        title: 'Fix login',
        titleSnapshot: null,
      });
      expect(() => store.update(A, { title: '   ' })).toThrow();
      expect(() => store.update(A, { title: 'x'.repeat(121) })).toThrow();
      await store.update(A, { title: 'x'.repeat(120) });
      expect(store.get(A).title).toHaveLength(120);
    });

    it('clears title and snapshot only where the live custom title differs from the snapshot', async () => {
      const { open, onDisk } = setup();
      const store = await open();
      await store.update(A, { title: 'mine', titleSnapshot: null });
      await store.update(B, { title: 'mine too', titleSnapshot: 'old' });
      await store.update(C, { status: 'done' });

      const same = new Map([
        [A, null],
        [B, 'old'],
        [C, 'any'],
      ]);
      expect(await store.clearRenamedTitles(same)).toEqual([]);

      // A was renamed in Claude Code; B is not live, so it is left alone.
      expect(await store.clearRenamedTitles(new Map([[A, 'from claude']]))).toEqual([A]);
      expect(onDisk().sessions).toEqual({
        [A]: { status: 'todo', bookmarked: false },
        [B]: { status: 'todo', bookmarked: false, title: 'mine too', titleSnapshot: 'old' },
        [C]: { status: 'done', bookmarked: false },
      });
      expect(await store.clearRenamedTitles(new Map([[B, null]]))).toEqual([B]);
    });

    it('does not write when nothing is cleared', async () => {
      const { dir, open } = setup();
      const store = await open();
      expect(await store.clearRenamedTitles(new Map([[A, 'x']]))).toEqual([]);
      expect(readdirSync(dir)).toEqual([]);
    });
  });

  it('merges Jira titles into the cache and rejects a key that is not a ticket key', async () => {
    const at = '2026-10-24T09:00:00.000Z';
    const { open } = setup();
    const store = await open();
    await store.setJiraTitles({ 'FA-1': { title: 'A', status: 'Done', fetchedAt: at } });
    await store.setJiraTitles({ 'FA-2': { missing: true, fetchedAt: at } });
    expect(store.jiraTitles()).toEqual({
      'FA-1': { title: 'A', status: 'Done', fetchedAt: at },
      'FA-2': { missing: true, fetchedAt: at },
    });
    await expect(
      store.setJiraTitles({ 'not a key': { missing: true, fetchedAt: at } }),
    ).rejects.toThrow();
    expect((await open()).jiraTitles()).toEqual(store.jiraTitles());
  });

  it('remove deletes an entry (trash purge)', async () => {
    const { open, onDisk } = setup();
    const store = await open();
    await store.update(B, { trashed });
    await store.remove(B);
    await store.remove(C); // absent: no-op
    expect(onDisk().sessions).toEqual({});
  });

  it('hands out copies, so callers cannot change stored state', async () => {
    const { open } = setup();
    const store = await open();
    await store.update(A, { status: 'done' });
    store.get(A).status = 'todo';
    store.all()[A]!.bookmarked = true;
    expect(store.get(A)).toEqual({ status: 'done', bookmarked: false });
  });
});
