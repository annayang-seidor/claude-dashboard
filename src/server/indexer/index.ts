import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DEFAULT_WORKSPACES } from '../../shared/config';
import { Session, SessionId } from '../../shared/session';
import { resolveWorkspaces } from '../config';
import {
  categoryOf,
  findGitRoot,
  isUnder,
  repoOf,
  ticketKeyOf,
  titleOf,
  workspaceOf,
  type RepoRootFinder,
  type Roots,
} from './derive';
import { topEnv } from './hac';
import { scanFile, scanHac, type HacProgress } from './scan';

export interface IndexerOptions {
  /** Defaults to ~/.claude/projects. */
  projectsRoot?: string;
  /** Home folder that the runner folder resolves against. Defaults to os.homedir(). */
  home?: string;
  /** Workspace roots, absolute (ADR 0061). Defaults to the default config's, under `home`. */
  workspaces?: Roots;
  /** Overrides git top-level lookup (tests). */
  findRepoRoot?: RepoRootFinder;
}

export interface Indexer {
  index(): Promise<Session[]>;
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  /** null = looked at and skipped (stub, runner, unparseable); still cached. */
  session: Session | null;
  /** Work sessions only: where the hac pass stopped (ADR 0036). */
  hac?: HacProgress;
}

const CONCURRENCY = 32;

/** `<root>/*\/*.jsonl` only: sub-agent transcripts in `<id>/subagents/` must never be listed. */
async function listTranscripts(root: string): Promise<string[]> {
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const perDir = await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dir = join(root, d.name);
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          return entries
            .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
            .map((e) => join(dir, e.name));
        } catch {
          return [];
        }
      }),
  );
  return perDir.flat();
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createIndexer(opts: IndexerOptions = {}): Indexer {
  const home = opts.home ?? homedir();
  const projectsRoot = opts.projectsRoot ?? join(home, '.claude', 'projects');
  const roots = opts.workspaces ?? resolveWorkspaces(DEFAULT_WORKSPACES, home);
  const runnerDir = join(home, '.claude-dashboard', 'runner');
  const findRepoRoot = opts.findRepoRoot ?? findGitRoot;
  const cache = new Map<string, CacheEntry>();

  async function build(
    filePath: string,
    size: number,
    mtime: Date,
    prevHac: HacProgress | undefined,
  ): Promise<Omit<CacheEntry, 'size' | 'mtimeMs'>> {
    const id = basename(filePath, '.jsonl');
    if (!SessionId.safeParse(id).success) return { session: null };

    const facts = await scanFile(filePath, size);
    // Metadata-only stubs have no prompt; runner sessions are not the user's.
    if (!facts.firstPrompt || !facts.firstCwd || isUnder(facts.firstCwd, runnerDir)) {
      return { session: null };
    }

    const cwd = facts.firstCwd;
    const workspace = workspaceOf(cwd, roots);
    // hac calls can be anywhere in the file, so Work transcripts get a full pass (ADR 0036).
    const hac =
      workspace.kind === 'work' ? await scanHac(filePath, size, prevHac ?? null) : undefined;
    const env = hac ? topEnv(hac.tally) : null;
    const ticketKey = ticketKeyOf(facts.lastBranch);
    const lastActivity = facts.lastMessageAt ?? mtime.getTime();
    const parsed = Session.safeParse({
      id,
      filePath,
      cwd,
      workspace: workspace.id,
      repo: repoOf(cwd, roots, findRepoRoot),
      branch: facts.lastBranch,
      branchesSeen: facts.branchesSeen,
      ticketKey,
      env,
      category: categoryOf(ticketKey, env),
      title: titleOf(facts),
      customTitle: facts.customTitle,
      createdAt: new Date(facts.firstMessageAt ?? lastActivity).toISOString(),
      lastActivityAt: new Date(lastActivity).toISOString(),
    });
    return { session: parsed.success ? parsed.data : null, hac };
  }

  async function indexOne(filePath: string): Promise<Session | null> {
    let st;
    try {
      st = await stat(filePath);
    } catch {
      return null; // removed between listing and stat
    }
    const hit = cache.get(filePath);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.session;
    let built;
    try {
      built = await build(filePath, st.size, st.mtime, hit?.hac);
    } catch {
      return null; // unreadable right now; not cached, so the next scan retries
    }
    cache.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, ...built });
    return built.session;
  }

  return {
    async index() {
      const files = await listTranscripts(projectsRoot);
      const live = new Set(files);
      for (const path of cache.keys()) if (!live.has(path)) cache.delete(path);
      const sessions = await mapLimit(files, CONCURRENCY, indexOne);
      return sessions
        .filter((s): s is Session => s !== null)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    },
  };
}
