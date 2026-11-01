import type { ApiSession } from '../../shared/api';

// Test fixtures only; nothing in the app imports this file.

/** Friday 23 Oct 2026, 12:00 local time: the prototype's "today". */
export const NOW = new Date(2026, 9, 23, 12, 0);

let n = 0;

/** A session with sensible defaults; `at` is local time as [month (1-12), day, hour, minute]. */
export function session(
  over: Partial<Omit<ApiSession, 'state'>> & {
    at: [number, number, number, number];
    status?: 'todo' | 'done';
    bookmarked?: boolean;
  },
): ApiSession {
  const { at, status = 'todo', bookmarked = false, ...rest } = over;
  const [month, day, hour, minute] = at;
  const iso = new Date(2026, month - 1, day, hour, minute).toISOString();
  n++;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const category = rest.category ?? (rest.ticketKey ? 'ticket' : 'scratch');
  const title = rest.title ?? `Session ${n}`;
  return {
    id,
    filePath: `/p/${id}.jsonl`,
    cwd: '/Users/me/y/acme-shop',
    workspace: 'work',
    repo: '/Users/me/y/acme-shop',
    branch: null,
    branchesSeen: [],
    ticketKey: null,
    env: null,
    autoEnv: null,
    title,
    customTitle: null,
    createdAt: iso,
    lastActivityAt: iso,
    ...rest,
    autoTicketKey: rest.autoTicketKey ?? rest.ticketKey ?? null,
    autoTitle: rest.autoTitle ?? title,
    category,
    autoCategory: category,
    state: { status, bookmarked },
  };
}
