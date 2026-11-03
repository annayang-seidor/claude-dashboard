import type { ApiEnv, ApiSession, JiraTitlesResponse } from '../../shared/api';
import type { Category } from '../../shared/session';
import { BUCKETS, bucketOf, type Bucket } from './time';

// Grouping, filtering and search for both pages. Pure, so the list components stay thin.

export type TypeFilter = 'all' | Category;
export type StatusFilter = 'all' | 'todo' | 'bookmarked' | 'done';
export const TYPE_FILTERS: readonly TypeFilter[] = ['all', 'ops', 'ticket', 'scratch'];
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'todo', 'done', 'bookmarked'];

export interface Group {
  /** Stable id for collapse state and React keys. */
  id: string;
  kind: Category;
  /** Ticket key (Work ticket groups only). */
  key: string | null;
  /** Repo folder (Personal repo groups only); null for Scratch. */
  repo: string | null;
  /** Branch of the group's latest session that has one (Work ticket groups). */
  branch: string | null;
  /** Work Ops groups: the env they are keyed by; null for Ops sessions without one. */
  env: ApiEnv | null;
  /** Work Ops groups: release label of the latest session that has one. */
  releaseLabel: string | null;
  /** Every session in the group, in row order. */
  sessions: ApiSession[];
}

export interface GroupView {
  group: Group;
  /** Sessions that pass the filters and search, in row order. */
  rows: ApiSession[];
  /** Done and total over the whole group, for "n/m done". */
  done: number;
  total: number;
}

const latest = (s: ApiSession) => Date.parse(s.lastActivityAt);

/** Newest activity first; Done rows keep their place. */
export function compareRows(a: ApiSession, b: ApiSession): number {
  return latest(b) - latest(a);
}

export function matchesType(s: ApiSession, type: TypeFilter): boolean {
  return type === 'all' || s.category === type;
}

export function matchesStatus(s: ApiSession, status: StatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'bookmarked') return s.state.bookmarked;
  return s.state.status === status;
}

/** "~/o/<repo>" for a repo under the home folder; the full path otherwise. */
export function repoLabel(repo: string): string {
  const m = /^\/(?:Users|home)\/[^/]+\/(.+)$/.exec(repo);
  return m ? `~/${m[1]}` : repo;
}

/** Cached Jira titles by ticket key (ADR 0039). */
export type JiraTitleMap = JiraTitlesResponse['titles'];

/** Text the search box looks in, including the ticket's Jira title and the automatic title a
 * rename hides (spec § Title). `repo` (Personal-kind pages) adds repo and branch, as its
 * placeholder promises. */
