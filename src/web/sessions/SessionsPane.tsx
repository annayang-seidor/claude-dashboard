import { useEffect, useEffectEvent, useState } from 'react';
import {
  BulkTrashResponse,
  NewSessionResponse,
  ResumeResponse,
  TrashResponse,
  type ApiSession,
  type NewSessionBody,
} from '../../shared/api';
import { BULK_MAX_IDS, CLAUDE_CLEANUP_DEFAULT_DAYS } from '../../shared/config';
import type { Workspace } from '../../shared/session';
import { ApiError, api } from '../api';
import { useConfig, workspaceById } from '../config';
import { Inbox } from '../jira/Inbox';
import type { JiraInboxData } from '../jira/useJiraInbox';
import { useI18n } from '../i18n';
import { useNow } from '../useNow';
import { useAccessLost } from '../shell/AccessLost';
import { ErrorNote } from '../shell/ErrorBoundary';
import { Toast, ToastContext, useToast } from '../shell/Toast';
import { useAutoArchived } from './autoArchive';
import { CleanupModal } from './CleanupModal';
import type { OnNewSession } from './NewSessionButton';
import { PersonalList } from './PersonalList';
import { firstBookmarkNote, RetentionContext, useRetention } from './retention';
import type { JiraTitleMap } from './model';
import { useSessions, type SessionEdit } from './useSessions';
import { WorkList } from './WorkList';

/** Long enough to read two sentences, or to notice a note shown as the page loads. */
const NOTE_MS = 12_000;

type BulkResult = BulkTrashResponse['results'][number];

/** Runs a bulk route in chunks of BULK_MAX_IDS. A chunk whose request fails counts each of its
 * ids as failed, so the caller can still show the rest. */
async function bulk(action: 'trash' | 'restore', ids: readonly string[]): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (let i = 0; i < ids.length; i += BULK_MAX_IDS) {
    const chunk = ids.slice(i, i + BULK_MAX_IDS);
    try {
      const reply = await api(`/api/sessions/${action}`, BulkTrashResponse, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chunk }),
      });
      results.push(...reply.results);
    } catch {
      results.push(...chunk.map((id) => ({ id, ok: false, error: 'failed' as const })));
    }
  }
  return results;
}

/** The page's columns below the header: on Work the inbox and the session list share the
 * sessions, the launch calls and the toast (ADR 0044). */
