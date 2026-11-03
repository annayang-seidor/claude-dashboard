import { z } from 'zod';
import { TicketKey } from '../../shared/session';
import { JiraError, REQUEST_TIMEOUT_MS, type JiraAuth } from './auth';

const API_ROOT = 'https://api.atlassian.com/ex/jira';
/** Jira's largest search page. */
const PAGE_SIZE = 100;
/** A Retry-After longer than this is cut short; the job runs again later anyway. */
const MAX_RETRY_WAIT_MS = 10 * 1000;

/** One issue from the search; `fields` holds what was asked for, typed by the job that reads it. */
export const JiraIssue = z.looseObject({
  id: z.string(),
  key: TicketKey,
  fields: z.record(z.string(), z.unknown()),
});
export type JiraIssue = z.infer<typeof JiraIssue>;

const SearchPage = z.looseObject({
  issues: z.array(JiraIssue),
  nextPageToken: z.string().optional(),
  isLast: z.boolean().optional(),
});

const Myself = z.looseObject({ accountId: z.string().min(1), displayName: z.string() });
export type JiraMyself = z.infer<typeof Myself>;

export interface JiraClient {
  /** Up to `max` issues the JQL matches, read page by page from /rest/api/3/search/jql. */
  search(req: { jql: string; fields: readonly string[]; max: number }): Promise<JiraIssue[]>;
  /** One issue by key; null when Jira has none (404). */
  issue(key: string, fields: readonly string[]): Promise<JiraIssue | null>;
  /** The logged-in user. */
  myself(): Promise<JiraMyself>;
}

export interface JiraClientOptions {
  auth: Pick<JiraAuth, 'session'>;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Jira Cloud REST through the OAuth login (ADR 0062). Throws JiraError: `auth` when there is no
 * login or Atlassian refuses it after a refresh, `timeout`, or `failed`. */
export function createJiraClient(opts: JiraClientOptions): JiraClient {
  const fetchFn = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<T> {
    let forceRefresh = false;
    for (let attempt = 0; ; attempt++) {
      const session = await opts.auth.session({ forceRefresh });
      if (!session) throw new JiraError('auth', 'Jira is not connected');
      let res: Response;
      try {
        res = await fetchFn(`${API_ROOT}/${session.cloudId}${path}`, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const timedOut = (err as Error).name === 'TimeoutError';
        throw new JiraError(timedOut ? 'timeout' : 'failed', `${path}: ${(err as Error).message}`);
      }
      const retry = attempt === 0;
      if (res.status === 401 && retry) {
        forceRefresh = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && retry) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(after > 0 ? Math.min(after * 1000, MAX_RETRY_WAIT_MS) : 2000);
        continue;
      }
      if (!res.ok) {
        const kind = res.status === 401 ? 'auth' : 'failed';
        throw new JiraError(kind, `${path}: HTTP ${res.status}`, res.status);
      }
      const parsed = schema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new JiraError('failed', `${path}: ${issue?.path.join('.')}: ${issue?.message}`);
      }
      return parsed.data;
    }
  }

  return {
    async search({ jql, fields, max }) {
      const issues: JiraIssue[] = [];
      let nextPageToken: string | undefined;
      while (issues.length < max) {
        const page = await call('/rest/api/3/search/jql', SearchPage, {
          method: 'POST',
          body: {
            jql,
            fields,
            maxResults: Math.min(PAGE_SIZE, max - issues.length),
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        });
        issues.push(...page.issues);
        nextPageToken = page.nextPageToken;
        if (page.isLast || !nextPageToken || page.issues.length === 0) break;
      }
      return issues.slice(0, max);
    },

    async issue(key, fields) {
      const query = new URLSearchParams({ fields: fields.join(',') });
      try {
        return await call(`/rest/api/3/issue/${encodeURIComponent(key)}?${query}`, JiraIssue, {
          method: 'GET',
        });
      } catch (err) {
        if (err instanceof JiraError && err.status === 404) return null;
        throw err;
      }
    },

    myself: () => call('/rest/api/3/myself', Myself, { method: 'GET' }),
  };
}
