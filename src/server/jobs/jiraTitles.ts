import { z } from 'zod';
import type { JiraTitlesResponse, RunFailure } from '../../shared/api';
import { DEFAULT_CONFIG } from '../../shared/config';
import { TicketKey } from '../../shared/session';
import type { JiraTitle } from '../../shared/state';
import { JiraError } from '../jira/auth';
import type { JiraClient, JiraIssue } from '../jira/client';
import type { StateStore } from '../state';

/** A cached title is asked for again after this long by default (spec: titles cached for 24 h);
 * the config's `jira.titleTtlHours` changes it. */
export const TITLE_TTL_MS = DEFAULT_CONFIG.jira.titleTtlHours * 60 * 60 * 1000;

/** Keys per run, so one JQL search stays small. */
export const KEYS_PER_RUN = 50;

/** After a failed run, background refreshes wait this long; Refresh still runs at once. */
export const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

const FIELDS = ['summary', 'status'] as const;

/** The two fields a title needs; an issue without them counts as missing. */
const TitleFields = z.object({
  summary: z.string().max(500),
  status: z.object({ name: z.string().max(100) }),
});

/** Keys are TicketKey-validated before they reach the JQL, so they cannot change the query. */
export const titlesJql = (keys: readonly string[]) => `key in (${keys.join(', ')})`;

/** Titles for `keys` from Jira. A JQL naming a key Jira has no issue for may fail with 400 as a
 * whole; then each key is read on its own and a 404 is missing. Throws JiraError. */
async function lookup(
  jira: Pick<JiraClient, 'search' | 'issue'>,
  keys: readonly string[],
): Promise<JiraIssue[]> {
  try {
    return await jira.search({ jql: titlesJql(keys), fields: FIELDS, max: keys.length });
  } catch (err) {
    if (!(err instanceof JiraError) || err.status !== 400) throw err;
  }
  const found: JiraIssue[] = [];
  for (const key of keys) {
    const issue = await jira.issue(key, FIELDS);
    if (issue) found.push(issue);
  }
  return found;
}

export interface JiraTitlesOptions {
  /** Jira REST through the OAuth login (ADR 0062). */
  jira: Pick<JiraClient, 'search' | 'issue'>;
  state: Pick<StateStore, 'jiraTitles' | 'setJiraTitles'>;
  /** Ticket keys found in sessions, read on each refresh. */
  keys: () => Promise<string[]>;
  /** Called after a run that changed the cache, so open pages refetch. */
  onChanged?: () => void;
  /** Defaults to TITLE_TTL_MS. */
  ttlMs?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface JiraTitles {
  /** Cached titles and the last run's outcome, as GET /api/jira/titles returns them. */
  snapshot(): JiraTitlesResponse;
  /** Fetches keys with no entry or one older than 24 h; `force` fetches every key. Skipped while
   * a background refresh is held back by a recent failure, unless forced. Never throws. */
  refresh(opts?: { force?: boolean }): Promise<JiraTitlesResponse>;
  /** For shutdown: no Jira call starts after this, and an answer still in flight is dropped
   * (no cache write, no onChanged) (ADR 0057). */
  stop(): void;
}

/** Jira titles for ticket groups and search (T12, ADR 0039), read straight from Jira (ADR 0063). */
export function createJiraTitles(opts: JiraTitlesOptions): JiraTitles {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[jira-titles] ${m}`));
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
      let found: JiraIssue[];
      try {
        found = await lookup(opts.jira, keys);
      } catch (err) {
        if (stopped) return;
        const reason: RunFailure = err instanceof JiraError ? err.kind : 'failed';
        log(`${reason}: ${(err as Error).message}`);
        // The cache stays as it was: never partial or bad data (spec § Jira sync job).
        lastRun = { at: now().toISOString(), ok: false, reason };
        return;
      }
      if (stopped) return;
      const at = now().toISOString();
      const asked = new Set(keys);
      const entries: Record<string, JiraTitle> = {};
      for (const issue of found) {
        const fields = TitleFields.safeParse(issue.fields);
        if (asked.has(issue.key) && fields.success) {
          const { summary, status } = fields.data;
          entries[issue.key] = { title: summary, status: status.name, fetchedAt: at };
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
        log(err.message);
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
