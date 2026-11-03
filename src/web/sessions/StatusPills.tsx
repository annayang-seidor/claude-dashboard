import { Icon, type IconName } from '../Icon';
import { useI18n } from '../i18n';
import { STATUS_FILTERS, type StatusFilter } from './model';

const STATUS_ICON: Record<Exclude<StatusFilter, 'all'>, IconName> = {
  todo: 'circle',
  bookmarked: 'bookmark',
  done: 'check-circle',
};

/** The status pills both pages show, right-aligned in the toolbar. */
export function StatusPills({
  status,
  counts,
  onChange,
}: {
  status: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (status: StatusFilter) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t('list.filterByStatus')} className="chips chips--status">
      {STATUS_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          className="pill"
          aria-pressed={status === f}
          onClick={() => onChange(f)}
        >
          {f !== 'all' && <Icon name={STATUS_ICON[f]} size={14} />}
          {t(`list.statusFilter.${f}`)} <span className="chip__count">{counts[f]}</span>
        </button>
      ))}
    </div>
  );
}
