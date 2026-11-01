import { useCallback, useEffect, useState } from 'react';
import { JiraInboxResponse, SESSIONS_CHANGED } from '../../shared/api';
import { api, subscribeEvents } from '../api';

export interface JiraInboxData extends JiraInboxResponse {
  /** A GET or sync has answered at least once. */
  loaded: boolean;
  /** POST sync is in flight. */
  syncing: boolean;
  /** Runs a sync now (the header's Sync button), whatever the time. */
  sync: () => void;
}

const EMPTY: JiraInboxResponse = { result: null, lastAttempt: null, jiraBaseUrl: null };

/** The last good Jira inbox and how the last sync went (ADR 0042), refetched on
 * `sessions-changed`: the server sends one after every sync. Off on Personal, which has no Jira. */
export function useJiraInbox(enabled: boolean): JiraInboxData {
  const [data, setData] = useState<JiraInboxResponse | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    let latest = 0;
    const load = () => {
      const n = ++latest;
      // A failed load keeps what is shown; the sync status says how the last sync went.
      api('/api/jira/inbox', JiraInboxResponse, { signal: abort.signal }).then(
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

  const sync = useCallback(() => {
    setSyncing(true);
    api('/api/jira/inbox/sync', JiraInboxResponse, { method: 'POST' })
      .then(setData, () => {})
      .finally(() => setSyncing(false));
  }, []);

  return enabled
    ? { ...(data ?? EMPTY), loaded: data !== null, syncing, sync }
    : { ...EMPTY, loaded: false, syncing: false, sync };
}
