import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ApiSession, JiraInboxResponse } from '../../shared/api';
import type { JiraInboxItem } from '../../shared/state';
import { Icon, type IconName } from '../Icon';
import { useI18n } from '../i18n';
import { agoLabel } from '../sessions/time';
import { jiraIssueUrl, primaryAction, splitInbox } from './inboxModel';

const KIND_ICON: Record<JiraInboxItem['kind'], IconName> = {
  assigned: 'user-check',
  mention: 'message-circle',
  pr: 'git-pull-request',
};

interface InboxProps {
  inbox: JiraInboxResponse & { loaded: boolean; syncing: boolean };
  /** Work sessions; null until loaded, when no primary action is offered yet. */
  sessions: readonly ApiSession[] | null;
  now: Date;
  onSync: () => void;
  onResume: (session: ApiSession) => void;
  onNewSession: (ticketKey: string) => void;
}

/** The Work page's left column: "Needs you", then the FYI section (spec § Inbox). Nothing here
 * posts to Jira; the actions only open a Claude Code session or the issue page. */
export function Inbox({ inbox, sessions, now, onSync, onResume, onNewSession }: InboxProps) {
  const { t } = useI18n();
  const headingId = useId();
  const { result, lastAttempt } = inbox;
  const { action, fyi } = splitInbox(result?.items ?? []);

  return (
    <aside className="inbox" aria-labelledby={headingId}>
      <div className="inbox__head">
        <Icon name="inbox" size={18} />
        <h2 id={headingId} className="inbox__title">
          {t('inbox.title')}
        </h2>
        {result && <span className="inbox__badge">{action.length}</span>}
      </div>
      {!inbox.loaded ? null : result ? (
        action.length ? (
          <NeedsYou
            items={action}
            labelledBy={headingId}
            sessions={sessions}
            baseUrl={inbox.jiraBaseUrl}
            now={now}
            onResume={onResume}
            onNewSession={onNewSession}
          />
        ) : (
          <div className="inbox__note">{t('inbox.empty')}</div>
        )
      ) : lastAttempt?.ok === false ? (
        <div role="alert" className="inbox__note inbox__note--error">
          <p>
            {lastAttempt.reason === 'auth' ? t('header.jiraLoginNeeded') : t('inbox.syncFailed')}
          </p>
          <button
            type="button"
            className="retry"
            disabled={inbox.syncing}
            aria-busy={inbox.syncing}
            onClick={onSync}
          >
            <Icon name="refresh-cw" size={14} />
            {t('header.jiraRetry')}
          </button>
        </div>
      ) : (
        <div className="inbox__note">{t('inbox.notSynced')}</div>
      )}
      {fyi.length > 0 && <Fyi items={fyi} />}
    </aside>
  );
}

function NeedsYou({
  items,
  labelledBy,
  sessions,
  baseUrl,
  now,
  onResume,
  onNewSession,
}: {
  items: JiraInboxItem[];
  labelledBy: string;
  sessions: readonly ApiSession[] | null;
  baseUrl: string | null;
  now: Date;
  onResume: (session: ApiSession) => void;
  onNewSession: (ticketKey: string) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  // Roving focus: one item is in the Tab order; the arrow keys move between items.
  const [active, setActive] = useState(0);
  const current = Math.min(active, items.length - 1);

  const run = (item: JiraInboxItem) => {
    if (!sessions) return;
    const next = primaryAction(item.key, sessions);
    if (next.kind === 'resume') onResume(next.session);
    else onNewSession(item.key);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const li = (e.target as HTMLElement).closest('li');
    const rows = [...(list.current?.children ?? [])] as HTMLElement[];
    const from = li ? rows.indexOf(li) : -1;
    if (from < 0) return;
    const to =
      e.key === 'ArrowDown'
        ? Math.min(from + 1, rows.length - 1)
        : e.key === 'ArrowUp'
          ? Math.max(from - 1, 0)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : null;
    if (to !== null) {
      e.preventDefault();
      setActive(to);
      rows[to]?.focus();
    } else if (e.key === 'Enter' && e.target === li) {
      // Enter on a button inside the item is that button's own click.
      e.preventDefault();
      run(items[from]!);
    }
  };

  return (
    // Routes arrow keys and Enter from the focusable items inside.
    <ul ref={list} className="inbox__list" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {items.map((item, i) => (
        <InboxItem
          key={item.key}
          item={item}
          action={sessions ? primaryAction(item.key, sessions).kind : null}
          baseUrl={baseUrl}
          now={now}
          tabIndex={i === current ? 0 : -1}
          onFocus={() => setActive(i)}
          onPrimary={() => run(item)}
        />
      ))}
    </ul>
  );
}

function InboxItem({
  item,
  action,
  baseUrl,
  now,
  tabIndex,
  onFocus,
  onPrimary,
}: {
  item: JiraInboxItem;
  action: 'new' | 'resume' | null;
  baseUrl: string | null;
  now: Date;
  tabIndex: number;
  onFocus: () => void;
  onPrimary: () => void;
}) {
  const { t, messages } = useI18n();
  const id = useId();
  const openLabel = t('inbox.openInJira');
  return (
    <li
      className="inbox__item"
      tabIndex={tabIndex}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-meta ${id}-reason`}
      onFocus={onFocus}
    >
      <div className={`inbox__tile inbox__tile--${item.kind}`}>
        <Icon name={KIND_ICON[item.kind]} size={16} />
      </div>
      <div className="inbox__body">
        <div id={`${id}-meta`} className="inbox__meta">
          {t('inbox.meta', {
            kind: t(`inbox.kind.${item.kind}`),
            ago: agoLabel(item.lastRelevantAt, now, messages),
          })}
        </div>
        <div id={`${id}-title`}>
          <span className="inbox__key">{item.key}</span> {item.title}
        </div>
        <div id={`${id}-reason`} className="inbox__reason">
          {item.reason}
        </div>
        <div className="inbox__actions">
          {action && (
            <button
              type="button"
              className={`inbox__act inbox__act--${action}`}
              onClick={onPrimary}
            >
              <Icon name={action === 'new' ? 'plus' : 'play'} size={14} />
              {t(action === 'new' ? 'inbox.newSession' : 'inbox.resumeSession')}
            </button>
          )}
          {baseUrl ? (
            <a
              className="ib inbox__jira"
              href={jiraIssueUrl(baseUrl, item.key)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={openLabel}
              title={openLabel}
            >
              <Icon name="external-link" size={15} />
            </a>
          ) : (
            // Focusable, so the tooltip explaining the missing setting can still be read.
            <button
              type="button"
              className="inbox__jira"
              aria-disabled="true"
              aria-label={openLabel}
              title={t('inbox.openInJiraUnset')}
            >
              <Icon name="external-link" size={15} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Fyi({ items }: { items: JiraInboxItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="fyi">
      <button
        type="button"
        className="ib fyi__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Icon name="filter" size={15} />
        <span>{t('inbox.fyi', { n: items.length })}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="fyi__chevron" />
      </button>
      {open && (
        <ul id={panelId} className="fyi__list">
          {items.map((item) => (
            <li key={item.key} className="fyi__row">
              <div className="fyi__key">
                <span className="mono">{item.key}</span> {item.title}
              </div>
              <div className="fyi__reason">{item.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
