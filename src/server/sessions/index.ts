import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import type { ApiEnv, ApiSession, SessionPatchBody } from '../../shared/api';
import {
  envDisplayName,
  isProd,
  parseEnvRef,
  type DetectedEnv,
  type HacEnv,
} from '../../shared/env';
import type { Session, Workspace } from '../../shared/session';
import type { SessionState } from '../../shared/state';
import type { Indexer } from '../indexer';
import { categoryOf } from '../indexer/derive';
import type { StateStore } from '../state';

export interface SessionServiceOptions {
  indexer: Indexer;
  state: StateStore;
  /** Checked before pruning: an unreadable root lists no sessions, which must not wipe state. */
  projectsRoot: string;
  /** Where a ticket session starts when the ticket has no session with a repo yet: the first
   * Work-kind workspace's root, absolute (ADR 0026, ADR 0061). */
  workRoot: string;
  /** Ids of the Work-kind workspaces, whose sessions can carry a ticket. */
  workIds: readonly Workspace[];
  /** hac's envs, read on each list. Defaults to none. */
  envs?: () => Promise<EnvContext>;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface EnvContext {
  envs: HacEnv[];
}

export interface SessionService {
  /** Re-indexes, then prunes state of sessions that are gone. Calls run one at a time. */
  rescan(): Promise<Session[]>;
  list(workspace: Workspace): Promise<ApiSession[]>;
  /** null when no live session has this id. */
  patch(id: string, body: SessionPatchBody): Promise<ApiSession | null>;
  /** The session to resume or delete; null when its transcript is gone. */
  resumable(id: string): Promise<Session | null>;
  /** Pre-assigns an id for a new session on `ticketKey` and records it in state as pending, so it
   * joins the ticket group even without a branch (ADR 0025). `cwd` is the repo of the ticket's
   * latest session, else the Work root (ADR 0026). */
  startTicketSession(ticketKey: string): Promise<{ id: string; cwd: string }>;
  /** Undoes startTicketSession when the terminal could not be opened. */
  forget(id: string): Promise<void>;
  /** Every env in hac's config, for Set environment. */
  envs(): Promise<ApiEnv[]>;
}

/** Fills in a missing project when exactly one project has an env of that name. */
export function toApiEnv(env: DetectedEnv, ctx: EnvContext): ApiEnv {
  const known = ctx.envs.filter(
    (e) => e.name === env.name && (env.project === null || e.project === env.project),
  );
  const project = env.project ?? (known.length === 1 ? known[0]!.project : null);
  const readOnly = known.length === 1 && known[0]!.readOnly;
  return {
    project,
    name: env.name,
    display: envDisplayName(env.name),
    prod: isProd({ name: env.name, readOnly }),
  };
}

/** Overrides from state win over detection: envOverride, then ticket, then categoryOverride. */
export function merge(session: Session, state: SessionState, ctx: EnvContext): ApiSession {
  const {
    status,
    bookmarked,
    categoryOverride,
    envOverride,
    releaseLabel,
    ticketOverride,
    restoredAt,
    title,
  } = state;
  const env = envOverride ? parseEnvRef(envOverride) : session.env;
  const ticketKey = ticketOverride ?? session.ticketKey;
  const detected = categoryOf(ticketKey, env);
  return {
    ...session,
    ticketKey,
    autoTicketKey: session.ticketKey,
    title: title ?? session.title,
    autoTitle: session.title,
    env: env && toApiEnv(env, ctx),
    autoEnv: session.env,
    category: categoryOverride ?? detected,
    autoCategory: detected,
    state: {
      status,
      bookmarked,
      ...(categoryOverride && { categoryOverride }),
      ...(envOverride && { envOverride }),
      ...(releaseLabel && { releaseLabel }),
      ...(ticketOverride && { ticketOverride }),
      ...(restoredAt && { restoredAt }),
      ...(title && { title }),
    },
  };
}

const NO_ENVS: EnvContext = { envs: [] };

export function createSessionService(opts: SessionServiceOptions): SessionService {
  const log = opts.log ?? ((m: string) => console.warn(`[sessions] ${m}`));
  const now = opts.now ?? (() => new Date());
  const envContext = opts.envs ?? (async () => NO_ENVS);
  let latest: Session[] = [];
  let tail: Promise<unknown> = Promise.resolve();

  async function scanOnce(): Promise<Session[]> {
    const sessions = await opts.indexer.index();
    latest = sessions;
    try {
      await access(opts.projectsRoot);
    } catch {
      log(`cannot read ${opts.projectsRoot}; skipping orphan pruning`);
      return sessions;
    }
    const removed = await opts.state.pruneOrphans(sessions.map((s) => s.id));
    if (removed.length) log(`pruned state of ${removed.length} missing session(s)`);
    // The most recent rename wins: a /rename since the dashboard rename replaces it (ADR 0056).
    const renamed = await opts.state.clearRenamedTitles(
      new Map(sessions.map((s) => [s.id, s.customTitle])),
    );
    if (renamed.length) log(`dropped ${renamed.length} dashboard title(s) renamed in Claude Code`);
    return sessions;
  }

  function rescan(): Promise<Session[]> {
    const run = tail.then(scanOnce);
    tail = run.catch(() => {});
    return run;
  }

  return {
    rescan,
    async list(workspace) {
      const [sessions, ctx] = await Promise.all([rescan(), envContext()]);
      return sessions
        .filter((s) => s.workspace === workspace)
        .map((s) => merge(s, opts.state.get(s.id), ctx));
    },
    async patch(id, body) {
      // A rename snapshots Claude Code's custom title, so it reads the file again first.
      let session = body.title ? undefined : latest.find((s) => s.id === id);
      if (!session) session = (await rescan()).find((s) => s.id === id);
      if (!session) return null;
      const { categoryOverride, envOverride, releaseLabel, ticketOverride, title, ...rest } = body;
      // null clears; the store clears an optional field on undefined.
      const clearable = { categoryOverride, envOverride, releaseLabel, ticketOverride };
      const next = await opts.state.update(id, {
        ...rest,
        ...Object.fromEntries(
          Object.entries(clearable)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, v ?? undefined]),
        ),
        ...(title !== undefined &&
          (title
            ? { title, titleSnapshot: session.customTitle }
            : { title: undefined, titleSnapshot: undefined })),
      });
      return merge(session, next, await envContext());
    },
    async resumable(id) {
      const session = latest.find((s) => s.id === id) ?? (await rescan()).find((s) => s.id === id);
      if (!session) return null;
      try {
        await access(session.filePath);
      } catch {
        return null;
      }
      return session;
    },
    async startTicketSession(ticketKey) {
      const latestRepo = (await rescan())
        .filter((s) => opts.workIds.includes(s.workspace) && s.repo)
        .filter((s) => (opts.state.get(s.id).ticketOverride ?? s.ticketKey) === ticketKey)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0]?.repo;
      const id = randomUUID();
      await opts.state.update(id, { ticketOverride: ticketKey, pendingSince: now().toISOString() });
      return { id, cwd: latestRepo ?? opts.workRoot };
    },
    forget(id) {
      return opts.state.remove(id);
    },
    async envs() {
      const ctx = await envContext();
      return ctx.envs.map((e) => toApiEnv(e, ctx));
    },
  };
}
