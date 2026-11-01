import { useCallback, useEffect, useState } from 'react';
import { JiraTitlesResponse, SESSIONS_CHANGED } from '../../shared/api';
import { api, subscribeEvents } from '../api';

export type JiraTitles = JiraTitlesResponse['titles'];

export interface JiraTitlesData {
  titles: JiraTitles;
  lastRun: JiraTitlesResponse['lastRun'];
  /** POST refresh is in flight. */
  refreshing: boolean;
  /** Fetches every key again (after `/mcp`, say). */
  refresh: () => void;
}

const EMPTY: JiraTitlesResponse = { titles: {}, lastRun: null };

/** Cached Jira titles for the Work page, refetched on `sessions-changed`: the server sends one
 * after a run that changed the cache (ADR 0039). Off on Personal, which has no Jira. */
export function useJiraTitles(enabled: boolean): JiraTitlesData {
  const [data, setData] = useState<JiraTitlesResponse>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    let latest = 0;
    const load = () => {
      const n = ++latest;
      // A failed load keeps what is shown: titles are extra, never a reason for an error note.
      api('/api/jira/titles', JiraTitlesResponse, { signal: abort.signal }).then(
        (res) => n === latest && setData(res),
        () => {},
      );
    };
    load();
    const unsubscribe = subscribeEvents((name) => name === SESSIONS_CHANGED && load(), load);
    return () => {
      unsubscribe();
      abort.abort();
    };
  }, [enabled]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    api('/api/jira/titles/refresh', JiraTitlesResponse, { method: 'POST' })
      .then(setData, () => {})
      .finally(() => setRefreshing(false));
  }, []);

  return enabled ? { ...data, refreshing, refresh } : { ...EMPTY, refreshing: false, refresh };
}
