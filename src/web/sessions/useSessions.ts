import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiSession,
  SESSIONS_CHANGED,
  SessionsResponse,
  type ApiSessionState,
  type SessionPatchBody,
} from '../../shared/api';
import type { Workspace } from '../../shared/session';
import { api, subscribeEvents } from '../api';

/** Status, bookmark and title show at once; the row menu's other fields wait for the server,
 * which derives category and env from them. */
export type SessionEdit = Partial<Pick<ApiSessionState, 'status' | 'bookmarked'>> &
  Pick<
    SessionPatchBody,
    'categoryOverride' | 'envOverride' | 'releaseLabel' | 'ticketOverride' | 'title'
  >;

interface Pending {
  seq: number;
  edit: SessionEdit;
}

export interface SessionsData {
  /** null until the first load finishes. */
  sessions: ApiSession[] | null;
  loadFailed: boolean;
  /** Loads the list again, e.g. from the Retry button after a failed load. */
  reload: () => void;
  /** The last edit failed and was rolled back; cleared by the next successful edit. */
  saveFailed: boolean;
  /** Shows the change at once, then PATCHes; a failed PATCH drops the change again and calls
   * `onFail`. */
  edit: (id: string, edit: SessionEdit, onFail?: () => void) => void;
  /** Removes a session from the list at once, e.g. after the server said its file is gone. */
  drop: (id: string) => void;
  /** Hides a row until `unhide`, whatever the server lists: Delete hides at once, Undo or a
   * failed delete shows it again. */
  hide: (id: string) => void;
  unhide: (id: string) => void;
}

/** Sessions of one workspace, refetched on every `sessions-changed` event (ADR 0013, ADR 0041). */
export function useSessions(workspace: Workspace): SessionsData {
  const [loaded, setLoaded] = useState<{ workspace: Workspace; sessions: ApiSession[] } | null>(
    null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Unsaved edits sit on top of the server list, so a refetch mid-PATCH does not undo them.
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const editSeq = useRef(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    const abort = new AbortController();
    let latest = 0;
    const load = () => {
      const n = ++latest;
      api(`/api/sessions?workspace=${workspace}`, SessionsResponse, { signal: abort.signal }).then(
        ({ sessions }) => {
          if (n !== latest) return;
          setLoaded({ workspace, sessions });
          setLoadFailed(false);
        },
        () => {
          if (n === latest && !abort.signal.aborted) setLoadFailed(true);
        },
      );
    };
    loadRef.current = load;
    load();
    // A reconnect refetches too: changes made while the stream was down sent no event.
    const unsubscribe = subscribeEvents((name) => name === SESSIONS_CHANGED && load(), load);
    return () => {
      unsubscribe();
      abort.abort();
    };
  }, [workspace]);

  const edit = useCallback((id: string, change: SessionEdit, onFail?: () => void) => {
    const seq = ++editSeq.current;
    setPending((p) => ({ ...p, [id]: { seq, edit: { ...p[id]?.edit, ...change } } }));
    const settle = () =>
      setPending((p) => {
        if (p[id]?.seq !== seq) return p;
        const rest = { ...p };
        delete rest[id];
        return rest;
      });
    api(`/api/sessions/${id}`, ApiSession, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    }).then(
      (updated) => {
        setLoaded(
          (l) => l && { ...l, sessions: l.sessions.map((s) => (s.id === id ? updated : s)) },
        );
        setSaveFailed(false);
        settle();
      },
      () => {
        setSaveFailed(true);
        settle();
        onFail?.();
      },
    );
  }, []);

  const reload = useCallback(() => loadRef.current(), []);

  const drop = useCallback((id: string) => {
    setLoaded((l) => l && { ...l, sessions: l.sessions.filter((s) => s.id !== id) });
  }, []);

  const hide = useCallback((id: string) => setHidden((h) => new Set(h).add(id)), []);
  const unhide = useCallback(
    (id: string) =>
      setHidden((h) => {
        const next = new Set(h);
        next.delete(id);
        return next;
      }),
    [],
  );

  const sessions = useMemo(() => {
    if (!loaded || loaded.workspace !== workspace) return null;
    return loaded.sessions
      .filter((s) => !hidden.has(s.id))
      .map((s) => {
        const p = pending[s.id];
        if (!p) return s;
        const { status = s.state.status, bookmarked = s.state.bookmarked } = p.edit;
        const shown = { ...s, state: { ...s.state, status, bookmarked } };
        if (p.edit.title === undefined) return shown;
        // An empty rename clears it, as the server does.
        const title = p.edit.title?.trim() || undefined;
        return { ...shown, title: title ?? s.autoTitle, state: { ...shown.state, title } };
      });
  }, [loaded, pending, hidden, workspace]);

  return { sessions, loadFailed, reload, saveFailed, edit, drop, hide, unhide };
}
