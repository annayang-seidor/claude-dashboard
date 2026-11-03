import { z } from 'zod';
import { BULK_MAX_IDS, JiraBaseUrl, PageConfig } from './config';
import { DetectedEnv, EnvRef } from './env';
import { Category, Session, SessionId, TicketKey, Workspace } from './session';
import {
  AutoArchiveRecord,
  JiraInboxResult,
  JiraSyncAttempt,
  RunFailure,
  SESSION_TITLE_MAX,
  SessionStatus,
  SessionTitle,
} from './state';

export const HealthResponse = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;

/** POST /api/token/refresh: the current token, for a tab holding the previous one (ADR 0048). */
export const TokenRefreshResponse = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponse>;

/** Error body of every 4xx and 5xx the server sends. */
export const ErrorResponse = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const SessionsQuery = z.object({ workspace: Workspace });
export type SessionsQuery = z.infer<typeof SessionsQuery>;

/** The user-editable part of a session's state, as the list shows it. */
export const ApiSessionState = z.object({
  status: SessionStatus,
  bookmarked: z.boolean(),
  categoryOverride: Category.optional(),
  envOverride: EnvRef.optional(),
  releaseLabel: z.string().optional(),
  /** Set from Change ticket or New session for this ticket; wins over the branch's key. */
  ticketOverride: TicketKey.optional(),
  /** Last restore from the trash; auto-archive's countdown starts again from it (ADR 0037). */
  restoredAt: z.iso.datetime().optional(),
  /** The dashboard rename, when one is in force (ADR 0056). */
  title: SessionTitle.optional(),
});
export type ApiSessionState = z.infer<typeof ApiSessionState>;

/** An env as the UI shows it: `display` is the tag text, `prod` styles it. */
export const ApiEnv = DetectedEnv.extend({ display: z.string(), prod: z.boolean() });
export type ApiEnv = z.infer<typeof ApiEnv>;

/** GET /api/envs: every env in hac's config, for Set environment. */
export const EnvsResponse = z.object({ envs: z.array(ApiEnv) });
export type EnvsResponse = z.infer<typeof EnvsResponse>;

/** Ops group title set from the row menu. */
export const ReleaseLabel = z.string().trim().min(1).max(80);

/** A session merged with its state (ADR 0014). `category` and `env` are the ones to show. */
export const ApiSession = Session.extend({
  /** envOverride, else the detected env. */
  env: ApiEnv.nullable(),
  /** What the indexer detected, before any override. */
  autoEnv: DetectedEnv.nullable(),
  autoCategory: Category,
  /** The key detected from the branch, before ticketOverride. */
  autoTicketKey: z.string().nullable(),
  /** The dashboard rename, else `autoTitle`. */
  title: z.string(),
  /** Claude Code's title: custom → ai → summary → first prompt; what clearing a rename restores. */
  autoTitle: z.string(),
  state: ApiSessionState,
});
export type ApiSession = z.infer<typeof ApiSession>;

