import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SessionId } from '../../shared/session';
import {
  STATE_VERSION,
  SessionState,
  SessionStatePatch,
  StateFile,
  JobDay,
  AutoArchiveRecord,
  JiraTitle,
  SyncState,
} from '../../shared/state';

/** Turns a file of version `n` into version `n + 1`. Input is unvalidated JSON. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version they upgrade from. None yet: version 1 is the first. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export interface StateStoreOptions {
  /** Defaults to ~/.claude-dashboard/state.json. */
  path?: string;
  /** Overrides MIGRATIONS (tests). */
  migrations?: Readonly<Record<number, Migration>>;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface StateStore {
  /** Stored state, or the defaults (todo, not bookmarked) when there is none. */
  get(id: string): SessionState;
  all(): Record<string, SessionState>;
  sync(): SyncState;
  /** Merges `patch` into the entry; throws on an invalid id or patch. */
  update(id: string, patch: SessionStatePatch): Promise<SessionState>;
  remove(id: string): Promise<void>;
  /** Throws on a value that does not match its schema. */
  setSync<K extends keyof SyncState>(key: K, value: SyncState[K]): Promise<void>;
  /** The local day a daily job last finished, if any (ADR 0031). */
  jobDay(name: string): JobDay | undefined;
  setJobDay(name: string, day: JobDay): Promise<void>;
  /** What the last auto-archive run moved (ADR 0037). */
  autoArchive(): AutoArchiveRecord | undefined;
  setAutoArchive(record: AutoArchiveRecord): Promise<void>;
  /** Cached Jira titles by ticket key (ADR 0039). */
  jiraTitles(): Record<string, JiraTitle>;
  /** Merges `entries` into the cache; keys not named keep their entry. */
  setJiraTitles(entries: Record<string, JiraTitle>): Promise<void>;
  /** Drops entries whose session is neither live, in the trash, nor pending for under 24 h, and
   * clears `pendingSince` on live ones (ADR 0025). Returns the removed ids. */
  pruneOrphans(liveIds: Iterable<string>): Promise<string[]>;
  /** Clears `title` and `titleSnapshot` on live entries whose Claude Code custom title (by id)
   * differs from the snapshot: it was renamed there since (ADR 0056). Returns the cleared ids. */
  clearRenamedTitles(customTitles: ReadonlyMap<string, string | null>): Promise<string[]>;
}

/** How long a pre-assigned id waits for its transcript before pruning may drop it. */
export const PENDING_GRACE_MS = 24 * 60 * 60 * 1000;

const empty = (): StateFile => ({
  version: STATE_VERSION,
  sessions: {},
  sync: {},
  jobs: {},
  jiraTitles: {},
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type Loaded = { ok: true; state: StateFile; migrated: boolean } | { ok: false; reason: string };

function decode(text: string, migrations: Readonly<Record<number, Migration>>): Loaded {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!isObject(raw)) return { ok: false, reason: 'not a JSON object' };

  let migrated = false;
  while (raw.version !== STATE_VERSION) {
    const from = raw.version;
    const step = typeof from === 'number' ? migrations[from] : undefined;
    if (!step) return { ok: false, reason: `unknown version ${JSON.stringify(from)}` };
    raw = step(raw);
    migrated = true;
    if (!isObject(raw) || raw.version === from) {
      return { ok: false, reason: `migration from version ${from} failed` };
    }
  }

  const parsed = StateFile.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'does not match the schema' };
  return { ok: true, state: parsed.data, migrated };
}

/** temp file + fsync + rename: readers see the old file or the new one, never half of one. */
async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Loads state.json once and keeps it in memory; this process is its only writer (ADR 0010).
 * Never throws: an unreadable, corrupt or unknown-version file is moved aside and the store
 * starts empty.
 */
