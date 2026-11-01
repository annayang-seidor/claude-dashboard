import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { TrashError } from '../../shared/api';
import { DEFAULT_CONFIG } from '../../shared/config';
import { SessionId } from '../../shared/session';
import type { StateStore } from '../state';

export interface TrashOptions {
  state: StateStore;
  /** ~/.claude/projects: restore only moves files back to `<root>/<folder>/<id>.jsonl`. */
  projectsRoot: string;
  /** ~/.claude-dashboard/trash. */
  trashDir: string;
  /** The live transcript of `id`, or null when there is none. */
  locate: (id: string) => Promise<string | null>;
  /** Days a trashed session is kept before purge; the config's `trash.retentionDays`. */
  retentionDays?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export type TrashOutcome = { ok: true } | { ok: false; error: TrashError };

export interface Trash {
  /** Moves the transcript, and its `<id>/` folder when there is one, into the trash. */
  trash(id: string): Promise<TrashOutcome>;
  /** Moves both back to where the trash record says they came from. */
  restore(id: string): Promise<TrashOutcome>;
  /** Deletes recorded entries trashed over `retentionDays` ago, and stray `<uuid>.jsonl` /
   * `<uuid>/` entries with no record whose mtime is that old (ADR 0027). Returns their ids. */
  purge(): Promise<string[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STRAY = /^([0-9a-f-]{36})(\.jsonl)?$/i;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Moves a set of paths in order; if one fails, the ones already moved go back. */
async function moveAll(moves: [from: string, to: string][]): Promise<void> {
  const done: [string, string][] = [];
  try {
    for (const [from, to] of moves) {
      await rename(from, to);
      done.push([from, to]);
    }
  } catch (err) {
    for (const [from, to] of done.reverse()) await rename(to, from).catch(() => {});
    throw err;
  }
}

/**
 * Delete is a move, never an unlink (spec § Delete). The trash record is written before the
 * files move and cleared after they move back, so a rescan in between never prunes the
 * session's status or bookmark (ADR 0009, ADR 0027). Calls run one at a time.
 */
export function createTrash(opts: TrashOptions): Trash {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[trash] ${m}`));

  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  }

  /** `<projectsRoot>/<one folder>/<id>.jsonl`, so a hand-edited record cannot aim elsewhere. */
  function isTranscriptPath(id: string, path: string): boolean {
    const parts = relative(opts.projectsRoot, path).split(sep);
    return parts.length === 2 && parts[0] !== '..' && parts[1] === `${id}.jsonl`;
  }

  async function trash(id: string): Promise<TrashOutcome> {
    const sid = SessionId.parse(id);
    const originalPath = await opts.locate(sid);
    if (!originalPath || !isTranscriptPath(sid, originalPath)) {
      return { ok: false, error: 'not-found' };
    }
    const file = join(opts.trashDir, `${sid}.jsonl`);
    const folder = join(opts.trashDir, sid);
    if ((await exists(file)) || (await exists(folder))) return { ok: false, error: 'conflict' };
    const originalFolder = join(dirname(originalPath), sid);
    const hadFolder = await isDir(originalFolder);

    await mkdir(opts.trashDir, { recursive: true });
    await opts.state.update(sid, {
      trashed: { originalPath, hadFolder, trashedAt: now().toISOString() },
    });
    try {
      await moveAll([
        [originalPath, file],
        ...(hadFolder ? [[originalFolder, folder] as [string, string]] : []),
      ]);
    } catch (err) {
      log(`cannot move ${sid} to the trash: ${(err as Error).message}`);
      await opts.state.update(sid, { trashed: undefined });
      return { ok: false, error: 'failed' };
    }
    return { ok: true };
  }

  async function restore(id: string): Promise<TrashOutcome> {
    const sid = SessionId.parse(id);
    const record = opts.state.all()[sid]?.trashed;
    if (!record) return { ok: false, error: 'not-found' };
    const { originalPath, hadFolder } = record;
    if (!isTranscriptPath(sid, originalPath)) {
      log(`trash record of ${sid} points outside ${opts.projectsRoot}; not restoring`);
      return { ok: false, error: 'failed' };
    }
    const file = join(opts.trashDir, `${sid}.jsonl`);
    const folder = join(opts.trashDir, sid);
    const originalFolder = join(dirname(originalPath), sid);
    if (!(await exists(file)) || (hadFolder && !(await isDir(folder)))) {
      return { ok: false, error: 'gone' };
    }
    // Never create folders inside ~/.claude: a vanished project folder means no restore.
    if (!(await isDir(dirname(originalPath)))) return { ok: false, error: 'gone' };
    if ((await exists(originalPath)) || (hadFolder && (await exists(originalFolder)))) {
      return { ok: false, error: 'conflict' };
    }
    try {
      await moveAll([
        [file, originalPath],
        ...(hadFolder ? [[folder, originalFolder] as [string, string]] : []),
      ]);
    } catch (err) {
      log(`cannot restore ${sid}: ${(err as Error).message}`);
      return { ok: false, error: 'failed' };
    }
    // Restoring is a sign the session is wanted: auto-archive's idle clock restarts (ADR 0037).
    await opts.state.update(sid, { trashed: undefined, restoredAt: now().toISOString() });
    return { ok: true };
  }

  async function purge(): Promise<string[]> {
    const days = opts.retentionDays ?? DEFAULT_CONFIG.trash.retentionDays;
    const cutoff = now().getTime() - days * DAY_MS;
    const records = opts.state.all();
    const purged = new Set<string>();

    for (const [id, entry] of Object.entries(records)) {
      if (!entry.trashed || Date.parse(entry.trashed.trashedAt) > cutoff) continue;
      await rm(join(opts.trashDir, `${id}.jsonl`), { force: true });
      await rm(join(opts.trashDir, id), { recursive: true, force: true });
      await opts.state.remove(id);
      purged.add(id);
    }

    let names: string[];
    try {
      names = await readdir(opts.trashDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log(`cannot read ${opts.trashDir}: ${(err as Error).message}`);
      }
      names = [];
    }
    for (const name of names) {
      const [, id, isJsonl] = STRAY.exec(name) ?? [];
      if (!id || !SessionId.safeParse(id).success || records[id]?.trashed) continue;
      const path = join(opts.trashDir, name);
      const stat = await lstat(path).catch(() => null);
      if (!stat || stat.mtimeMs > cutoff) continue;
      if (isJsonl ? !stat.isFile() : !stat.isDirectory()) continue;
      await rm(path, { recursive: true, force: true });
      purged.add(id);
    }

    if (purged.size) log(`purged ${purged.size} trashed session(s)`);
    return [...purged];
  }

  return {
    trash: (id) => serial(() => trash(id)),
    restore: (id) => serial(() => restore(id)),
    purge: () => serial(purge),
  };
}
