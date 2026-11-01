import { useMemo, useState } from 'react';
import type { ApiSession } from '../../shared/api';
import { isLocal } from '../../shared/env';
import { useConfig, useWorkspaceConfig } from '../config';
import { Icon, type IconName } from '../Icon';
import { useI18n } from '../i18n';
import {
  groupWork,
  matchesQuery,
  matchesStatus,
  matchesType,
  normalizeQuery,
  STATUS_FILTERS,
  statusCounts,
  timeline,
  TYPE_FILTERS,
  typeCounts,
  viewGroups,
  type Group,
  type GroupView,
  type JiraTitleMap,
  type StatusFilter,
  type TypeFilter,
} from './model';
import {
  EnvTag,
  GroupRow,
  TimelineRow,
  TrashNote,
  type OnEdit,
  type OnDelete,
  type OnResume,
} from './Row';
import { NewSessionButton, type OnNewSession } from './NewSessionButton';
import { useCollapsed } from './useCollapsed';

type View = 'ticket' | 'time';

interface ListProps {
  sessions: ApiSession[];
  query: string;
  now: Date;
  /** Jira titles by ticket key; empty until a lookup has run. */
  titles?: JiraTitleMap;
  onEdit: OnEdit;
  onResume: OnResume;
  onDelete: OnDelete;
  onNewSession: OnNewSession;
  onCleanup: () => void;
}

