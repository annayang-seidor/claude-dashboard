import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { DetectedEnv } from '../../shared/env';
import type { Category } from '../../shared/session';
import type { ResolvedWorkspace } from '../config';

const TICKET_RE = /^[\w-]+\/([A-Z][A-Z0-9]+-\d+)/;
const PROMPT_TITLE_MAX = 80;

/** Finds the git top-level for `cwd`, searching no higher than `ceiling`; null if none. */
export type RepoRootFinder = (cwd: string, ceiling: string) => string | null;

/** The configured workspaces, roots absolute (ADR 0061). Exactly one is the fallback. */
export type Roots = readonly ResolvedWorkspace[];

export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function ticketKeyOf(branch: string | null): string | null {
  return branch?.match(TICKET_RE)?.[1] ?? null;
}

/** A ticket wins over an env: hac calls made while working a ticket stay in the ticket group. */
export function categoryOf(ticketKey: string | null, env: DetectedEnv | null): Category {
  return ticketKey ? 'ticket' : env ? 'ops' : 'scratch';
}

/** The workspace whose root holds `cwd`, the deepest one when roots nest; null under none. */
function rootOf(cwd: string, roots: Roots): ResolvedWorkspace | null {
  return roots
    .filter((w) => isUnder(cwd, w.root))
    .reduce<ResolvedWorkspace | null>(
      (a, w) => (a && a.root.length >= w.root.length ? a : w),
      null,
    );
}

/** The workspace for a session's first cwd; outside every root, the fallback one. */
export function workspaceOf(cwd: string, roots: Roots): ResolvedWorkspace {
  return rootOf(cwd, roots) ?? roots.find((w) => w.fallback)!;
}

/**
 * Repo folder for a session: the git top-level of cwd, else the first folder under its
 * workspace root. Null outside every root, or when cwd is a root itself.
 */
export function repoOf(cwd: string, roots: Roots, findRepoRoot: RepoRootFinder): string | null {
  const root = rootOf(cwd, roots)?.root;
  if (!root) return null;
  const top = findRepoRoot(cwd, root);
  if (top) return top;
  if (cwd === root) return null;
  const first = relative(root, cwd).split(sep)[0];
  return first ? join(root, first) : null;
}

/** Walks up from cwd looking for `.git` (a folder, or a file for worktrees/submodules). */
export const findGitRoot: RepoRootFinder = (cwd, ceiling) => {
  for (let dir = cwd; isUnder(dir, ceiling); dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dir === ceiling) break;
  }
  return null;
};

export function titleOf(facts: {
  customTitle: string | null;
  aiTitle: string | null;
  summary: string | null;
  firstPrompt: string | null;
}): string {
  if (facts.customTitle) return facts.customTitle;
  if (facts.aiTitle) return facts.aiTitle;
  if (facts.summary) return facts.summary;
  const prompt = (facts.firstPrompt ?? '').replace(/\s+/g, ' ').trim();
  return Array.from(prompt).slice(0, PROMPT_TITLE_MAX).join('');
}
