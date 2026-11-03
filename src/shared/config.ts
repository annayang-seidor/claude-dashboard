import { z } from 'zod';
import { Workspace, WorkspaceKind } from './session';

/** Loopback address the server binds to. Never 0.0.0.0. */
export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = 4317;

/** Request header carrying the access token (kept in ~/.claude-dashboard/token, ADR 0032). */
export const TOKEN_HEADER = 'X-Dashboard-Token';
/** Trades the token from before the last rotation for the current one (ADR 0048). */
export const TOKEN_REFRESH_PATH = '/api/token/refresh';
/** Query parameter the server puts in the printed URL; the web app reads it once on load. */
export const TOKEN_QUERY_PARAM = 't';

/** Where Atlassian sends the browser back after the OAuth consent: the one /api path that skips
 * the token check, guarded by a one-time `state` instead (ADR 0062). */
export const JIRA_OAUTH_CALLBACK_PATH = '/api/jira/oauth/callback';
/** Page route the callback redirects to, with `?result=` (ADR 0062). */
export const JIRA_OAUTH_RESULT_PATH = '/jira-oauth';

/** Claude Code's `cleanupPeriodDays` when settings.json does not set it (spike Q6). */
export const CLAUDE_CLEANUP_DEFAULT_DAYS = 30;

/** Most ids one bulk trash or restore call accepts. */
export const BULK_MAX_IDS = 200;

/** Terminal that Resume and New session open (spike Q9). */
export const TerminalApp = z.enum(['iterm', 'terminal']);
export type TerminalApp = z.infer<typeof TerminalApp>;

/** Jira site that "Open in Jira" links to, e.g. https://example.atlassian.net; a ticket opens at
 * `<base>/browse/<KEY>`. https only, so the page never renders a `javascript:` or plain-http link;
 * trailing slashes are dropped. */
export const JiraBaseUrl = z
  .url({ protocol: /^https$/ })
  .transform((url) => url.replace(/\/+$/, ''));

const days = (max: number) =>
  z.int(`expected a whole number of days from 1 to ${max}`).min(1).max(max);

/** Tab label: one string for both languages, or one per language. */
export const WorkspaceLabel = z.union([
  z.string().min(1).max(40),
  z.strictObject({ en: z.string().min(1).max(40), 'zh-TW': z.string().min(1).max(40) }),
]);
export type WorkspaceLabel = z.infer<typeof WorkspaceLabel>;

/** One workspace page (ADR 0061). Sessions whose first cwd is under `root` belong to it; the
 * deepest matching root wins, and a session under none goes to the `fallback` workspace. */
export const WorkspaceConfig = z.strictObject({
  id: Workspace,
  label: WorkspaceLabel,
  /** Absolute, or `~/…` for the home folder. Shown as written on the tab. */
  root: z.string().regex(/^(~|~\/.+|\/.*)$/, 'expected an absolute path or one starting with ~/'),
  kind: WorkspaceKind,
  fallback: z.boolean().default(false),
  /** Idle days before auto-archive trashes a session (Work: Scratch only; ADR 0024). */
  autoArchiveDays: days(365),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>;

export const Workspaces = z
  .array(WorkspaceConfig)
  .min(1, 'expected at least one workspace')
  .max(8, 'expected at most 8 workspaces')
  .superRefine((list, ctx) => {
    list.forEach((w, i) => {
      if (list.findIndex((o) => o.id === w.id) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'id'],
          message: `expected a unique id; "${w.id}" is used twice`,
        });
      }
    });
    const fallbacks = list.filter((w) => w.fallback).length;
    if (fallbacks !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `expected exactly one workspace with "fallback": true, found ${fallbacks}`,
      });
    }
  });

/** Today's two workspaces: what a machine with no `workspaces` key gets. */
export const DEFAULT_WORKSPACES: WorkspaceConfig[] = [
  {
    id: 'work',
    label: { en: 'Work', 'zh-TW': '工作' },
    root: '~/y',
    kind: 'work',
    fallback: false,
    autoArchiveDays: 7,
  },
  {
    id: 'personal',
    label: { en: 'Personal', 'zh-TW': '個人' },
    root: '~/o',
    kind: 'personal',
    fallback: true,
    autoArchiveDays: 14,
  },
];

/** The Clean up modal (spec § Cleanup, ADR 0038). */
export const CleanupConfig = z.strictObject({
  /** Quick range choices in days. Keep them under Claude Code's cleanupPeriodDays. */
  ranges: z.array(days(365)).min(1).max(4).default([7, 14]),
  /** Must be one of `ranges`. */
  defaultRange: days(365).default(14),
  /** Where the custom date starts, in days back (still stopped at cleanupPeriodDays). */
  customStartDays: days(365).default(21),
  keepBookmarked: z.boolean().default(true),
  keepTodo: z.boolean().default(true),
});
export type CleanupConfig = z.infer<typeof CleanupConfig>;

