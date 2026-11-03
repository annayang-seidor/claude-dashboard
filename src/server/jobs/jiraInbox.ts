import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { JiraInboxResponse, RunFailure } from '../../shared/api';
import { DEFAULT_CONFIG, type DashboardConfig } from '../../shared/config';
import { TicketKey } from '../../shared/session';
import { JiraInboxResult, type JiraInboxItem, type JiraSyncAttempt } from '../../shared/state';
import { JiraError } from '../jira/auth';
import type { JiraClient } from '../jira/client';
import type { StateStore } from '../state';
import {
  INBOX_FIELDS,
  SEARCH_MAX,
  buildDigest,
  changedJql,
  mentionJql,
  type DigestIssue,
} from './inboxDigest';
import type { Runner } from './runner';

/** The job's part of the inbox reply; the route adds config's `jiraBaseUrl`. */
type InboxSnapshot = Omit<JiraInboxResponse, 'jiraBaseUrl'>;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The config's `jira` timings (ADR 0060); the constants below are their defaults. */
export type JiraSchedule = Pick<
  DashboardConfig['jira'],
  'syncIntervalMinutes' | 'syncWindow' | 'changedDays' | 'maxDays' | 'mentionDays'
>;
const DEFAULTS: JiraSchedule = DEFAULT_CONFIG.jira;

/** A background sync runs when the last attempt is at least this old (spec: every 30–60 min). */
export const SYNC_INTERVAL_MS = DEFAULTS.syncIntervalMinutes * MINUTE;

/** How often the scheduler checks; short, so a server started at 08:30 syncs soon after 09:00. */
export const TICK_MS = 5 * MINUTE;

/** Mentions: issues updated in the last 3 days by default (ADR 0042). */
export const MENTION_DAYS = DEFAULTS.mentionDays;

/** The digest goes to `claude -p` as one argv string; macOS caps argv and env at 1 MB together. */
export const MAX_DIGEST_CHARS = 200_000;

/** What Claude answers: the bucket, reason and time per key. Everything else comes from Jira. */
export const InboxAnswer = z.object({
  items: z
    .array(
      z.object({
        key: TicketKey,
        bucket: z.enum(['action', 'fyi']),
        reason: z.string().min(1).max(140),
        lastRelevantAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(100),
});
export type InboxAnswer = z.infer<typeof InboxAnswer>;

/** Claude's answer on top of the digest: keys not in the digest are dropped, a repeated key keeps
 * its first answer, and the newest comes first. */
export function mergeAnswer(digest: readonly DigestIssue[], answer: InboxAnswer): JiraInboxItem[] {
  const byKey = new Map(digest.map((d) => [d.key, d]));
  const items = new Map<string, JiraInboxItem>();
  for (const a of answer.items) {
    const d = byKey.get(a.key);
    if (!d || items.has(a.key)) continue;
    const { key, title, status, assignee, kind } = d;
    const { bucket, reason, lastRelevantAt } = a;
    items.set(key, { key, title, status, assignee, kind, bucket, reason, lastRelevantAt });
  }
  return [...items.values()].sort(
    (x, y) => Date.parse(y.lastRelevantAt) - Date.parse(x.lastRelevantAt),
  );
}

export const PROMPT_PATH = fileURLToPath(new URL('./prompts/jira-inbox.md', import.meta.url));

/** Background syncs run Mon–Fri 09:00–19:00 local time only, by default; Sync on demand runs any
 * time. */
export function inSyncWindow(
  d: Date,
  w: JiraSchedule['syncWindow'] = DEFAULTS.syncWindow,
): boolean {
  const hour = d.getHours();
  return w.days.includes(d.getDay()) && hour >= w.startHour && hour < w.endHour;
}

/** Start of the changed-issues window for a run at `now`: issues I own or follow changed in the
 * last 2 days, or since the last good sync if that is earlier (Monday covers Friday evening),
 * but never more than 7 days back (ADR 0042). */
export function windowStart(
  now: Date,
  lastSyncedAt?: string,
  jira: Pick<JiraSchedule, 'changedDays' | 'maxDays'> = DEFAULTS,
): Date {
  const last = lastSyncedAt ? Date.parse(lastSyncedAt) : Infinity;
  const start = Math.min(now.getTime() - jira.changedDays * DAY, last);
  return new Date(Math.max(start, now.getTime() - jira.maxDays * DAY));
}

export interface PromptTemplate {
  version: number;
  body: string;
}

/** The prompt file: front matter with `version: <n>`, then the prompt with `{{name}}` slots. */
export function parsePromptFile(text: string): PromptTemplate {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  const version = match && /^version:\s*(\d+)\s*$/m.exec(match[1]!);
  if (!match || !version) throw new Error('prompt file needs front matter with "version: <n>"');
  return { version: Number(version[1]), body: match[2]!.trim() };
}

/** Fills every `{{name}}`; a slot with no value is a typo in the prompt file, so it throws. */
export function renderPrompt(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`prompt file has an unknown slot {{${name}}}`);
    return value;
  });
}

