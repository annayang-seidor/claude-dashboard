import { useMemo } from 'react';
import type { ApiSession } from '../../shared/api';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';
import {
  groupPersonal,
  matchesQuery,
  normalizeQuery,
  repoLabel,
  viewGroups,
  type GroupView,
} from './model';
import { GroupRow, TrashNote, type OnEdit, type OnDelete, type OnResume } from './Row';
import { whenLabels } from './time';
import { useCollapsed } from './useCollapsed';

interface ListProps {
  sessions: ApiSession[];
  query: string;
  now: Date;
  onEdit: OnEdit;
  onResume: OnResume;
  onDelete: OnDelete;
  onCleanup: () => void;
}

export function PersonalList({
  sessions,
  query,
  now,
  onEdit,
  onResume,
  onDelete,
  onCleanup,
}: ListProps) {
  const { t } = useI18n();
  const collapsed = useCollapsed();
  const q = normalizeQuery(query);
  const groups = useMemo(() => groupPersonal(sessions), [sessions]);
  const views = viewGroups(groups, (s) => matchesQuery(s, q, {}, true));

  return (
    <div className="list list--personal">
      <div className="toolbar">
        <p className="intro">{t('personal.intro')}</p>
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
      {views.map((v) => (
        <PersonalGroup
          key={v.group.id}
          view={v}
          now={now}
          onEdit={onEdit}
          onResume={onResume}
          onDelete={onDelete}
          expanded={!!q || !collapsed.has(v.group.id)}
          onToggle={() => collapsed.toggle(v.group.id)}
        />
      ))}
    </div>
  );
}

interface PersonalGroupProps {
  view: GroupView;
  now: Date;
  onEdit: OnEdit;
  onResume: OnResume;
  onDelete: OnDelete;
  expanded: boolean;
  onToggle: () => void;
}

function PersonalGroup({
  view,
  now,
  onEdit,
  onResume,
  onDelete,
  expanded,
  onToggle,
}: PersonalGroupProps) {
  const { t, messages } = useI18n();
  const { group, rows } = view;
  const noRepo = group.repo === null;
  // Groups are sorted To do first, so the newest activity is not always the first row.
  const newest = rows.reduce((a, b) => (b.lastActivityAt > a.lastActivityAt ? b : a));
  const lastActive = whenLabels(newest.lastActivityAt, now, messages).day;

  // Personal has no Scratch (ADR 0024): every row moves to trash after 14 idle days, and sessions
  // outside a repo get a neutral group with the same meta line as the repos.
  return (
    <section className="card grp grp--personal" data-testid="group">
      <button type="button" className="grp__head" aria-expanded={expanded} onClick={onToggle}>
        <span className={`tile tile--${noRepo ? 'none' : 'ticket'}`}>
          <Icon name="folder" size={17} />
        </span>
        <span className="grp__text">
          {noRepo ? (
            <span className="grp__title">{t('personal.noRepo')}</span>
          ) : (
            <span className="grp__title grp__title--repo">{repoLabel(group.repo!)}</span>
          )}
          <span className="grp__meta">
            {t('personal.repoMeta', { n: rows.length, when: lastActive })}
          </span>
        </span>
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
              branch={s.branch}
              after={<TrashNote session={s} now={now} />}
            />
          ))}
        </div>
      )}
    </section>
  );
}
