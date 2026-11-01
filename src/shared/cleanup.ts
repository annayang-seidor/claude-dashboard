import type { WorkspaceConfig } from './config';
import type { Category, Workspace } from './session';

// One selection routine for the Clean up modal and auto-archive (spec § Cleanup). Pure: the
// caller passes the clock, so the page and the server pick the same sessions for the same input.

/** The fields selection reads; ApiSession has them all. */
export interface CleanupCandidate {
  id: string;
  workspace: Workspace;
  category: Category;
  lastActivityAt: string;
  state: { status: 'todo' | 'done'; bookmarked: boolean; restoredAt?: string };
}

export interface CleanupRule {
  workspace: Workspace;
  /** Only Scratch sessions (Work auto-archive); otherwise every category. */
  scratchOnly: boolean;
  /** Sessions idle since before this instant are picked; null picks nothing (no valid date). */
  before: Date | null;
  keepBookmarked: boolean;
  keepTodo: boolean;
  /** Count idle time from a restore too, so Undo is not undone by the next run (ADR 0037). */
  sinceRestore: boolean;
}

export interface CleanupSelection<T> {
  /** In input order. */
  selected: T[];
  /** Old enough, but kept by Keep bookmarked. A session that is both is counted here only. */
  keptBookmarked: number;
  /** Old enough, not bookmarked (or not kept for it), but kept by Keep To do. */
  keptTodo: number;
}

/** Local midnight `days` calendar days before `now`: "older than 14 days" picks sessions last
 * active before it, i.e. 15 or more calendar days ago, as in the prototype. */
export function cutoffForDays(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

/** Local midnight of a `YYYY-MM-DD` date: "older than Oct 1" picks sessions last active before
 * Oct 1. Null for a malformed date or one after today (no future dates). */
export function cutoffForDate(date: string, now: Date): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const cutoff = new Date(y, mo, d);
  // Rejects rollovers such as 2026-02-31.
  if (cutoff.getFullYear() !== y || cutoff.getMonth() !== mo || cutoff.getDate() !== d) {
    return null;
  }
  return cutoff > cutoffForDays(now, 0) ? null : cutoff;
}

/** `now`'s local date as YYYY-MM-DD, for the date picker's max. */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The later of last activity and the last restore from the trash. */
export function idleSince(s: Pick<CleanupCandidate, 'lastActivityAt' | 'state'>): string {
  const { restoredAt } = s.state;
  return restoredAt && Date.parse(restoredAt) > Date.parse(s.lastActivityAt)
    ? restoredAt
    : s.lastActivityAt;
}

export function selectCleanup<T extends CleanupCandidate>(
  sessions: readonly T[],
  rule: CleanupRule,
): CleanupSelection<T> {
  const out: CleanupSelection<T> = { selected: [], keptBookmarked: 0, keptTodo: 0 };
  const { before } = rule;
  if (!before) return out;
  for (const s of sessions) {
    if (s.workspace !== rule.workspace) continue;
    if (rule.scratchOnly && s.category !== 'scratch') continue;
    const since = rule.sinceRestore ? idleSince(s) : s.lastActivityAt;
    if (!(Date.parse(since) < before.getTime())) continue;
    if (rule.keepBookmarked && s.state.bookmarked) out.keptBookmarked++;
    else if (rule.keepTodo && s.state.status === 'todo') out.keptTodo++;
    else out.selected.push(s);
  }
  return out;
}

/** Auto-archive's settings (ADR 0024): a Work-kind workspace trashes Scratch after its
 * `autoArchiveDays` idle days, a Personal-kind one every session; bookmarked kept, To do not.
 * "Idle over N days" means last active before local midnight N days ago, so the row's "Moves to
 * trash in N days" counts down to it. */
export function autoArchiveRule(
  workspace: Pick<WorkspaceConfig, 'id' | 'kind' | 'autoArchiveDays'>,
  now: Date,
): CleanupRule {
  return {
    workspace: workspace.id,
    scratchOnly: workspace.kind === 'work',
    before: cutoffForDays(now, workspace.autoArchiveDays),
    keepBookmarked: true,
    keepTodo: false,
    sinceRestore: true,
  };
}
