import { createContext, useContext, useEffect, useState } from 'react';
import { RetentionResponse } from '../../shared/api';
import { api } from '../api';

/** Claude Code's cleanupPeriodDays: undefined until loaded (or when the load failed), null when
 * its cleanup is off. Rows read it to warn on bookmarks Claude Code is about to delete. */
export const RetentionContext = createContext<number | null | undefined>(undefined);

export const useCleanupPeriodDays = () => useContext(RetentionContext);

/** Loads GET /api/retention once. A failed load shows no warnings rather than wrong ones. */
export function useRetention(): number | null | undefined {
  const [days, setDays] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    api('/api/retention', RetentionResponse, { signal: abort.signal }).then(
      (r) => setDays(r.cleanupPeriodDays),
      () => {},
    );
    return () => abort.abort();
  }, []);
  return days;
}

const NOTE_SEEN_KEY = 'claude-dashboard.bookmarkNoteSeen';

/** True the first time it is called in this browser; the one-time bookmark note uses it.
 * localStorage can throw (privacy mode); then the note shows each time, which is harmless. */
export function firstBookmarkNote(): boolean {
  try {
    if (localStorage.getItem(NOTE_SEEN_KEY)) return false;
    localStorage.setItem(NOTE_SEEN_KEY, '1');
  } catch {
    // ignore
  }
  return true;
}
