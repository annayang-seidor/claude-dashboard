import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexer } from '../indexer';
import { createSessionService } from '../sessions';
import { openStateStore } from '../state';
import { createTrash } from '../trash';
import { createAutoArchive } from './autoArchive';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/projects', import.meta.url));
const HOME = '/Users/annayang';
const TOYS = '-Users-annayang-y-acme-shop';

// Fixture sessions by workspace, category and last activity (UTC).
const WORK_SCRATCH_OLD = '55e4d22f-af40-4a4d-a574-195e5c9a227a'; // Oct 16, has an <id>/ folder
const WORK_SCRATCH_NEW = '506e8f56-0f29-42df-bb2d-509897b85cf3'; // Oct 23
const WORK_TICKET_OLD = 'da917231-5cde-47ba-b5ab-6904b3ceb8c4'; // Oct 7
const PERSONAL_OLD = '0328999a-b8be-4c87-bbd8-3ed22bf1a42d'; // Oct 3
const PERSONAL_NEW = 'd4a1e24c-0df7-402e-bc9a-e61cf8aa9430'; // Oct 23

// Local noon, so every fixture date is the same calendar distance away in any time zone.
const START = new Date(2026, 9, 25, 12, 0);
const DAY = 24 * 60 * 60 * 1000;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'auto-archive-test-'));
  tmpDirs.push(dir);
  const root = join(dir, 'projects');
  cpSync(FIXTURES, root, { recursive: true });
  let now = START;
  const clock = () => now;
  const state = await openStateStore({ path: join(dir, 'state.json'), log: () => {} });
  const sessions = createSessionService({
    indexer: createIndexer({ projectsRoot: root, home: HOME, findRepoRoot: () => null }),
    state,
    projectsRoot: root,
    workRoot: `${HOME}/y`,
    workIds: ['work'],
    log: () => {},
  });
  const trashDir = join(dir, 'trash');
  const trash = createTrash({
    state,
    projectsRoot: root,
    trashDir,
    locate: async (id) => (await sessions.resumable(id))?.filePath ?? null,
    now: clock,
    log: () => {},
  });
  const logPath = join(dir, 'activity.log');
  const onMoved = vi.fn();
  const log = vi.fn();
  const run = createAutoArchive({ sessions, trash, state, logPath, onMoved, now: clock, log });
  const logLines = () =>
    existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : [];
  const advance = (days: number) => (now = new Date(now.getTime() + days * DAY));
  return { root, trashDir, state, trash, run, logPath, logLines, onMoved, log, advance };
}