function searchFields(s: ApiSession, titles: JiraTitleMap, repo: boolean): string[] {
  const jira = s.ticketKey ? (titles[s.ticketKey]?.title ?? '') : '';
  const fields = [
    s.ticketKey ?? '',
    s.title,
    s.autoTitle,
    jira,
    s.env?.name ?? '',
    s.state.releaseLabel ?? '',
  ];
  if (repo) fields.push(s.repo ? repoLabel(s.repo) : '', s.branch ?? '');
  return fields;
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Case-insensitive substring match; `q` must already be normalised. */
export function matchesQuery(
  s: ApiSession,
  q: string,
  titles: JiraTitleMap = {},
  repo = false,
): boolean {
  return !q || searchFields(s, titles, repo).some((f) => f.toLowerCase().includes(q));
}

/** Chip counts ignore search and status, as in the prototype. */
export function typeCounts(sessions: readonly ApiSession[]): Record<TypeFilter, number> {
  const counts = { all: 0, ops: 0, ticket: 0, scratch: 0 };
  for (const s of sessions) {
    counts.all++;
    counts[s.category]++;
  }
  return counts;
}

/** Status chip counts follow the type filter. */
export function statusCounts(
  sessions: readonly ApiSession[],
  type: TypeFilter,
): Record<StatusFilter, number> {
  const counts = { all: 0, todo: 0, bookmarked: 0, done: 0 };
  for (const s of sessions) {
    if (!matchesType(s, type)) continue;
    counts.all++;
    counts[s.state.status]++;
    if (s.state.bookmarked) counts.bookmarked++;
  }
  return counts;
}

function newestFirst(a: Group, b: Group): number {
  return Math.max(...b.sessions.map(latest)) - Math.max(...a.sessions.map(latest));
}

function finish(groups: Map<string, Group>): Group[] {
  const list = [...groups.values()];
  for (const g of list) g.sessions.sort(compareRows);
  return list.sort(newestFirst);
}

function add(
  groups: Map<string, Group>,
  id: string,
  s: ApiSession,
  init: Omit<Group, 'id' | 'sessions'>,
) {
  const g = groups.get(id) ?? { id, sessions: [], ...init };
  g.sessions.push(s);
  groups.set(id, g);
}

const envKey = (env: ApiEnv | null) => (env ? `ops:${env.project ?? ''}/${env.name}` : 'ops');

/** Work: one Ops group per env, then one per ticket (newest first), then Scratch. */
export function groupWork(sessions: readonly ApiSession[]): Group[] {
  const ops = new Map<string, Group>();
  const tickets = new Map<string, Group>();
  const scratch = new Map<string, Group>();
  for (const s of sessions) {
    const none = { key: null, repo: null, branch: null, env: null, releaseLabel: null };
    if (s.category === 'ops') add(ops, envKey(s.env), s, { kind: 'ops', ...none, env: s.env });
    else if (s.category === 'scratch') add(scratch, 'scratch', s, { kind: 'scratch', ...none });
    else
      add(tickets, `ticket:${s.ticketKey ?? ''}`, s, { kind: 'ticket', ...none, key: s.ticketKey });
  }
  const opsGroups = finish(ops);
  for (const g of opsGroups) {
    g.releaseLabel = g.sessions.find((s) => s.state.releaseLabel)?.state.releaseLabel ?? null;
  }
  const ticketGroups = finish(tickets);
  for (const g of ticketGroups) {
    const withBranch = [...g.sessions].sort((a, b) => latest(b) - latest(a)).find((s) => s.branch);
    g.branch = withBranch?.branch ?? null;
  }
  return [...opsGroups, ...ticketGroups, ...finish(scratch)];
}

/** A Personal session's project: its repo group's id, `repo:<path>` or `no-repo`. */
export const projectOf = (s: ApiSession): string => (s.repo ? `repo:${s.repo}` : 'no-repo');

/** `all`, or one project id from projectOf. */
export type ProjectFilter = string;

export function matchesProject(s: ApiSession, project: ProjectFilter): boolean {
  return project === 'all' || projectOf(s) === project;
}

export interface ProjectChip {
  id: string;
  /** Null for sessions outside a repo. */
  repo: string | null;
  count: number;
}

/** One chip per Personal group, in group order; counts ignore search and status, as type chips
 * do on Work. */
export function projectFilters(sessions: readonly ApiSession[]): ProjectChip[] {
  return groupPersonal(sessions).map((g) => ({ id: g.id, repo: g.repo, count: g.sessions.length }));
}

/** Personal: one group per repo (newest first), then one for sessions outside a repo. */
export function groupPersonal(sessions: readonly ApiSession[]): Group[] {
  const repos = new Map<string, Group>();
  const noRepo = new Map<string, Group>();
  for (const s of sessions) {
    const none = { key: null, branch: null, env: null, releaseLabel: null };
    if (s.repo) add(repos, `repo:${s.repo}`, s, { kind: s.category, ...none, repo: s.repo });
    else add(noRepo, 'no-repo', s, { kind: s.category, ...none, repo: null });
  }
  return [...finish(repos), ...finish(noRepo)];
}

/** Groups with at least one row passing `keep`; empty groups are dropped. */
export function viewGroups(
  groups: readonly Group[],
  keep: (s: ApiSession) => boolean,
): GroupView[] {
  return groups.flatMap((group) => {
    const rows = group.sessions.filter(keep);
    if (!rows.length) return [];
    const done = group.sessions.filter((s) => s.state.status === 'done').length;
    return [{ group, rows, done, total: group.sessions.length }];
  });
}

export interface TimelineRow {
  session: ApiSession;
  group: Group;
}

/** Today / Yesterday / Earlier this week / Older, newest first inside each; empty buckets dropped. */
export function timeline(
  views: readonly GroupView[],
  now: Date,
): { bucket: Bucket; rows: TimelineRow[] }[] {
  const rows = views
    .flatMap(({ group, rows }) => rows.map((session) => ({ session, group })))
    .sort((a, b) => latest(b.session) - latest(a.session));
  return BUCKETS.map((bucket) => ({
    bucket,
    rows: rows.filter((r) => bucketOf(new Date(r.session.lastActivityAt), now) === bucket),
  })).filter((b) => b.rows.length > 0);
}