export const SessionsResponse = z.object({ sessions: z.array(ApiSession) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

/** PATCH /api/sessions/:id body. `null` clears an override or the release label; `title` is
 * trimmed, and `null` or an empty string clears the rename. */
export const SessionPatchBody = z
  .strictObject({
    status: SessionStatus.optional(),
    bookmarked: z.boolean().optional(),
    categoryOverride: Category.nullable().optional(),
    envOverride: EnvRef.nullable().optional(),
    releaseLabel: ReleaseLabel.nullable().optional(),
    ticketOverride: TicketKey.nullable().optional(),
    title: z.string().trim().max(SESSION_TITLE_MAX).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'empty patch' });
export type SessionPatchBody = z.infer<typeof SessionPatchBody>;

/** POST /api/sessions/:id/resume: the terminal was asked to open. */
export const ResumeResponse = z.object({ ok: z.literal(true) });
export type ResumeResponse = z.infer<typeof ResumeResponse>;

/** No control characters or line separators: the launcher types the name into the terminal with
 * iTerm2's `write text`, where a newline would run whatever follows it. */
export const NO_CONTROL_CHARS = /^[^\p{Cc}\u2028\u2029]*$/u;

/** POST /api/tickets/:key/new-session body, optional. `name` becomes `claude --name`, Claude
 * Code's custom title. Checked for control characters before trimming, so a trailing newline is
 * rejected rather than trimmed away. */
export const NewSessionBody = z.strictObject({
  name: z.string().regex(NO_CONTROL_CHARS).trim().min(1).max(SESSION_TITLE_MAX).optional(),
});
export type NewSessionBody = z.infer<typeof NewSessionBody>;

/** POST /api/tickets/:key/new-session: the id pre-assigned with `claude --session-id`. */
export const NewSessionResponse = z.object({ sessionId: SessionId });
export type NewSessionResponse = z.infer<typeof NewSessionResponse>;

/** Why a trash or restore of one id did not happen. HTTP status on the single-id routes:
 * not-found 404, conflict 409, gone 410, failed 500. */
export const TrashError = z.enum(['not-found', 'conflict', 'gone', 'failed']);
export type TrashError = z.infer<typeof TrashError>;

/** POST /api/sessions/:id/trash and /restore. */
export const TrashResponse = z.object({ ok: z.literal(true) });
export type TrashResponse = z.infer<typeof TrashResponse>;

/** POST /api/sessions/trash and /api/sessions/restore body. */
export const BulkIdsBody = z.strictObject({
  ids: z.array(SessionId).min(1).max(BULK_MAX_IDS),
});
export type BulkIdsBody = z.infer<typeof BulkIdsBody>;

/** One result per requested id, in request order; the others still run when one fails. */
export const BulkTrashResponse = z.object({
  results: z.array(z.object({ id: SessionId, ok: z.boolean(), error: TrashError.optional() })),
});
export type BulkTrashResponse = z.infer<typeof BulkTrashResponse>;

/** POST /api/trash/purge: the ids whose trashed files were deleted. */
export const PurgeResponse = z.object({ purged: z.array(SessionId) });
export type PurgeResponse = z.infer<typeof PurgeResponse>;

/** GET /api/retention: Claude Code's cleanupPeriodDays; null when 0 turns its cleanup off. */
export const RetentionResponse = z.object({
  cleanupPeriodDays: z.number().int().positive().nullable(),
});
export type RetentionResponse = z.infer<typeof RetentionResponse>;

/** GET /api/auto-archive: what the last run moved, by workspace id, that is still in the trash;
 * null before the first run that moved anything (ADR 0037). */
export const AutoArchiveResponse = z.object({ last: AutoArchiveRecord.nullable() });
export type AutoArchiveResponse = z.infer<typeof AutoArchiveResponse>;

export { RunFailure } from './state';

/** GET /api/config: the part of the config the page needs, read once at server start (ADR 0061). */
export const ConfigResponse = PageConfig;
export type ConfigResponse = z.infer<typeof ConfigResponse>;

/** GET /api/jira/titles and POST /api/jira/titles/refresh: every cached title, plus how the
 * last run went. A failed run leaves the cache as it was. */
export const JiraTitlesResponse = z.object({
  titles: z.record(TicketKey, z.object({ title: z.string(), status: z.string() })),
  lastRun: z
    .object({ at: z.iso.datetime(), ok: z.boolean(), reason: RunFailure.optional() })
    .nullable(),
});
export type JiraTitlesResponse = z.infer<typeof JiraTitlesResponse>;

/** GET /api/jira/inbox and POST /api/jira/inbox/sync: the last good result (null before the
 * first valid run) and how the last run went (ADR 0042). A failed run keeps the result.
 * `jiraBaseUrl` is config.json's, read on each call; null when unset (ADR 0044). */
export const JiraInboxResponse = z.object({
  result: JiraInboxResult.nullable(),
  lastAttempt: JiraSyncAttempt.nullable(),
  jiraBaseUrl: JiraBaseUrl.nullable(),
});
export type JiraInboxResponse = z.infer<typeof JiraInboxResponse>;

/** GET /api/jira/oauth/status (ADR 0062). `configured`: the repo's .env names an Atlassian app.
 * `site`: the Jira site the stored login is for. Tokens never leave the server. */
export const JiraOAuthStatusResponse = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  site: z.string().nullable(),
});
export type JiraOAuthStatusResponse = z.infer<typeof JiraOAuthStatusResponse>;

/** POST /api/jira/oauth/start: the Atlassian consent page, with a new one-time `state`. */
export const JiraOAuthStartResponse = z.object({ url: z.url() });
export type JiraOAuthStartResponse = z.infer<typeof JiraOAuthStartResponse>;

/** POST /api/jira/oauth/disconnect: the stored login is deleted. */
export const JiraOAuthDisconnectResponse = z.object({ ok: z.literal(true) });
export type JiraOAuthDisconnectResponse = z.infer<typeof JiraOAuthDisconnectResponse>;

/** GET JIRA_OAUTH_CALLBACK_PATH: Atlassian's redirect. `error` instead of `code` when the user
 * declined. */
export const JiraOAuthCallbackQuery = z.object({
  state: z.string().min(1).max(200),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});
export type JiraOAuthCallbackQuery = z.infer<typeof JiraOAuthCallbackQuery>;

/** `?result=` on JIRA_OAUTH_RESULT_PATH after the callback. */
export const JiraOAuthResult = z.enum(['connected', 'denied', 'failed']);
export type JiraOAuthResult = z.infer<typeof JiraOAuthResult>;

/** SSE event name sent on /api/events when the session list may have changed. */
export const SESSIONS_CHANGED = 'sessions-changed';