export function SessionsPane({
  workspace,
  query,
  titles,
  inbox,
}: {
  workspace: Workspace;
  query: string;
  /** Jira titles for Work ticket groups. */
  titles?: JiraTitleMap;
  /** The Jira inbox; Work only. */
  inbox?: JiraInboxData;
}) {
  const { t } = useI18n();
  const config = useConfig();
  const { kind } = workspaceById(config, workspace);
  const { sessions, loadFailed, reload, saveFailed, edit, drop, hide, unhide } =
    useSessions(workspace);
  const cleanupPeriodDays = useRetention();
  // A refused token gets the AccessLost banner instead; Retry could not help.
  const accessLost = useAccessLost();
  const now = useNow();
  const { toast, show, dismiss } = useToast();
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const autoArchived = useAutoArchived(workspace);

  // The first bookmark in this browser explains what a bookmark does not protect against. Skipped
  // when Claude Code's cleanup is off (null); shown while that is still unknown (undefined). A
  // failed rename rolls back in useSessions and says so here.
  const editWithNote = (id: string, change: SessionEdit) => {
    // The title shown before the change is the one the row goes back to.
    const before = sessions?.find((x) => x.id === id)?.title ?? '';
    edit(
      id,
      change,
      change.title === undefined
        ? undefined
        : () => show({ text: t('toast.renameFailed', { title: before }), tone: 'error' }),
    );
    if (change.bookmarked && cleanupPeriodDays !== null && firstBookmarkNote()) {
      show({
        text: t('retention.bookmarkNote', { n: cleanupPeriodDays ?? CLAUDE_CLEANUP_DEFAULT_DAYS }),
        tone: 'info',
        ms: NOTE_MS,
      });
    }
  };
  const launchFailed = () => show({ text: t('toast.launchFailed'), tone: 'error' });

  const resume = (s: ApiSession) => {
    api(`/api/sessions/${s.id}/resume`, ResumeResponse, { method: 'POST' }).catch((err) => {
      if (err instanceof ApiError && err.status === 410) gone(s);
      else launchFailed();
    });
  };
  const gone = (s: ApiSession) => {
    drop(s.id);
    show({ text: t('toast.resumeGone', { title: s.title }), tone: 'error' });
  };

  // The row hides at once; the toast offers Undo only once the files are in the trash.
  const remove = (s: ApiSession) => {
    hide(s.id);
    api(`/api/sessions/${s.id}/trash`, TrashResponse, { method: 'POST' }).then(
      () =>
        show({
          text: t('toast.deletedOne', { title: s.title }),
          tone: 'info',
          ms: config.undoMs,
          undo: { label: t('toast.undo'), onClick: () => restore(s) },
        }),
      (err) => {
        if (err instanceof ApiError && err.status === 404) return gone(s);
        unhide(s.id);
        show({ text: t('toast.deleteFailed', { title: s.title }), tone: 'error' });
      },
    );
  };
  // The server announces the restore on /api/events, and the refetch brings the row back.
  const restore = (s: ApiSession) => {
    api(`/api/sessions/${s.id}/restore`, TrashResponse, { method: 'POST' }).then(
      () => unhide(s.id),
      () => show({ text: t('toast.restoreFailed', { title: s.title }), tone: 'error' }),
    );
  };

  // Clean up: rows hide at once; Undo restores every id that reached the trash.
  const removeMany = (list: readonly ApiSession[]) => {
    const ids = list.map((s) => s.id);
    ids.forEach(hide);
    void bulk('trash', ids).then((results) => {
      const moved: string[] = [];
      let failed = 0;
      for (const r of results) {
        if (r.ok) moved.push(r.id);
        else if (r.error === 'not-found') drop(r.id);
        else {
          failed++;
          unhide(r.id);
        }
      }
      if (!moved.length) {
        if (failed) show({ text: t('toast.deleteManyFailed', { n: failed }), tone: 'error' });
        return;
      }
      show({
        text: failed
          ? t('toast.deletedSomeFailed', { n: moved.length, failed })
          : t('toast.deletedMany', { n: moved.length }),
        tone: failed ? 'error' : 'info',
        ms: config.undoMs,
        undo: { label: t('toast.undo'), onClick: () => restoreMany(moved) },
      });
    });
  };
  // An id already restored elsewhere (not-found) needs no message.
  const restoreMany = (ids: readonly string[]) => {
    void bulk('restore', ids).then((results) => {
      results.filter((r) => r.ok).forEach((r) => unhide(r.id));
      const failed = results.filter((r) => !r.ok && r.error !== 'not-found').length;
      if (failed) show({ text: t('toast.restoreManyFailed', { n: failed }), tone: 'error' });
    });
  };

  // "N scratch sessions moved to trash · Undo", once per auto-archive run (ADR 0037).
  const showArchived = useEffectEvent((ids: string[]) => {
    const one = ids.length === 1;
    const key = kind === 'work' ? 'scratchArchived' : 'idleArchived';
    show({
      text: t(`toast.${key}${one ? 'One' : ''}`, { n: ids.length }),
      tone: 'info',
      ms: NOTE_MS,
      undo: { label: t('toast.undo'), onClick: () => restoreMany(ids) },
    });
  });
  useEffect(() => {
    if (autoArchived) showArchived(autoArchived);
  }, [autoArchived]);

  const newSession: OnNewSession = (ticketKey, name) =>
    api(`/api/tickets/${encodeURIComponent(ticketKey)}/new-session`, NewSessionResponse, {
      method: 'POST',
      ...(name && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name } satisfies NewSessionBody),
      }),
    }).then(
      () => true,
      () => {
        launchFailed();
        return false;
      },
    );

  return (
    <RetentionContext value={cleanupPeriodDays}>
      <ToastContext value={show}>
        {inbox && (
          <Inbox
            inbox={inbox}
            sessions={sessions}
            now={now}
            onSync={inbox.sync}
            onResume={resume}
            onNewSession={newSession}
          />
        )}
        <main className="page__main">
          {loadFailed && !accessLost && <ErrorNote text={t('list.loadFailed')} onRetry={reload} />}
          {sessions &&
            (kind === 'work' ? (
              <WorkList
                sessions={sessions}
                query={query}
                now={now}
                titles={titles}
                onEdit={editWithNote}
                onResume={resume}
                onDelete={remove}
                onNewSession={newSession}
                onCleanup={() => setCleanupOpen(true)}
              />
            ) : (
              <PersonalList
                sessions={sessions}
                query={query}
                now={now}
                onEdit={editWithNote}
                onResume={resume}
                onDelete={remove}
                onCleanup={() => setCleanupOpen(true)}
              />
            ))}
          {cleanupOpen && sessions && (
            <CleanupModal
              workspace={workspace}
              sessions={sessions}
              now={now}
              onClose={() => setCleanupOpen(false)}
              onConfirm={removeMany}
            />
          )}
        </main>
        {toast && <Toast toast={toast} onDismiss={dismiss} />}
        <div role="status" className="visually-hidden">
          {saveFailed ? t('list.saveFailed') : ''}
        </div>
      </ToastContext>
    </RetentionContext>
  );
}
