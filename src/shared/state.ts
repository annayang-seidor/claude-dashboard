import { z } from 'zod';
import { Category, SessionId, TicketKey, Workspace } from './session';

export const STATE_VERSION = 1;

export const SessionStatus = z.enum(['todo', 'done']);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** Longest dashboard rename, in UTF-16 units like an input's maxLength (spec § Rename). */
export const SESSION_TITLE_MAX = 120;

/** A dashboard rename: trimmed, 1–120 characters. */
export const SessionTitle = z.string().trim().min(1).max(SESSION_TITLE_MAX);

/** Where a trashed transcript came from; set by delete, cleared by undo (ADR 0009). */
export const TrashRecord = z.object({
  originalPath: z.string(),
  /** The `<id>/` folder (subagents/, tool-results/) was moved with the transcript. */
  hadFolder: z.boolean(),
  trashedAt: z.iso.datetime(),
});
export type TrashRecord = z.infer<typeof TrashRecord>;

const sessionStateFields = {
  status: SessionStatus,
  bookmarked: z.boolean(),
  categoryOverride: Category.optional(),
  envOverride: z.string().optional(),
  releaseLabel: z.string().optional(),
  ticketOverride: z.string().optional(),
  /** Set when the dashboard pre-assigns an id for a new session; cleared once its transcript
   * appears. Pruning spares the entry for 24 h until then (ADR 0025). */
  pendingSince: z.iso.datetime().optional(),
  trashed: TrashRecord.optional(),
  /** Last restore from the trash; auto-archive counts idle time from it too (ADR 0037). */
  restoredAt: z.iso.datetime().optional(),
  /** Dashboard rename; shown instead of Claude Code's titles until the next /rename (ADR 0056). */
  title: SessionTitle.optional(),
  /** Claude Code's customTitle when `title` was saved; null when it had none. A rescan that
   * finds a different customTitle clears both. */
  titleSnapshot: z.string().nullable().optional(),
};

export const SessionState = z.object({
  ...sessionStateFields,
  status: SessionStatus.default('todo'),
  bookmarked: z.boolean().default(false),
});
export type SessionState = z.infer<typeof SessionState>;

/** Fields a caller may change; `undefined` clears an optional field. Built without defaults so a
 * patch never resets a field it does not name. */
export const SessionStatePatch = z.strictObject(sessionStateFields).partial();
export type SessionStatePatch = z.infer<typeof SessionStatePatch>;

/** Why a headless `claude -p` run gave no data (ADR 0039). `auth`: the Rovo login is needed;
 * `invalid`: the output failed its schema; `failed`: a non-zero exit or an error result. */
export const RunFailure = z.enum(['auth', 'timeout', 'invalid', 'failed']);
export type RunFailure = z.infer<typeof RunFailure>;

/** ISO 8601 with a zone (`Z` or `+08:00`), as Jira and the spec example write them. */
const IsoDate = z.iso.datetime({ offset: true });

/** One classified issue (spec § Jira sync job). `pr` items come from the GitHub job (T15). */
export const JiraInboxItem = z.object({
  key: TicketKey,
  title: z.string().max(500),
  status: z.string().max(100),
  /** Display name; empty when unassigned. */
  assignee: z.string().max(200),
  bucket: z.enum(['action', 'fyi']),
  kind: z.enum(['assigned', 'mention', 'pr']),
  reason: z.string().min(1).max(140),
  lastRelevantAt: IsoDate,
});
export type JiraInboxItem = z.infer<typeof JiraInboxItem>;

/** The jira-inbox answer and the last good result (ADR 0042). One item per key. */
export const JiraInboxResult = z.object({
  syncedAt: IsoDate,
  items: z
    .array(JiraInboxItem)
    .max(100)
    .refine((items) => new Set(items.map((i) => i.key)).size === items.length, {
      message: 'duplicate keys',
    }),
});
export type JiraInboxResult = z.infer<typeof JiraInboxResult>;

/** How the last jira-inbox run went; `detail` says why it failed, for prompt tuning. */
export const JiraSyncAttempt = z.object({
  at: z.iso.datetime(),
  ok: z.boolean(),
  reason: RunFailure.optional(),
  detail: z.string().max(300).optional(),
  promptVersion: z.number().int().positive().optional(),
});
export type JiraSyncAttempt = z.infer<typeof JiraSyncAttempt>;

/** `sync.jira`: the last good result, replaced only by a valid run, and the last attempt. */
export const JiraSync = z.object({
  result: JiraInboxResult.optional(),
  lastAttempt: JiraSyncAttempt.optional(),
});
export type JiraSync = z.infer<typeof JiraSync>;

/** Jira is defined by T13 (ADR 0042); GitHub stays opaque until T15 (ADR 0011). */
export const SyncState = z.object({
  jira: JiraSync.optional(),
  github: z.unknown().optional(),
});
export type SyncState = z.infer<typeof SyncState>;

/** Local calendar day (YYYY-MM-DD) a daily job last finished, keyed by job name (ADR 0031). */
export const JobDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type JobDay = z.infer<typeof JobDay>;

/** What the last auto-archive run moved, by workspace id, so the next page load can offer Undo
 * (ADR 0037). Replaced only by a run that moves something. Records written before workspaces
 * were configurable (`{ at, work, personal }`, ADR 0061) are read into the same shape. */
const AutoArchiveMoved = z.object({
  at: z.iso.datetime(),
  moved: z.record(Workspace, z.array(SessionId)),
});
export type AutoArchiveRecord = z.infer<typeof AutoArchiveMoved>;
export const AutoArchiveRecord: z.ZodType<AutoArchiveRecord, unknown> = z.union([
  AutoArchiveMoved,
  z
    .object({ at: z.iso.datetime(), work: z.array(SessionId), personal: z.array(SessionId) })
    .transform(({ at, work, personal }) => ({ at, moved: { work, personal } })),
]);

/** A cached Jira lookup (ADR 0039). `missing`: Jira had no such issue, or the run did not return
 * it; cached too, so the key is not asked for again within 24 h. */
export const JiraTitle = z.union([
  z.object({ title: z.string(), status: z.string(), fetchedAt: z.iso.datetime() }),
  z.object({ missing: z.literal(true), fetchedAt: z.iso.datetime() }),
]);
export type JiraTitle = z.infer<typeof JiraTitle>;

export const StateFile = z.object({
  version: z.literal(STATE_VERSION),
  sessions: z.record(SessionId, SessionState),
  sync: SyncState,
  /** Optional, so files written before it existed still load as version 1. */
  jobs: z.record(z.string(), JobDay).default({}),
  autoArchive: AutoArchiveRecord.optional(),
  /** Optional like `jobs`; kept apart from `sync.jira`, which T13's inbox owns (ADR 0039). */
  jiraTitles: z.record(TicketKey, JiraTitle).default({}),
});
export type StateFile = z.infer<typeof StateFile>;
