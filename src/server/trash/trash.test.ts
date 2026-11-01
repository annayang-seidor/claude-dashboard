import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openStateStore } from '../state';
import { createTrash } from './index';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/projects', import.meta.url));
const FOLDER = '-Users-annayang-y-acme-shop';
// Has <id>/subagents and <id>/tool-results.
const WITH_FOLDER = '55e4d22f-af40-4a4d-a574-195e5c9a227a';
const NO_FOLDER = 'd4a1e24c-0df7-402e-bc9a-e61cf8aa9430';
const NO_FOLDER_DIR = '-private-tmp-cc-spike';
const STRAY = '77777777-7777-4777-8777-777777777777';
const DAY = 24 * 60 * 60 * 1000;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Lists every path under `dir`, relative, so a round trip can be compared byte for byte. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir, { recursive: true }) as string[]) {
    const p = join(dir, name);
    try {
      out[name] = readFileSync(p, 'utf8');
    } catch {
      out[name] = '<dir>';
    }
  }
  return out;
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'trash-test-'));
  tmpDirs.push(dir);
  const root = join(dir, 'projects');
  cpSync(FIXTURES, root, { recursive: true });
  const trashDir = join(dir, 'trash');
  let now = new Date('2026-10-24T10:00:00.000Z');
  const state = await openStateStore({ path: join(dir, 'state.json'), log: () => {} });
  const transcript = (id: string, folder = FOLDER) => join(root, folder, `${id}.jsonl`);
  const trash = createTrash({
    state,
    projectsRoot: root,
    trashDir,
    locate: async (id) => {
      const folder = id === NO_FOLDER ? NO_FOLDER_DIR : FOLDER;
      return existsSync(transcript(id, folder)) ? transcript(id, folder) : null;
    },
    now: () => now,
    log: () => {},
  });
  const advance = (ms: number) => (now = new Date(now.getTime() + ms));
  return { root, trashDir, state, trash, transcript, advance };
}

describe('trash and restore', () => {
  it('round trip moves the transcript and its <id>/ folder and back, keeping state', async () => {
    const s = await setup();
    const before = tree(s.root);
    await s.state.update(WITH_FOLDER, { status: 'done', bookmarked: true });

    expect(await s.trash.trash(WITH_FOLDER)).toEqual({ ok: true });
    expect(existsSync(s.transcript(WITH_FOLDER))).toBe(false);
    expect(existsSync(join(s.root, FOLDER, WITH_FOLDER))).toBe(false);
    expect(readdirSync(join(s.trashDir, WITH_FOLDER)).sort()).toEqual([
      'subagents',
      'tool-results',
    ]);
    expect(existsSync(join(s.trashDir, `${WITH_FOLDER}.jsonl`))).toBe(true);
    expect(s.state.get(WITH_FOLDER)).toEqual({
      status: 'done',
      bookmarked: true,
      trashed: {
        originalPath: s.transcript(WITH_FOLDER),
        hadFolder: true,
        trashedAt: '2026-10-24T10:00:00.000Z',
      },
    });

    expect(await s.trash.restore(WITH_FOLDER)).toEqual({ ok: true });
    expect(tree(s.root)).toEqual(before);
    expect(readdirSync(s.trashDir)).toEqual([]);
    // The restore restarts auto-archive's idle clock (ADR 0037).
    expect(s.state.get(WITH_FOLDER)).toEqual({
      status: 'done',
      bookmarked: true,
      restoredAt: '2026-10-24T10:00:00.000Z',
    });
  });

  it('records hadFolder: false for a transcript with no folder', async () => {
    const s = await setup();
    const before = tree(s.root);
    expect(await s.trash.trash(NO_FOLDER)).toEqual({ ok: true });
    expect(s.state.get(NO_FOLDER).trashed?.hadFolder).toBe(false);
    expect(readdirSync(s.trashDir)).toEqual([`${NO_FOLDER}.jsonl`]);
    expect(await s.trash.restore(NO_FOLDER)).toEqual({ ok: true });
    expect(tree(s.root)).toEqual(before);
  });

  it('trash: 404 for an id with no live transcript; 409 when the trash already has it', async () => {
    const s = await setup();
    expect(await s.trash.trash(STRAY)).toEqual({ ok: false, error: 'not-found' });
    mkdirSync(join(s.trashDir, WITH_FOLDER), { recursive: true });
    expect(await s.trash.trash(WITH_FOLDER)).toEqual({ ok: false, error: 'conflict' });
    expect(existsSync(s.transcript(WITH_FOLDER))).toBe(true);
    expect(s.state.get(WITH_FOLDER).trashed).toBeUndefined();
  });

  it('restore: 409 and nothing moves when the transcript or the folder is back in place', async () => {
    const s = await setup();
    await s.trash.trash(WITH_FOLDER);
    writeFileSync(s.transcript(WITH_FOLDER), 'new\n');
    expect(await s.trash.restore(WITH_FOLDER)).toEqual({ ok: false, error: 'conflict' });
    expect(readFileSync(s.transcript(WITH_FOLDER), 'utf8')).toBe('new\n');
    expect(existsSync(join(s.trashDir, `${WITH_FOLDER}.jsonl`))).toBe(true);

    rmSync(s.transcript(WITH_FOLDER));
    mkdirSync(join(s.root, FOLDER, WITH_FOLDER));
    expect(await s.trash.restore(WITH_FOLDER)).toEqual({ ok: false, error: 'conflict' });
    expect(existsSync(s.transcript(WITH_FOLDER))).toBe(false);
    expect(s.state.get(WITH_FOLDER).trashed).toBeDefined();
  });

  it('restore: 404 with no record, 410 when the trashed files are gone', async () => {
    const s = await setup();
    expect(await s.trash.restore(WITH_FOLDER)).toEqual({ ok: false, error: 'not-found' });
    await s.trash.trash(WITH_FOLDER);
    rmSync(join(s.trashDir, WITH_FOLDER), { recursive: true });
    expect(await s.trash.restore(WITH_FOLDER)).toEqual({ ok: false, error: 'gone' });
    expect(existsSync(s.transcript(WITH_FOLDER))).toBe(false);
  });

  it('restore refuses a record that points outside the projects root', async () => {
    const s = await setup();
    await s.trash.trash(NO_FOLDER);
    const trashed = s.state.get(NO_FOLDER).trashed!;
    const outside = join(s.root, '..', 'elsewhere', `${NO_FOLDER}.jsonl`);
    await s.state.update(NO_FOLDER, { trashed: { ...trashed, originalPath: outside } });
    expect(await s.trash.restore(NO_FOLDER)).toEqual({ ok: false, error: 'failed' });
    expect(existsSync(join(s.trashDir, `${NO_FOLDER}.jsonl`))).toBe(true);
  });
});