export async function openStateStore(opts: StateStoreOptions = {}): Promise<StateStore> {
  const path = opts.path ?? join(homedir(), '.claude-dashboard', 'state.json');
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[state] ${m}`));

  let state = empty();
  let writeOnOpen = false;

  let text: string | null = null;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`cannot read ${path} (${(err as Error).message}); starting empty`);
    }
  }
  if (text !== null) {
    const loaded = decode(text, migrations);
    if (loaded.ok) {
      state = loaded.state;
      writeOnOpen = loaded.migrated;
    } else {
      const backup = `${path}.bak-${now().toISOString().replace(/[:.]/g, '-')}`;
      try {
        await rename(path, backup);
        log(`${path} ${loaded.reason}; moved to ${backup} and starting empty`);
      } catch (err) {
        log(`${path} ${loaded.reason}; backup failed (${(err as Error).message}); starting empty`);
      }
    }
  }

  // Each mutation runs after the previous one is on disk, against the state it left, so
  // concurrent calls never lose each other's changes. Memory changes only after a write succeeds.
  let tail: Promise<unknown> = Promise.resolve();
  function mutate<T>(
    fn: (draft: StateFile) => T,
    changed: (result: T) => boolean = () => true,
  ): Promise<T> {
    const run = tail.then(async () => {
      const draft = structuredClone(state);
      const result = fn(draft);
      if (!changed(result)) return result;
      await writeAtomic(path, JSON.stringify(draft, null, 2) + '\n');
      state = draft;
      return result;
    });
    tail = run.catch(() => {});
    return run;
  }

  if (writeOnOpen) {
    await mutate(() => {}).catch((err: Error) => log(`cannot save migrated state: ${err.message}`));
  }

  return {
    get(id) {
      const entry = state.sessions[id];
      return entry ? structuredClone(entry) : SessionState.parse({});
    },
    all() {
      return structuredClone(state.sessions);
    },
    sync() {
      return structuredClone(state.sync);
    },
    update(id, patch) {
      const sid = SessionId.parse(id);
      const changes = SessionStatePatch.parse(patch);
      return mutate((draft) => {
        const next = SessionState.parse({ ...draft.sessions[sid], ...changes });
        draft.sessions[sid] = next;
        return structuredClone(next);
      });
    },
    async remove(id) {
      const sid = SessionId.parse(id);
      await mutate(
        (draft) => delete draft.sessions[sid],
        () => sid in state.sessions,
      );
    },
    async setSync(key, value) {
      const valid = SyncState.shape[key].parse(value);
      await mutate((draft) => {
        draft.sync[key] = valid as never;
      });
    },
    jobDay(name) {
      return state.jobs[name];
    },
    async setJobDay(name, day) {
      const valid = JobDay.parse(day);
      await mutate((draft) => {
        draft.jobs[name] = valid;
      });
    },
    autoArchive() {
      return state.autoArchive && structuredClone(state.autoArchive);
    },
    async setAutoArchive(record) {
      const valid = AutoArchiveRecord.parse(record);
      await mutate((draft) => {
        draft.autoArchive = valid;
      });
    },
    jiraTitles() {
      return structuredClone(state.jiraTitles);
    },
    async setJiraTitles(entries) {
      const valid = StateFile.shape.jiraTitles.parse(entries);
      await mutate((draft) => {
        Object.assign(draft.jiraTitles, valid);
      });
    },
    async pruneOrphans(liveIds) {
      const live = new Set(liveIds);
      const cutoff = now().getTime() - PENDING_GRACE_MS;
      const { removed } = await mutate(
        (draft) => {
          const removed: string[] = [];
          let started = 0;
          for (const [id, entry] of Object.entries(draft.sessions)) {
            if (live.has(id)) {
              if (entry.pendingSince) {
                delete entry.pendingSince;
                started++;
              }
            } else if (
              !entry.trashed &&
              !(entry.pendingSince && Date.parse(entry.pendingSince) > cutoff)
            ) {
              delete draft.sessions[id];
              removed.push(id);
            }
          }
          return { removed, started };
        },
        (r) => r.removed.length > 0 || r.started > 0,
      );
      return removed;
    },
    clearRenamedTitles(customTitles) {
      return mutate(
        (draft) => {
          const cleared: string[] = [];
          for (const [id, entry] of Object.entries(draft.sessions)) {
            const current = customTitles.get(id);
            if (entry.title === undefined || current === undefined) continue;
            if (current === (entry.titleSnapshot ?? null)) continue;
            delete entry.title;
            delete entry.titleSnapshot;
            cleared.push(id);
          }
          return cleared;
        },
        (cleared) => cleared.length > 0,
      );
    },
  };
}