describe('auto-archive', () => {
  it('trashes Work Scratch idle over 7 days and Personal idle over 14, and nothing else', async () => {
    const s = await setup();
    const result = await s.run();

    expect(result).toEqual({
      moved: { work: [WORK_SCRATCH_OLD], personal: [PERSONAL_OLD] },
      failed: [],
    });
    // Both the transcript and its <id>/ folder went through the T8 trash.
    expect(existsSync(join(s.trashDir, `${WORK_SCRATCH_OLD}.jsonl`))).toBe(true);
    expect(existsSync(join(s.trashDir, WORK_SCRATCH_OLD, 'subagents'))).toBe(true);
    expect(existsSync(join(s.root, TOYS, `${WORK_SCRATCH_OLD}.jsonl`))).toBe(false);
    // Fresh Scratch, an old ticket (not Scratch) and fresh Personal stay; To do is not kept.
    for (const id of [WORK_SCRATCH_NEW, WORK_TICKET_OLD, PERSONAL_NEW]) {
      expect(s.state.get(id).trashed).toBeUndefined();
    }
    expect(s.state.autoArchive()).toEqual({
      at: START.toISOString(),
      moved: { work: [WORK_SCRATCH_OLD], personal: [PERSONAL_OLD] },
    });
    expect(s.onMoved).toHaveBeenCalledOnce();
  });

  it('logs what moved to activity.log as one owner-only JSON line per run', async () => {
    const s = await setup();
    await s.run();
    s.advance(1);
    await s.run();

    const [first, second] = s.logLines();
    expect(first).toEqual({
      at: START.toISOString(),
      job: 'auto-archive',
      moved: [
        { id: WORK_SCRATCH_OLD, workspace: 'work', title: expect.any(String) },
        { id: PERSONAL_OLD, workspace: 'personal', title: expect.any(String) },
      ],
      failed: [],
    });
    expect(second).toMatchObject({ job: 'auto-archive', moved: [], failed: [] });
    expect(statSync(s.logPath).mode & 0o777).toBe(0o600);
  });

  it('keeps bookmarked sessions, and records nothing when nothing moved', async () => {
    const s = await setup();
    await s.state.update(WORK_SCRATCH_OLD, { bookmarked: true });
    await s.state.update(PERSONAL_OLD, { bookmarked: true, status: 'done' });

    expect((await s.run()).moved).toEqual({ work: [], personal: [] });
    expect(s.state.autoArchive()).toBeUndefined();
    expect(s.onMoved).not.toHaveBeenCalled();
  });

  it('goes by the effective category: overrides win over detection', async () => {
    const s = await setup();
    await s.state.update(WORK_SCRATCH_OLD, { categoryOverride: 'ticket' });
    await s.state.update(WORK_TICKET_OLD, { categoryOverride: 'scratch' });

    expect((await s.run()).moved.work).toEqual([WORK_TICKET_OLD]);
  });

  it('is safe to repeat: a second run moves nothing and keeps the record for Undo', async () => {
    const s = await setup();
    await s.run();
    const record = s.state.autoArchive();
    s.onMoved.mockClear();

    expect((await s.run()).moved).toEqual({ work: [], personal: [] });
    expect(s.state.autoArchive()).toEqual(record);
    expect(s.onMoved).not.toHaveBeenCalled();
  });

  it('does not trash a restored session again until it is idle past the limit since restore', async () => {
    const s = await setup();
    await s.run();
    s.advance(1 / 24);
    expect(await s.trash.restore(WORK_SCRATCH_OLD)).toEqual({ ok: true });

    // Still idle over 7 days by last activity, but restored an hour after the run.
    s.advance(1);
    expect((await s.run()).moved.work).not.toContain(WORK_SCRATCH_OLD);
    s.advance(6);
    expect((await s.run()).moved.work).not.toContain(WORK_SCRATCH_OLD);
    // Restored on Oct 25; Nov 2 is the first day it is idle over 7 calendar days again.
    s.advance(1);
    expect((await s.run()).moved.work).toContain(WORK_SCRATCH_OLD);
  });

  it('reports a session the trash refused and still moves the rest', async () => {
    const s = await setup();
    // A file already in the way makes the trash answer conflict (ADR 0027).
    mkdirSync(s.trashDir, { recursive: true });
    writeFileSync(join(s.trashDir, `${WORK_SCRATCH_OLD}.jsonl`), '');

    const result = await s.run();
    expect(result.failed).toEqual([{ id: WORK_SCRATCH_OLD, error: 'conflict' }]);
    expect(result.moved).toEqual({ work: [], personal: [PERSONAL_OLD] });
    expect(s.logLines()[0]).toMatchObject({
      failed: [{ id: WORK_SCRATCH_OLD, error: 'conflict' }],
    });
    expect(s.log).toHaveBeenCalledWith('moved 1 session(s) to the trash, 1 failed');
  });

  it('finishes the run when activity.log cannot be written', async () => {
    const s = await setup();
    // A folder where the log file should be makes appendFile fail.
    mkdirSync(s.logPath);

    expect((await s.run()).moved.personal).toEqual([PERSONAL_OLD]);
    expect(s.log).toHaveBeenCalledWith(expect.stringMatching(/^cannot write .*activity\.log/));
  });
});
