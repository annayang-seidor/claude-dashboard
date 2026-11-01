import type { ApiSession } from '../../shared/api';
import type { JiraInboxItem } from '../../shared/state';

/** Newest relevant activity first (spec § Inbox). */
function newestFirst(items: readonly JiraInboxItem[]): JiraInboxItem[] {
  return [...items].sort((a, b) => Date.parse(b.lastRelevantAt) - Date.parse(a.lastRelevantAt));
}

/** The "Needs you" and FYI lists of a sync result, each newest first. */
export function splitInbox(items: readonly JiraInboxItem[]): {
  action: JiraInboxItem[];
  fyi: JiraInboxItem[];
} {
  const sorted = newestFirst(items);
  return {
    action: sorted.filter((i) => i.bucket === 'action'),
    fyi: sorted.filter((i) => i.bucket === 'fyi'),
  };
}

export type PrimaryAction = { kind: 'new' } | { kind: 'resume'; session: ApiSession };

/** New session when no session has the ticket key; otherwise Resume the most recent To do
 * session for it, else the most recent one (Done included). */
export function primaryAction(key: string, sessions: readonly ApiSession[]): PrimaryAction {
  const mine = sessions
    .filter((s) => s.ticketKey === key)
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  const session = mine.find((s) => s.state.status === 'todo') ?? mine[0];
  return session ? { kind: 'resume', session } : { kind: 'new' };
}

/** The ticket's page on the configured Jira site; `base` is already validated and has no
 * trailing slash (ADR 0044). */
export function jiraIssueUrl(base: string, key: string): string {
  return `${base}/browse/${encodeURIComponent(key)}`;
}