export function WorkList({
  sessions,
  query,
  now,
  titles = {},
  onEdit,
  onResume,
  onDelete,
  onNewSession,
  onCleanup,
}: ListProps) {
  const { t } = useI18n();
  const { autoArchive } = useConfig();
  const [view, setView] = useState<View>('ticket');
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const collapsed = useCollapsed();
  const q = normalizeQuery(query);

  const groups = useMemo(() => groupWork(sessions), [sessions]);
  const views = viewGroups(
    groups,
    (s) => matchesType(s, type) && matchesStatus(s, status) && matchesQuery(s, q, titles),
  );
  const tCounts = typeCounts(sessions);
  const sCounts = statusCounts(sessions, type);

  return (
    <div className="list">
      <div className="toolbar">
        <div role="group" aria-label={t('list.sortBy')} className="seg">
          <ViewButton icon="layers" on={view === 'ticket'} onClick={() => setView('ticket')}>
            {t('list.byTicket')}
          </ViewButton>
          <ViewButton icon="clock" on={view === 'time'} onClick={() => setView('time')}>
            {t('list.timeline')}
          </ViewButton>
        </div>
        <div role="group" aria-label={t('list.filterByType')} className="chips">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="chip"
              aria-pressed={type === f}
              onClick={() => setType(f)}
            >
              <span className={`chip__dot chip__dot--${f}`} aria-hidden="true" />
              {t(`list.type.${f}`)} <span className="chip__count">{tCounts[f]}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label={t('list.filterByStatus')} className="chips chips--status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="pill"
              aria-pressed={status === f}
              onClick={() => setStatus(f)}
            >
              {f !== 'all' && <Icon name={STATUS_ICON[f]} size={14} />}
              {t(`list.statusFilter.${f}`)} <span className="chip__count">{sCounts[f]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="ib cleanup-btn" onClick={onCleanup}>
          <Icon name="scissors" size={14} />
          {t('list.cleanUp')}
        </button>
      </div>

      {views.length === 0 && (
        <div className="empty">
          {q ? t('list.noResults', { query: query.trim() }) : t('list.empty')}
        </div>
      )}

      {view === 'ticket' ? (
        <div className="groups">
          {views.map((v) => (
            <WorkGroup
              key={v.group.id}
              view={v}
              now={now}
              titles={titles}
              onEdit={onEdit}
              onResume={onResume}
              onDelete={onDelete}
              onNewSession={onNewSession}
              expanded={!!q || !collapsed.has(v.group.id)}
              onToggle={() => collapsed.toggle(v.group.id)}
            />
          ))}
        </div>
      ) : (
        <div className="buckets">
          {timeline(views, now).map(({ bucket, rows }) => (
            <section key={bucket} className="bucket">
              <h3 className="bucket__label">{t(`list.buckets.${bucket}`)}</h3>
              <div className="card">
                {rows.map(({ session, group }) => (
                  <TimelineRow
                    key={session.id}
                    session={session}
                    now={now}
                    onEdit={onEdit}
                    onResume={onResume}
                    onDelete={onDelete}
                    kind={group.kind}
                    groupKey={groupKey(group)}
                    groupTitle={groupTitle(group, t, titles)}
                    groupEnv={group.env}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="legend">
        {(['ops', 'ticket', 'scratch'] as const).map((k) => (
          <span key={k} className="legend__item">
            <span className={`swatch swatch--${k}`} aria-hidden="true" />
            {t(
              k === 'scratch' && !autoArchive.enabled
                ? 'list.legend.scratchPlain'
                : `list.legend.${k}`,
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function ViewButton({
  icon,
  on,
  onClick,
  children,
}: {
  icon: IconName;
  on: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" className="seg__item seg__item--icon" aria-pressed={on} onClick={onClick}>
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

type T = ReturnType<typeof useI18n>['t'];

/** Timeline key tag: the ticket key, the kind, or (Ops with an env) an EnvTag instead. */
function groupKey(g: Group): string {
  if (g.kind === 'ticket') return g.key ?? '';
  return g.kind;
}

/** Group heading text after the key or env tag. Ops: the release label, else the env's project
 * (the tag already shows its name). Ticket: its Jira title, blank until one is cached. */
function groupTitle(g: Group, t: T, titles: JiraTitleMap): string {
  if (g.kind === 'ops') return g.releaseLabel ?? g.env?.project ?? t('list.type.ops');
  if (g.kind === 'scratch') return t('list.type.scratch');
  return g.key ? (titles[g.key]?.title ?? '') : t('list.noTicket');
}

const TILE_ICON: Record<Group['kind'], IconName> = { ticket: 'tag', ops: 'cloud', scratch: 'zap' };
/** Ops groups with a release label use the prototype's release icon. */
const tileIcon = (g: Group): IconName =>
  g.kind === 'ops' && g.releaseLabel ? 'alert-triangle' : TILE_ICON[g.kind];
const STATUS_ICON: Record<Exclude<StatusFilter, 'all'>, IconName> = {
  todo: 'circle',
  bookmarked: 'bookmark',
  done: 'check-circle',
};

interface WorkGroupProps {
  view: GroupView;
  now: Date;
  titles: JiraTitleMap;
  onEdit: OnEdit;
  onResume: OnResume;
  onDelete: OnDelete;
  onNewSession: OnNewSession;
  expanded: boolean;
  onToggle: () => void;
}

function WorkGroup({
  view,
  now,
  titles,
  onEdit,
  onResume,
  onDelete,
  onNewSession,
  expanded,
  onToggle,
}: WorkGroupProps) {
  const { t } = useI18n();
  const { autoArchive } = useConfig();
  const { group, rows, done, total } = view;
  const { root } = useWorkspaceConfig(rows[0]?.workspace ?? '');
  const isTicket = group.kind === 'ticket';
  const base = isTicket
    ? `${root} · ${group.branch ?? t('list.noBranch')}`
    : group.kind === 'scratch'
      ? t(autoArchive.enabled ? 'list.noTicketMeta' : 'list.noTicketMetaPlain')
      : group.releaseLabel
        ? t('list.releaseDebug')
        : `${t(group.env && isLocal(group.env) ? 'list.localEnvDebug' : 'list.envDebug')} · ${t('list.noTicket')}`;
  const meta = [base, done ? t('list.doneCount', { done, total }) : ''].filter(Boolean).join(' · ');
  const title = groupTitle(group, t, titles);

  return (
    <section className="card grp" data-testid="group">
      <button type="button" className="grp__head" aria-expanded={expanded} onClick={onToggle}>
        <span className={`tile tile--${group.kind}`}>
          <Icon
            name={tileIcon(group)}
            size={17}
            stroke={group.kind === 'scratch' ? 'var(--c-text)' : 'currentColor'}
          />
        </span>
        <span className="grp__text">
          <span className="grp__title">
            {group.env && <EnvTag env={group.env} />}
            {group.key && <span className="grp__key">{group.key}</span>}
            {title}
          </span>
          {meta && <span className="grp__meta">{meta}</span>}
        </span>
        <span className="grp__count">{t('list.sessionCount', { n: rows.length })}</span>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={18} />
      </button>
      {expanded && (
        <div className="grp__rows">
          {rows.map((s) => (
            <GroupRow
              key={s.id}
              session={s}
              now={now}
              onEdit={onEdit}
              onResume={onResume}
              onDelete={onDelete}
              after={s.category === 'scratch' ? <TrashNote session={s} now={now} /> : undefined}
            />
          ))}
          {isTicket && (
            <div className="grp__branch">
              <Icon name="git-branch" size={14} />
              <span className="mono grp__branch-name">{group.branch ?? t('list.noBranch')}</span>
              {/* A ticket group without a key only exists through a category override. */}
              <NewSessionButton
                ticketKey={group.key}
                jiraTitle={group.key ? titles[group.key]?.title : undefined}
                onStart={onNewSession}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
