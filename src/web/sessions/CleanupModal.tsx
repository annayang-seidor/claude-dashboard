import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ApiSession } from '../../shared/api';
import { cutoffForDate, cutoffForDays, localDate, selectCleanup } from '../../shared/cleanup';
import type { Workspace } from '../../shared/session';
import { useConfig, workspaceById } from '../config';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';
import { useCleanupPeriodDays } from './retention';
import { whenLabels } from './time';

/** A range in days (`cleanup.ranges` in the config), or the custom date. */
type Range = number | 'custom';

/** "1 week", "3 weeks", "10 days": whole weeks read as weeks. */
function rangeLabel(days: number, t: ReturnType<typeof useI18n>['t']): string {
  if (days % 7 === 0)
    return days === 7 ? t('cleanup.range.week') : t('cleanup.range.weeks', { n: days / 7 });
  return days === 1 ? t('cleanup.range.day') : t('cleanup.range.days', { n: days });
}

interface CleanupModalProps {
  workspace: Workspace;
  sessions: readonly ApiSession[];
  now: Date;
  onClose: () => void;
  /** Called with the previewed sessions; the modal closes itself first. */
  onConfirm: (sessions: ApiSession[]) => void;
}

/** Previewed bulk cleanup of one workspace (spec § Cleanup). Selection is the same pure function
 * auto-archive uses, so the preview is exactly what moves to the trash. */
export function CleanupModal({ workspace, sessions, now, onClose, onConfirm }: CleanupModalProps) {
  const { t, messages } = useI18n();
  const config = useConfig();
  const { ranges, defaultRange, customStartDays } = config.cleanup;
  const { root } = workspaceById(config, workspace);
  const [range, setRange] = useState<Range>(defaultRange);
  const cleanupPeriodDays = useCleanupPeriodDays();
  // Claude Code has already removed anything older (ADR 0038). Unknown or off: no limit.
  const minDate = cleanupPeriodDays ? localDate(cutoffForDays(now, cleanupPeriodDays)) : undefined;
  const [date, setDate] = useState(() => {
    const start = localDate(cutoffForDays(now, customStartDays));
    return minDate && minDate > start ? minDate : start;
  });
  const [keepBookmarked, setKeepBookmarked] = useState(config.cleanup.keepBookmarked);
  const [keepTodo, setKeepTodo] = useState(config.cleanup.keepTodo);
  const dialog = useRef<HTMLDivElement>(null);

  // Focus moves in on open and back to the Clean up button on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    return () => opener?.focus();
  }, []);

  const { selected, keptBookmarked, keptTodo } = selectCleanup(sessions, {
    workspace,
    scratchOnly: false,
    before: range === 'custom' ? cutoffForDate(date, now) : cutoffForDays(now, range),
    keepBookmarked,
    keepTodo,
    sinceRestore: false,
  });
  const n = selected.length;

  const confirm = () => {
    if (!n) return;
    onClose();
    onConfirm(selected);
  };

  // Escape closes; Tab stays inside the dialog.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const checks = [
    ['keepBookmarked', keepBookmarked, setKeepBookmarked],
    ['keepTodo', keepTodo, setKeepTodo],
  ] as const;

  return (
    <div
      className="modal"
      onKeyDown={onKeyDown}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cl-title"
        className="modal__box"
      >
        <div className="modal__head">
          <div className="modal__heading">
            <h2 id="cl-title" className="modal__title">
              {t('cleanup.title')}
            </h2>
            <p className="modal__sub">{t('cleanup.basis', { root })}</p>
          </div>
          <button
            type="button"
            className="ib icon-btn modal__close"
            aria-label={t('cleanup.close')}
            title={t('cleanup.close')}
            onClick={onClose}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="cl-field">
          <div className="cl-label">{t('cleanup.olderThan')}</div>
          <div role="group" aria-label={t('cleanup.olderThan')} className="chips">
            {[...ranges, 'custom' as const].map((r) => (
              <button
                key={r}
                type="button"
                className="pill"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
              >
                {r === 'custom' ? t('cleanup.range.custom') : rangeLabel(r, t)}
              </button>
            ))}
          </div>
          {range === 'custom' && (
            <label className="cl-date">
              {t('cleanup.pickDate')}
              <input
                type="date"
                value={date}
                min={minDate}
                max={localDate(now)}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="cl-checks">
          {checks.map(([key, on, set]) => (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={on}
              className="cl-check"
              onClick={() => set(!on)}
            >
              <span className="cl-check__box" data-on={on} aria-hidden="true">
                {on && <Icon name="check" size={12} stroke="var(--c-on-dark)" />}
              </span>
              {t(`cleanup.${key}`)}
            </button>
          ))}
        </div>

        <div className="cl-preview" aria-live="polite">
          <div className="cl-preview__summary">
            {n ? t('cleanup.willDelete', { n }) : t('cleanup.noneMatch')}
          </div>
          {n > 0 && (
            <ul className="cl-preview__list">
              {selected.map((s) => (
                <li key={s.id}>
                  {s.title}{' '}
                  <span className="cl-preview__time">
                    · {whenLabels(s.lastActivityAt, now, messages).time}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="cl-preview__kept">
            {t('cleanup.keptNote', { ref: keptBookmarked, todo: keptTodo })}
          </div>
        </div>

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('cleanup.cancel')}
          </button>
          <button type="button" className="btn btn--danger" disabled={!n} onClick={confirm}>
            {t('cleanup.confirm', { n })}
          </button>
        </div>
      </div>
    </div>
  );
}