/** Every key, with its default. `.prefault({})` runs a missing object through its own defaults. */
const ConfigShape = z.strictObject({
  /** Per machine (ADR 0058). */
  terminal: TerminalApp.default('iterm'),
  /** Per machine (ADR 0061). */
  workspaces: Workspaces.default(DEFAULT_WORKSPACES),
  jiraBaseUrl: JiraBaseUrl.optional(),
  cleanup: CleanupConfig.prefault({}),
  autoArchive: z
    .strictObject({
      /** Switches the job and the UI's "Moves to trash in N days" together: with it off, nothing
       * is moved, so the UI must not promise it. */
      enabled: z.boolean().default(true),
    })
    .prefault({}),
  trash: z
    .strictObject({
      /** Days a deleted session stays in ~/.claude-dashboard/trash before purge removes it. */
      retentionDays: days(365).default(7),
    })
    .prefault({}),
  /** Bookmarked rows warn this many days before Claude Code's own cleanup removes them. */
  retentionWarnDays: days(365).default(7),
  /** How long the delete toast offers Undo. */
  undoMs: z.int('expected milliseconds from 1000 to 60000').min(1000).max(60_000).default(8000),
  jobs: z
    .strictObject({
      /** How often the daily jobs check for work not yet done today (ADR 0031). */
      dailyIntervalHours: z.int('expected whole hours from 1 to 24').min(1).max(24).default(6),
    })
    .prefault({}),
  jira: z
    .strictObject({
      /** A background inbox sync runs when the last attempt is at least this old. */
      syncIntervalMinutes: z
        .int('expected whole minutes from 5 to 1440')
        .min(5)
        .max(1440)
        .default(45),
      /** Background syncs run only on these days (0 = Sunday) and local hours [start, end). */
      syncWindow: z
        .strictObject({
          days: z
            .array(z.int('expected 0 (Sunday) to 6 (Saturday)').min(0).max(6))
            .default([1, 2, 3, 4, 5]),
          startHour: z.int('expected an hour from 0 to 23').min(0).max(23).default(9),
          endHour: z.int('expected an hour from 1 to 24').min(1).max(24).default(19),
        })
        .prefault({}),
      /** Issues I own or follow: changed in the last N days, or since the last good sync. */
      changedDays: days(7).default(2),
      /** The changed-issues window never reaches further back than this. */
      maxDays: days(30).default(7),
      /** Mentions: issues updated in the last N days; more overflows one tool result (ADR 0042). */
      mentionDays: days(7).default(3),
      /** A cached Jira title is fetched again after this many hours. */
      titleTtlHours: z.int('expected whole hours from 1 to 720').min(1).max(720).default(24),
    })
    .prefault({}),
});

/** Checks across keys, run on the merged files: one file may set a key the other relies on. */
function crossChecks(c: z.infer<typeof ConfigShape>, ctx: z.RefinementCtx): void {
  if (!c.cleanup.ranges.includes(c.cleanup.defaultRange)) {
    ctx.addIssue({
      code: 'custom',
      path: ['cleanup', 'defaultRange'],
      message: `expected one of cleanup.ranges (${c.cleanup.ranges.join(', ')}), got ${c.cleanup.defaultRange}`,
    });
  }
  const { startHour, endHour } = c.jira.syncWindow;
  if (startHour >= endHour) {
    ctx.addIssue({
      code: 'custom',
      path: ['jira', 'syncWindow', 'endHour'],
      message: `expected an hour after startHour (${startHour}), got ${endHour}`,
    });
  }
  if (c.jira.changedDays > c.jira.maxDays) {
    ctx.addIssue({
      code: 'custom',
      path: ['jira', 'changedDays'],
      message: `expected at most jira.maxDays (${c.jira.maxDays}), got ${c.jira.changedDays}`,
    });
  }
}

/** One config file on its own: `dashboard.config.json` in the repo or
 * `~/.claude-dashboard/config.json` (ADR 0058). Every key is optional; an unknown key is an
 * error, so a typo cannot pass for a default (ADR 0060). */
export const DashboardConfigFile = ConfigShape;

/** The files merged, with defaults for the keys none of them set. */
export const DashboardConfig = ConfigShape.superRefine(crossChecks);
export type DashboardConfig = z.infer<typeof DashboardConfig>;

export const DEFAULT_CONFIG: DashboardConfig = DashboardConfig.parse({});

/** The part of the config the page needs (GET /api/config, ADR 0061). */
export const PageConfig = z.object({
  workspaces: z.array(WorkspaceConfig),
  cleanup: CleanupConfig,
  autoArchive: z.object({ enabled: z.boolean() }),
  retentionWarnDays: z.int(),
  undoMs: z.int(),
});
export type PageConfig = z.infer<typeof PageConfig>;

export function pageConfig(c: DashboardConfig): PageConfig {
  const { workspaces, cleanup, autoArchive, retentionWarnDays, undoMs } = c;
  return { workspaces, cleanup, autoArchive, retentionWarnDays, undoMs };
}

export const DEFAULT_PAGE_CONFIG: PageConfig = pageConfig(DEFAULT_CONFIG);
