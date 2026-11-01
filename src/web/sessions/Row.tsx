import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ApiEnv, ApiSession } from '../../shared/api';
import { idleSince } from '../../shared/cleanup';
import { useConfig, useWorkspaceConfig } from '../config';
import type { Category } from '../../shared/session';
import { SESSION_TITLE_MAX } from '../../shared/state';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';
import { useCleanupPeriodDays } from './retention';
import { RowMenu } from './RowMenu';
import { claudeCleanupWarning, daysUntilTrash, whenLabels } from './time';
import type { SessionEdit } from './useSessions';

export type OnEdit = (id: string, edit: SessionEdit) => void;
export type OnResume = (session: ApiSession) => void;
export type OnDelete = (session: ApiSession) => void;

/** "Moves to trash in N days" or "Bookmarked, kept" for rows auto-archive can trash, counted like
 * the job does: from the later of last activity and a restore, against the session's workspace
 * `autoArchiveDays`. Hidden while auto-archive is off (`autoArchive.enabled`). */
export function TrashNote({ session, now }: { session: ApiSession; now: Date }) {
  const { t } = useI18n();
  const { autoArchive } = useConfig();
  const { autoArchiveDays } = useWorkspaceConfig(session.workspace);
  if (!autoArchive.enabled) return null;
  if (session.state.bookmarked) return <span>{t('list.bookmarkedKept')}</span>;
  const n = daysUntilTrash(idleSince(session), now, autoArchiveDays);
  if (n <= 0) return <span>{t('list.trashSoon')}</span>;
  return <span>{n === 1 ? t('list.trashInOne') : t('list.trashIn', { n })}</span>;
}

/** "Claude Code removes this in N days" on bookmarked rows near Claude Code's own cleanup. The
 * icon is decoration; the text carries the warning. */
export function RetentionNote({ session, now }: { session: ApiSession; now: Date }) {
  const { t } = useI18n();
  const { retentionWarnDays } = useConfig();
  const n = claudeCleanupWarning(session, now, useCleanupPeriodDays(), retentionWarnDays);
  if (n === null) return null;
  return (
    <span className="row__warn">
      <Icon name="alert-triangle" size={13} />
      {n <= 0
        ? t('retention.removesSoon')
        : n === 1
          ? t('retention.removesInOne')
          : t('retention.removesIn', { n })}
    </span>
  );
}

/** `[P1]` before Ops titles. Prod is bold terracotta, others beige; the text always says which
 * env, and screen readers also hear "(production)". */
export function EnvTag({ env }: { env: ApiEnv }) {
  const { t } = useI18n();
  return (
    <span className="env-tag" data-prod={env.prod} title={env.project ?? undefined}>
      [{env.display}]{env.prod && <span className="visually-hidden"> {t('row.prodSuffix')}</span>}
    </span>
  );
}

export interface Rename {
  active: boolean;
  start: () => void;
  /** `title` is the input's text, or null to cancel. */
  finish: (title: string | null, refocus: boolean) => void;
  /** The row's ⋯ button, where focus goes back after Enter or Esc. */
  menuButton: RefObject<HTMLButtonElement | null>;
}

/** Rename state shared by the row's title and its ⋯ menu. Saves only a change: an empty value
 * clears the dashboard rename (the server trims too). */
function useRename(session: ApiSession, onEdit: OnEdit): Rename {
  const [active, setActive] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const finish = (title: string | null, refocus: boolean) => {
    setActive(false);
    const value = title?.trim();
    if (value !== undefined && value !== session.title && (value || session.state.title)) {
      onEdit(session.id, { title: value || null });
    }
    // Clicking away leaves focus where the click put it.
    if (refocus) menuButton.current?.focus();
  };
  return { active, start: () => setActive(true), finish, menuButton };
}

/** The title as an input, text selected. Enter or blur saves, Esc cancels; the hint names the
 * automatic title an empty value brings back. */
function RenameField({ session, rename }: { session: ApiSession; rename: Rename }) {
  const { t } = useI18n();
  const [value, setValue] = useState(session.title);
  const input = useRef<HTMLInputElement>(null);
  // Enter or Esc moves focus to ⋯, and the blur that follows must not save again.
  const done = useRef(false);
  const hintId = useId();
  useEffect(() => input.current?.select(), []);

  // Only an automatic title can start out longer than the input allows.
  const tooLong = value.trim().length > SESSION_TITLE_MAX;
  const end = (save: boolean, refocus: boolean) => {
    if (done.current || (save && tooLong && refocus)) return;
    done.current = true;
    rename.finish(save && !tooLong ? value : null, refocus);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    end(e.key === 'Enter', true);
  };
  return (
    <span className="rename">
      <input
        ref={input}
        className="menu__field rename__field"
        value={value}
        maxLength={Math.max(SESSION_TITLE_MAX, session.title.length)}
        autoFocus
        autoComplete="off"
        aria-label={t('row.titleLabel')}
        aria-describedby={hintId}
        aria-invalid={tooLong}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => end(true, false)}
      />
      <span id={hintId} className="menu__note">
        {tooLong
          ? t('row.titleTooLong', { n: SESSION_TITLE_MAX })
          : t('row.titleHint', { title: session.autoTitle })}
      </span>
    </span>
  );
}

