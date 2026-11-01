import { useEffect, useRef, type ReactNode } from 'react';
import type { RunFailure } from '../../shared/api';
import { Icon } from '../Icon';
import { agoLabel } from '../sessions/time';
import { HTML_LANG, LANGS, useI18n } from '../i18n';
import { useConfig, useWorkspaceConfig, workspaceLabel } from '../config';
import { Link, workspacePath, type Workspace } from '../router';
import { useNarrow } from '../useNarrow';
import { isEditable, isSearchShortcut, shortcutHint } from './shortcuts';

interface HeaderProps {
  workspace: Workspace;
  query: string;
  onQuery: (query: string) => void;
  /** Sync status (Work only); filled once Jira sync exists. */
  sync?: ReactNode;
}

export function Header({ workspace, query, onQuery, sync }: HeaderProps) {
  const { t } = useI18n();
  return (
    <header className="hdr">
      <div className="brand">
        <img className="brand__logo" src="/clawd-sparkles.svg" alt="" width={36} height={36} />
        <h1 className="brand__title">{t('app.title')}</h1>
      </div>
      {sync}
      <div className="hdr__tools">
        <SearchBox workspace={workspace} query={query} onQuery={onQuery} />
        <div className="hdr__nav">
          <WorkspaceTabs current={workspace} />
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}

interface JiraSyncStatusProps {
  /** The last good sync; null before the first one. */
  syncedAt: string | null;
  /** Why the last sync failed, when it did (auth shows JiraLoginNote instead). */
  failure: Exclude<RunFailure, 'auth'> | null;
  /** A sync is running. */
  busy: boolean;
  onSync: () => void;
  now: Date;
}

/** Jira sync status in the header (ADR 0043): the prototype's refresh icon is the Sync button,
 * followed by "Jira synced N min ago", or by an error note that keeps the age of the results
 * still shown. The failure reason is the note's tooltip. */
export function JiraSyncStatus({ syncedAt, failure, busy, onSync, now }: JiraSyncStatusProps) {
  const { t, messages } = useI18n();
  const ago = syncedAt && agoLabel(syncedAt, now, messages);
  const button = (
    <button
      type="button"
      className="ib sync__retry"
      aria-label={t('header.jiraSyncNow')}
      title={t('header.jiraSyncNow')}
      disabled={busy}
      aria-busy={busy}
      onClick={onSync}
    >
      <Icon name="refresh-cw" size={13} className={busy ? 'spin' : undefined} />
    </button>
  );
  if (failure) {
    return (
      <div className="sync sync--warn" role="status" title={t(`header.jiraSyncReason.${failure}`)}>
        <Icon name="alert-triangle" size={13} />
        {button}
        {ago ? t('header.jiraSyncFailed', { ago }) : t('header.jiraSyncFailedEmpty')}
      </div>
    );
  }
  return (
    <div className="sync">
      {button}
      {ago ? t('header.jiraSynced', { ago }) : t('header.jiraNotSynced')}
    </div>
  );
}

/** Shown in the sync slot when the last Jira titles lookup or inbox sync needed the Rovo login
 * (ADR 0039, ADR 0043). The button syncs both again once the user has run /mcp. */
export function JiraLoginNote({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="sync sync--warn" role="status">
      <Icon name="alert-triangle" size={13} />
      {t('header.jiraLoginNeeded')}
      <button
        type="button"
        className="ib sync__retry"
        aria-label={t('header.jiraRetry')}
        title={t('header.jiraRetry')}
        disabled={busy}
        onClick={onRetry}
      >
        <Icon name="refresh-cw" size={13} />
      </button>
    </div>
  );
}

function SearchBox({ workspace, query, onQuery }: Omit<HeaderProps, 'sync'>) {
  const { t } = useI18n();
  const { kind } = useWorkspaceConfig(workspace);
  const input = useRef<HTMLInputElement>(null);
  const hint = shortcutHint(navigator.platform || navigator.userAgent);
  const narrow = useNarrow();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { key, metaKey, ctrlKey, altKey } = e;
      if (!isSearchShortcut({ key, metaKey, ctrlKey, altKey, inEditable: isEditable(e.target) })) {
        return;
      }
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="search">
      <Icon name="search" size={18} stroke="var(--c-text-muted)" />
      <label htmlFor="q" className="visually-hidden">
        {t('header.searchLabel')}
      </label>
      <input
        id="q"
        ref={input}
        type="search"
        className="search__input"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t(`header.${narrow ? 'searchPlaceholderShort' : 'searchPlaceholder'}.${kind}`)}
        aria-keyshortcuts={hint === '⌘K' ? 'Meta+K /' : 'Control+K /'}
        autoComplete="off"
        spellCheck={false}
      />
      <kbd className="kbd" title={t('header.searchShortcut', { keys: hint })}>
        {hint}
      </kbd>
    </div>
  );
}

function WorkspaceTabs({ current }: { current: Workspace }) {
  const { t, lang } = useI18n();
  const { workspaces } = useConfig();
  return (
    <nav aria-label={t('header.workspaceNav')} className="seg">
      {workspaces.map((ws) => (
        <Link
          key={ws.id}
          to={workspacePath(ws.id)}
          className="seg__item"
          aria-current={ws.id === current ? 'page' : undefined}
        >
          {workspaceLabel(ws, lang)} <span className="seg__path">{ws.root}</span>
        </Link>
      ))}
    </nav>
  );
}

function LanguageToggle() {
  const { t, lang, setLang } = useI18n();
  return (
    <div role="group" aria-label={t('header.language')} className="seg seg--lang">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className="seg__item"
          aria-pressed={l === lang}
          aria-label={t(`header.languageName.${l}`)}
          title={t(`header.languageName.${l}`)}
          lang={HTML_LANG[l]}
          onClick={() => setLang(l)}
        >
          {t(`header.languageShort.${l}`)}
        </button>
      ))}
    </div>
  );
}
