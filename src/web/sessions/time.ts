import { format, type Messages } from '../i18n/core';

// Relative labels as the prototype writes them, in local time. Weeks start on Monday.

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Calendar days from `then` to `now` (0 = same day); negative for the future. */
export function daysAgo(then: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(then).getTime()) / DAY_MS);
}

function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

export type Bucket = 'today' | 'yesterday' | 'thisWeek' | 'older';
export const BUCKETS: readonly Bucket[] = ['today', 'yesterday', 'thisWeek', 'older'];

export function bucketOf(then: Date, now: Date): Bucket {
  const days = daysAgo(then, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return then >= startOfWeek(now) ? 'thisWeek' : 'older';
}

const pad = (n: number) => String(n).padStart(2, '0');
const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateOf = (d: Date) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

type Span = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'older';

/** Labels count back from today, unlike the Monday-based buckets: a weekday name means the last
 * 6 days, "Last <day>" the 7 before that (prototype: "Sun" at 5 days, "Last Thu" at 8). */
function spanOf(then: Date, now: Date): Span {
  const days = daysAgo(then, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 6) return 'thisWeek';
  return days <= 13 ? 'lastWeek' : 'older';
}

export interface WhenLabels {
  /** Row meta: "Today 10:12", "Tue 16:05", "Last Thu 11:30", "10/05 10:20". */
  time: string;
  /** Timeline column: "10:12", "Tue", "Last Thu", "10/05". */
  clock: string;
  /** Mid-sentence day: "yesterday", "Tue", "10/03" (repo "last active …"). */
  day: string;
}

export function whenLabels(iso: string, now: Date, m: Messages): WhenLabels {
  const then = new Date(iso);
  const clock = clockOf(then);
  const weekday = m.time.weekdays[then.getDay()] ?? '';
  const at = (day: string) => format(m.time.at, { day, time: clock });
  switch (spanOf(then, now)) {
    case 'today':
      return { time: format(m.time.todayAt, { time: clock }), clock, day: m.time.todayLower };
    case 'yesterday':
      return {
        time: format(m.time.yesterdayAt, { time: clock }),
        clock,
        day: m.time.yesterdayLower,
      };
    case 'thisWeek':
      return { time: at(weekday), clock: weekday, day: weekday };
    case 'lastWeek': {
      const last = format(m.time.lastWeekday, { day: weekday });
      return { time: at(last), clock: last, day: last };
    }
    case 'older':
      return { time: at(dateOf(then)), clock: dateOf(then), day: dateOf(then) };
  }
}

/** Days until auto-archive moves a session to trash: `idleDays` on its last active day, counting
 * calendar days like the prototype (7, then 6 the next day); ≤ 0 = due. */
export function daysUntilTrash(lastActivityAt: string, now: Date, idleDays: number): number {
  return idleDays - daysAgo(new Date(lastActivityAt), now);
}

/** Days until Claude Code's own cleanup deletes a bookmarked session, once that is within
 * `warnDays`; null when there is nothing to warn about (not bookmarked, far off, or Claude Code's
 * cleanup is off or unknown). Bookmarks never protect against it (spec: Bookmark). */
export function claudeCleanupWarning(
  session: { lastActivityAt: string; state: { bookmarked: boolean } },
  now: Date,
  cleanupPeriodDays: number | null | undefined,
  warnDays: number,
): number | null {
  if (!cleanupPeriodDays || !session.state.bookmarked) return null;
  const n = daysUntilTrash(session.lastActivityAt, now, cleanupPeriodDays);
  return n <= warnDays ? n : null;
}

/** Elapsed time for "Jira synced {ago}": "just now", "12 min ago", "3h ago", "2d ago". */
export function agoLabel(iso: string, now: Date, m: Messages): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return m.time.justNow;
  if (minutes < 60) return format(m.time.minutesAgo, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format(m.time.hoursAgo, { n: hours });
  return format(m.time.daysAgo, { n: Math.floor(hours / 24) });
}
