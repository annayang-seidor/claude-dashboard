import { z } from 'zod';
import type { JiraTitlesResponse, RunFailure } from '../../shared/api';
import { DEFAULT_CONFIG } from '../../shared/config';
import { TicketKey } from '../../shared/session';
import type { JiraTitle } from '../../shared/state';
import type { StateStore } from '../state';
import type { Runner } from './runner';

/** A cached title is asked for again after this long by default (spec: titles cached for 24 h);
 * the config's `jira.titleTtlHours` changes it. */
export const TITLE_TTL_MS = DEFAULT_CONFIG.jira.titleTtlHours * 60 * 60 * 1000;

/** Keys per run, so one JQL call and one answer stay small. */
export const KEYS_PER_RUN = 50;

/** After a failed run, background refreshes wait this long; Refresh still runs at once. */
export const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

/** The answer a jira-titles run must give. Keys are checked against the ones asked for. */
export const JiraTitlesAnswer = z.object({
  issues: z
    .array(z.object({ key: TicketKey, title: z.string().max(500), status: z.string().max(100) }))
    .max(KEYS_PER_RUN),
  missing: z.array(TicketKey).max(KEYS_PER_RUN).default([]),
});
export type JiraTitlesAnswer = z.infer<typeof JiraTitlesAnswer>;

/** Keys are TicketKey-validated before they reach the prompt, so they cannot carry instructions. */
export function jiraTitlesPrompt(keys: readonly string[]): string {
  return `Look up these Jira issues with the Atlassian Rovo tools and report each one's summary and status. Read only; change nothing.

Keys: ${keys.join(', ')}

Steps: call getAccessibleAtlassianResources for the cloudId, then one searchJiraIssuesUsingJql with jql \`key in (${keys.join(', ')})\` and fields summary,status. If a key makes the JQL fail, use getJiraIssue per key instead.

Answer with one JSON object and nothing else:
{"issues":[{"key":"ABC-1","title":"<summary>","status":"<status name>"}],"missing":["<keys Jira has no issue for>"]}

If a Rovo tool says you are not authenticated or must log in, answer exactly {"authRequired":true}.`;
}

export interface JiraTitlesOptions {
  runner: Runner;
  state: Pick<StateStore, 'jiraTitles' | 'setJiraTitles'>;
  /** Ticket keys found in sessions, read on each refresh. */
  keys: () => Promise<string[]>;
  /** Called after a run that changed the cache, so open pages refetch. */
  onChanged?: () => void;
  /** Defaults to TITLE_TTL_MS. */
  ttlMs?: number;
  now?: () => Date;
}

export interface JiraTitles {
  /** Cached titles and the last run's outcome, as GET /api/jira/titles returns them. */
  snapshot(): JiraTitlesResponse;
  /** Fetches keys with no entry or one older than 24 h; `force` fetches every key. Skipped while
   * a background refresh is held back by a recent failure, unless forced. Never throws. */
  refresh(opts?: { force?: boolean }): Promise<JiraTitlesResponse>;
  /** For shutdown: no runner call starts after this, and an answer still in flight is dropped
   * (no cache write, no onChanged). A `claude -p` already running is not killed (ADR 0057). */
  stop(): void;
}

/** First job on the runner: Jira titles for ticket groups and search (T12, ADR 0039). */
export function createJiraTitles(opts: JiraTitlesOptions): JiraTitles {
  const now = opts.now ?? (() => new Date());
  let lastRun: JiraTitlesResponse['lastRun'] = null;
  let stopped = false;

  function snapshot(): JiraTitlesResponse {
    const titles: JiraTitlesResponse['titles'] = {};
    for (const [key, entry] of Object.entries(opts.state.jiraTitles())) {
      if (!('missing' in entry)) titles[key] = { title: entry.title, status: entry.status };
    }
    return { titles, lastRun };
  }

  async function pass(force: boolean): Promise<void> {
    if (!force && lastRun && !lastRun.ok) {
      if (now().getTime() - Date.parse(lastRun.at) < RETRY_AFTER_FAILURE_MS) return;
    }
    const cache = opts.state.jiraTitles();
    const cutoff = now().getTime() - (opts.ttlMs ?? TITLE_TTL_MS);
    const wanted = [...new Set(await opts.keys())]
      .filter((k) => TicketKey.safeParse(k).success)
      .filter((k) => force || !cache[k] || Date.parse(cache[k].fetchedAt) <= cutoff)
      .sort();

    for (let i = 0; i < wanted.length; i += KEYS_PER_RUN) {
      const keys = wanted.slice(i, i + KEYS_PER_RUN);
      // Listing the keys takes a moment: the server may have closed meanwhile.
      if (stopped) return;
      const result = await opts.runner.run({
        job: 'jira-titles',
        prompt: jiraTitlesPrompt(keys),
        schema: JiraTitlesAnswer,
      });
      if (stopped) return;
      const at = now().toISOString();
      if (!result.ok) {
        // The cache stays as it was: never partial or bad data (spec § Jira sync job).
        lastRun = { at, ok: false, reason: result.reason satisfies RunFailure };
        return;
      }
      const asked = new Set(keys);
      const entries: Record<string, JiraTitle> = {};
      for (const issue of result.data.issues) {
        if (asked.has(issue.key)) {
          entries[issue.key] = { title: issue.title, status: issue.status, fetchedAt: at };
        }
      }
      // Asked for but not returned counts as missing too, so it is not asked for on every pass.
      for (const key of keys) entries[key] ??= { missing: true, fetchedAt: at };
      await opts.state.setJiraTitles(entries);
      lastRun = { at, ok: true };
      opts.onChanged?.();
    }
  }

  // Passes run one after another. A background call joins the one in flight; Refresh queues its own.
  let chain: Promise<void> = Promise.resolve();
  let background: Promise<void> | null = null;

  function refresh({ force = false } = {}): Promise<JiraTitlesResponse> {
    if (!force && background) return background.then(snapshot);
    const run = chain.then(() =>
      pass(force).catch((err: Error) => {
        console.warn(`[jira-titles] ${err.message}`);
        lastRun = { at: now().toISOString(), ok: false, reason: 'failed' };
      }),
    );
    chain = run;
    if (!force) {
      background = run;
      void run.finally(() => {
        if (background === run) background = null;
      });
    }
    return run.then(snapshot);
  }

  return {
    snapshot,
    refresh,
    stop() {
      stopped = true;
    },
  };
}