/** Row title with the env tag on Ops rows; a double-click on the text renames. */
function Title({ session, rename }: { session: ApiSession; rename: Rename }) {
  return (
    <div className="row__title" data-done={session.state.status === 'done'}>
      {session.category === 'ops' && session.env && <EnvTag env={session.env} />}
      {rename.active ? (
        <RenameField session={session} rename={rename} />
      ) : (
        <span onDoubleClick={rename.start}>{session.title}</span>
      )}
    </div>
  );
}

/** Status select, bookmark toggle, Resume, Delete and the ⋯ menu. `idPrefix` keeps select ids
 * unique per view. */
function Controls({
  session,
  onEdit,
  onResume,
  onDelete,
  idPrefix,
  rename,
}: {
  session: ApiSession;
  onEdit: OnEdit;
  onResume: OnResume;
  onDelete: OnDelete;
  idPrefix: string;
  rename: Rename;
}) {
  const { t } = useI18n();
  const { status, bookmarked } = session.state;
  const selectId = `${idPrefix}-${session.id}`;
  return (
    <>
      <label htmlFor={selectId} className="visually-hidden">
        {t('row.status')}
      </label>
      <span className="status" data-status={status}>
        <Icon
          name={status === 'done' ? 'check-circle' : 'circle'}
          size={14}
          className="status__icon"
        />
        <select
          id={selectId}
          className="status__select"
          value={status}
          onChange={(e) => onEdit(session.id, { status: e.target.value as 'todo' | 'done' })}
        >
          <option value="todo">{t('row.statusOpen')}</option>
          <option value="done">{t('row.statusDone')}</option>
        </select>
        <Icon name="chevron-down" size={14} className="status__chev" />
      </span>
      <button
        type="button"
        className="ib icon-btn icon-btn--bookmark"
        aria-pressed={bookmarked}
        aria-label={t('row.bookmark')}
        title={bookmarked ? t('row.bookmarkOn') : t('row.bookmarkOff')}
        onClick={() => onEdit(session.id, { bookmarked: !bookmarked })}
      >
        <Icon
          name="bookmark"
          fill={bookmarked ? 'var(--c-scratch)' : 'none'}
          stroke={bookmarked ? 'var(--c-bookmark-stroke)' : 'currentColor'}
        />
      </button>
      <button
        type="button"
        className="ib ib-play icon-btn icon-btn--play"
        aria-label={t('row.resume')}
        title={t('row.resume')}
        onClick={() => onResume(session)}
      >
        <Icon name="play" />
      </button>
      <button
        type="button"
        className="ib icon-btn icon-btn--delete"
        aria-label={t('row.delete')}
        title={t('row.delete')}
        onClick={() => onDelete(session)}
      >
        <Icon name="trash-2" />
      </button>
      <RowMenu
        session={session}
        onEdit={onEdit}
        onRename={rename.start}
        buttonRef={rename.menuButton}
      />
    </>
  );
}

interface RowProps {
  session: ApiSession;
  now: Date;
  onEdit: OnEdit;
  onResume: OnResume;
  onDelete: OnDelete;
  /** Shown before the time, as "main · Sun 15:10" (Personal). */
  branch?: string | null;
  /** Shown after the time: the trash note on Scratch rows. */
  after?: ReactNode;
}

/** A row inside a group (By ticket view and Personal). */
export function GroupRow({ session, now, onEdit, onResume, onDelete, branch, after }: RowProps) {
  const { messages } = useI18n();
  const { time } = whenLabels(session.lastActivityAt, now, messages);
  const rename = useRename(session, onEdit);
  return (
    <div className="row" data-testid="session-row">
      <div className="row__body">
        <Title session={session} rename={rename} />
        <div className="row__meta">
          <span>
            {branch && (
              <>
                <span className="mono row__branch">{branch}</span> ·{' '}
              </>
            )}
            {time}
          </span>
          {after}
          <RetentionNote session={session} now={now} />
        </div>
      </div>
      <Controls
        session={session}
        onEdit={onEdit}
        onResume={onResume}
        onDelete={onDelete}
        idPrefix="st"
        rename={rename}
      />
    </div>
  );
}

interface TimelineRowProps {
  session: ApiSession;
  now: Date;
  onEdit: OnEdit;
  onResume: OnResume;
  onDelete: OnDelete;
  kind: Category;
  /** The group's key tag ("FA-554", "scratch") and title. */
  groupKey: string;
  groupTitle: string;
  /** Ops groups: shown as the key tag instead of `groupKey`. */
  groupEnv?: ApiEnv | null;
}

export function TimelineRow({
  session,
  now,
  onEdit,
  onResume,
  onDelete,
  kind,
  groupKey,
  groupTitle,
  groupEnv,
}: TimelineRowProps) {
  const { messages } = useI18n();
  const { clock } = whenLabels(session.lastActivityAt, now, messages);
  const rename = useRename(session, onEdit);
  return (
    <div className="row row--timeline" data-testid="session-row">
      <span className={`swatch swatch--${kind}`} aria-hidden="true" />
      <span className="row__clock">{clock}</span>
      <div className="row__body">
        <Title session={session} rename={rename} />
        <div className="row__group">
          {groupEnv ? (
            <EnvTag env={groupEnv} />
          ) : (
            <span className={`key-chip key-chip--${kind}`}>{groupKey}</span>
          )}
          {groupTitle}
          <RetentionNote session={session} now={now} />
        </div>
      </div>
      <Controls
        session={session}
        onEdit={onEdit}
        onResume={onResume}
        onDelete={onDelete}
        idPrefix="st2"
        rename={rename}
      />
    </div>
  );
}
