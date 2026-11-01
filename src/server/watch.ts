import { join, sep } from 'node:path';
import { watch } from 'chokidar';

export interface ProjectsWatcherOptions {
  projectsRoot: string;
  /** Folders under projectsRoot whose changes are ignored (the runner's transcript folder). */
  ignore?: string[];
  /** Window that collapses a burst of changes into one call. */
  batchMs?: number;
  onChange: () => void;
  onError?: (err: unknown) => void;
}

export interface ProjectsWatcher {
  /** Resolves once the initial tree is read and changes are being reported. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/** Folder name Claude Code gives a cwd under ~/.claude/projects: every non-alphanumeric → "-". */
export function projectFolderName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Transcript folder of sessions run from the headless runner, inside `projectsRoot`. */
export function runnerProjectFolder(projectsRoot: string, home: string): string {
  return join(projectsRoot, projectFolderName(join(home, '.claude-dashboard', 'runner')));
}

/**
 * Calls `fn` once, `ms` after the first of a burst of calls. Unlike a trailing debounce it
 * never starves while a session keeps writing, so new sessions still show within `ms` (ADR 0015).
 */
export function batch(fn: () => void, ms: number): { (): void; cancel(): void } {
  let timer: NodeJS.Timeout | null = null;
  const call = () => {
    timer ??= setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
  call.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return call;
}

/** Watches `<root>/*\/*.jsonl`, the same files the indexer lists. */
export function watchProjects(opts: ProjectsWatcherOptions): ProjectsWatcher {
  const ignored = (opts.ignore ?? []).map((p) => p.replace(/[/\\]+$/, ''));
  const isIgnored = (path: string) => ignored.some((p) => path === p || path.startsWith(p + sep));
  const notify = batch(opts.onChange, opts.batchMs ?? 500);

  const watcher = watch(opts.projectsRoot, {
    ignoreInitial: true,
    // root (0) → project folders (1) → their files; <id>/subagents/ is never watched.
    depth: 1,
    ignored: isIgnored,
  });
  watcher.on('all', (_event, path) => {
    if (path.endsWith('.jsonl') && !isIgnored(path)) notify();
  });
  watcher.on('error', (err) => (opts.onError ?? console.warn)(err));

  const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  return {
    ready,
    async close() {
      notify.cancel();
      await watcher.close();
    },
  };
}
