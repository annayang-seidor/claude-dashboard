import { appendFile } from 'node:fs/promises';
import { autoArchiveRule, selectCleanup } from '../../shared/cleanup';
import { DEFAULT_WORKSPACES, type WorkspaceConfig } from '../../shared/config';
import type { Workspace } from '../../shared/session';
import type { SessionService } from '../sessions';
import type { StateStore } from '../state';
import type { Trash } from '../trash';

export interface AutoArchiveOptions {
  sessions: Pick<SessionService, 'list'>;
  trash: Pick<Trash, 'trash'>;
  state: Pick<StateStore, 'setAutoArchive'>;
  /** The configured workspaces and their idle days (ADR 0061). Defaults to the default config's. */
  workspaces?: readonly Pick<WorkspaceConfig, 'id' | 'kind' | 'autoArchiveDays'>[];
  /** ~/.claude-dashboard/activity.log: one JSON object per line (ADR 0037). */
  logPath: string;
  /** Called after a run that moved something, so open pages refetch. */
  onMoved?: () => void;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface AutoArchiveRun {
  moved: Record<Workspace, string[]>;
  failed: { id: string; error: string }[];
}

/**
 * Scratch auto-archive (spec § Cleanup): moves sessions idle past their workspace's
 * `autoArchiveDays` to the trash, bookmarked kept, with the same selection as the Clean up modal.
 * Runs as a daily job (ADR 0031); repeating it is safe, since a trashed session is no longer
 * listed.
 */
export function createAutoArchive(opts: AutoArchiveOptions): () => Promise<AutoArchiveRun> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[auto-archive] ${m}`));
  const workspaces = opts.workspaces ?? DEFAULT_WORKSPACES;

  return async function run() {
    const at = now();
    const result: AutoArchiveRun = {
      moved: Object.fromEntries(workspaces.map((w) => [w.id, []])),
      failed: [],
    };
    const titles: { id: string; workspace: Workspace; title: string }[] = [];

    for (const ws of workspaces) {
      const workspace = ws.id;
      const { selected } = selectCleanup(
        await opts.sessions.list(workspace),
        autoArchiveRule(ws, at),
      );
      for (const s of selected) {
        let error: string;
        try {
          const outcome = await opts.trash.trash(s.id);
          if (outcome.ok) {
            result.moved[workspace]!.push(s.id);
            titles.push({ id: s.id, workspace, title: s.title });
            continue;
          }
          error = outcome.error;
        } catch (err) {
          error = (err as Error).message;
        }
        result.failed.push({ id: s.id, error });
      }
    }

    const count = Object.values(result.moved).reduce((n, ids) => n + ids.length, 0);
    if (count) {
      await opts.state.setAutoArchive({ at: at.toISOString(), moved: result.moved });
      opts.onMoved?.();
    }
    if (count || result.failed.length) {
      log(`moved ${count} session(s) to the trash, ${result.failed.length} failed`);
    }
    const line = {
      at: at.toISOString(),
      job: 'auto-archive',
      moved: titles,
      failed: result.failed,
    };
    // The log holds session titles: owner-only. A failed write must not undo a finished run.
    await appendFile(opts.logPath, JSON.stringify(line) + '\n', { mode: 0o600 }).catch(
      (err: Error) => log(`cannot write ${opts.logPath}: ${err.message}`),
    );
    return result;
  };
}