describe('purge', () => {
  it('deletes recorded entries older than 7 days with their state, keeps newer ones', async () => {
    const s = await setup();
    await s.trash.trash(WITH_FOLDER);
    s.advance(2 * DAY);
    await s.trash.trash(NO_FOLDER);

    s.advance(5 * DAY - 1000); // WITH_FOLDER: 7 days less a second
    expect(await s.trash.purge()).toEqual([]);

    s.advance(2000);
    expect(await s.trash.purge()).toEqual([WITH_FOLDER]);
    expect(readdirSync(s.trashDir)).toEqual([`${NO_FOLDER}.jsonl`]);
    expect(s.state.all()[WITH_FOLDER]).toBeUndefined();
    expect(s.state.get(NO_FOLDER).trashed).toBeDefined();
  });

  it('deletes stray <uuid>.jsonl and <uuid>/ entries by mtime, and nothing else', async () => {
    const s = await setup();
    mkdirSync(join(s.trashDir, STRAY, 'subagents'), { recursive: true });
    const old = (Date.parse('2026-10-24T10:00:00.000Z') - 8 * DAY) / 1000;
    const fresh = (Date.parse('2026-10-24T10:00:00.000Z') - 6 * DAY) / 1000;
    const other = '88888888-8888-4888-8888-888888888888';
    for (const [name, t] of [
      [`${STRAY}.jsonl`, old],
      [`${other}.jsonl`, fresh],
      ['notes.txt', old],
    ] as const) {
      writeFileSync(join(s.trashDir, name), 'x');
      utimesSync(join(s.trashDir, name), t, t);
    }
    utimesSync(join(s.trashDir, STRAY), old, old);

    expect(await s.trash.purge()).toEqual([STRAY]);
    expect(readdirSync(s.trashDir).sort()).toEqual([`${other}.jsonl`, 'notes.txt']);
  });

  it('judges a recorded entry by trashedAt, not by the old mtime of the moved file', async () => {
    const s = await setup();
    const old = (Date.parse('2026-10-24T10:00:00.000Z') - 30 * DAY) / 1000;
    utimesSync(s.transcript(NO_FOLDER, NO_FOLDER_DIR), old, old);
    await s.trash.trash(NO_FOLDER);
    expect(await s.trash.purge()).toEqual([]);
    expect(existsSync(join(s.trashDir, `${NO_FOLDER}.jsonl`))).toBe(true);
  });

  it('is fine when the trash folder does not exist yet', async () => {
    const s = await setup();
    expect(await s.trash.purge()).toEqual([]);
  });
});