export interface JiraInboxOptions {
  /** Classifies the digest with no tools (ADR 0063). */
  runner: Runner;
  /** Jira REST through the OAuth login (ADR 0062). */
  jira: Pick<JiraClient, 'search' | 'myself'>;
  state: Pick<StateStore, 'sync' | 'setSync'>;
  /** Interval, window and look-back days; defaults to the default config's. */
  schedule?: JiraSchedule;
  /** Read before every run, so a tuned prompt takes effect without a restart. */
  readPrompt?: () => Promise<string>;
  /** Called after every run, good or not, so open pages refetch. */
  onChanged?: () => void;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface JiraInbox {
  snapshot(): InboxSnapshot;
  /** Runs now, whatever the time; joins a run already in flight. Never throws. */
  sync(): Promise<InboxSnapshot>;
  /** Syncs when inside the window and the last attempt is 45 min old or more. */
  tick(): Promise<void>;
  /** Ticks now and every 5 min, in the background: nothing waits for a run (spec § Speed). */
  start(): void;
  /** Clears the timer. Until the next start(), no Jira or runner call starts and an answer still
   * in flight is dropped (no state write, no onChanged). A `claude -p` already running is not
   * killed (ADR 0057). */
  stop(): void;
}

/** The classified Jira inbox (T13, ADR 0042): the server reads Jira, Claude only sorts what it
 * read (ADR 0063). The last good result is replaced only by a valid run; every attempt is
 * recorded, with why it failed. */
export function createJiraInbox(opts: JiraInboxOptions): JiraInbox {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[jira-inbox] ${m}`));
  const readPrompt = opts.readPrompt ?? (() => readFile(PROMPT_PATH, 'utf8'));
  const schedule = opts.schedule ?? DEFAULTS;
  let running: Promise<InboxSnapshot> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  function snapshot(): InboxSnapshot {
    const jira = opts.state.sync().jira;
    return { result: jira?.result ?? null, lastAttempt: jira?.lastAttempt ?? null };
  }

  async function record(attempt: JiraSyncAttempt, result?: JiraInboxResult): Promise<void> {
    const previous = opts.state.sync().jira?.result;
    try {
      await opts.state.setSync('jira', { result: result ?? previous, lastAttempt: attempt });
    } catch (err) {
      log(`cannot save the sync: ${(err as Error).message}`);
    }
    opts.onChanged?.();
  }

  async function pass(): Promise<void> {
    const started = now();
    const at = started.toISOString();
    const lastSyncedAt = opts.state.sync().jira?.result?.syncedAt;
    const fail = (reason: RunFailure, detail: string, promptVersion?: number) => {
      log(`${reason}: ${detail}`);
      return record({ at, ok: false, reason, detail: detail.slice(0, 300), promptVersion });
    };

    let template: PromptTemplate;
    try {
      template = parsePromptFile(await readPrompt());
    } catch (err) {
      if (stopped) return;
      return fail('failed', (err as Error).message);
    }
    const promptVersion = template.version;

    // Reading the prompt file takes a moment: the server may have closed meanwhile.
    if (stopped) return;
    const since = windowStart(started, lastSyncedAt, schedule);
    const changedMinutes = Math.ceil((started.getTime() - since.getTime()) / MINUTE);
    let me;
    let digest: DigestIssue[];
    try {
      me = await opts.jira.myself();
      const search = (jql: string) =>
        opts.jira.search({ jql, fields: INBOX_FIELDS, max: SEARCH_MAX });
      const [changed, mentioned] = await Promise.all([
        search(changedJql(changedMinutes)),
        search(mentionJql(schedule.mentionDays)),
      ]);
      digest = buildDigest({
        changed,
        mentioned,
        me,
        changedSince: since,
        mentionSince: new Date(started.getTime() - schedule.mentionDays * DAY),
      });
    } catch (err) {
      if (stopped) return;
      const reason = err instanceof JiraError ? err.kind : 'failed';
      return fail(reason, (err as Error).message, promptVersion);
    }
    if (stopped) return;

    let items: JiraInboxItem[] = [];
    if (digest.length > 0) {
      const issues = JSON.stringify(digest);
      if (issues.length > MAX_DIGEST_CHARS) {
        return fail('failed', `digest too large (${issues.length} characters)`, promptVersion);
      }
      let prompt: string;
      try {
        prompt = renderPrompt(template.body, {
          now: at,
          me: me.displayName,
          accountId: me.accountId,
          issues,
        });
      } catch (err) {
        return fail('failed', (err as Error).message, promptVersion);
      }
      const run = await opts.runner.run({ job: 'jira-inbox', prompt, schema: InboxAnswer });
      if (stopped) return;
      if (!run.ok) {
        // The last good result stays: never partial or bad data (spec § Jira sync job).
        return record({ at, ok: false, reason: run.reason, detail: run.detail, promptVersion });
      }
      items = mergeAnswer(digest, run.data);
    }
    // syncedAt is the run's start by the server's clock: the next window is measured from it.
    const result = JiraInboxResult.safeParse({ syncedAt: at, items });
    if (!result.success) {
      return fail('invalid', result.error.issues[0]?.message ?? 'invalid inbox', promptVersion);
    }
    await record({ at, ok: true, promptVersion }, result.data);
  }

  function sync(): Promise<InboxSnapshot> {
    running ??= pass()
      .catch((err: Error) =>
        record({ at: now().toISOString(), ok: false, reason: 'failed', detail: err.message }),
      )
      .then(snapshot)
      .finally(() => (running = null));
    return running;
  }

  function due(): boolean {
    const last = opts.state.sync().jira?.lastAttempt;
    return !last || now().getTime() - Date.parse(last.at) >= schedule.syncIntervalMinutes * MINUTE;
  }

  async function tick(): Promise<void> {
    if (running) return void (await running);
    if (inSyncWindow(now(), schedule.syncWindow) && due()) await sync();
  }

  return {
    snapshot,
    sync,
    tick,
    start() {
      stopped = false;
      void tick();
      timer ??= setInterval(() => void tick(), TICK_MS);
      // Never the reason the process stays alive.
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
