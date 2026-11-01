import { useEffect, useState } from 'react';
import { AutoArchiveResponse } from '../../shared/api';
import type { Workspace } from '../../shared/session';
import { api } from '../api';

const SEEN_KEY = 'claude-dashboard.autoArchiveSeen';

/** True unless this browser already showed the run at `at` for `workspace` (ADR 0037). Marks it
 * shown. localStorage can throw (privacy mode); then the note shows on each load, which is
 * harmless: Undo of ids no longer in the trash does nothing. */
function firstShowing(workspace: Workspace, at: string): boolean {
  const key = `${SEEN_KEY}.${workspace}`;
  try {
    if (localStorage.getItem(key) === at) return false;
    localStorage.setItem(key, at);
  } catch {
    // ignore
  }
  return true;
}

/** Ids the last auto-archive run moved from this workspace, once per run and browser; null when
 * there is nothing new to tell (or the load failed). */
export function useAutoArchived(workspace: Workspace): string[] | null {
  const [moved, setMoved] = useState<{ workspace: Workspace; ids: string[] } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api('/api/auto-archive', AutoArchiveResponse, { signal: abort.signal }).then(
      ({ last }) => {
        const ids = last?.moved[workspace] ?? [];
        if (last && ids.length && firstShowing(workspace, last.at)) setMoved({ workspace, ids });
      },
      () => {},
    );
    return () => abort.abort();
  }, [workspace]);
  return moved?.workspace === workspace ? moved.ids : null;
}
