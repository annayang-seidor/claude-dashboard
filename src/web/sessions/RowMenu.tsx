import {
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { EnvsResponse, type ApiEnv, type ApiSession } from '../../shared/api';
import { TicketKey } from '../../shared/session';
import { api } from '../api';
import { useWorkspaceConfig } from '../config';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';
import { ToastContext } from '../shell/Toast';
import type { OnEdit } from './Row';

type Mode = 'closed' | 'menu' | 'ticket' | 'env' | 'release';
type Item = 'rename' | 'copy' | Exclude<Mode, 'closed' | 'menu'>;
const AUTO = 'auto';
/** Room the tallest form needs below the button before the popover opens upward instead. */
const POPOVER_ROOM = 240;

/** Fixed to the viewport, so the card's overflow does not clip it; under the button's right edge,
 * or above it near the bottom of the window. */
export function placeBelow(button: HTMLElement): CSSProperties {
  const r = button.getBoundingClientRect();
  const right = window.innerWidth - r.right;
  return window.innerHeight - r.bottom < POPOVER_ROOM
    ? { right, bottom: window.innerHeight - r.top + 4 }
    : { right, top: r.bottom + 4 };
}

/** While `open`: Escape dismisses and hands focus back to `button`; a click outside `root`,
 * scrolling outside it or resizing dismisses (a fixed popover would drift away from its button). */
export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  button: RefObject<HTMLButtonElement | null>,
  dismiss: () => void,
) {
  const onDismiss = useEffectEvent(dismiss);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onDismiss();
      button.current?.focus();
    };
    // A field scrolling its own text (select() on a long value) is not the page moving.
    const onMove = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, root, button]);
}

/** Row ⋯ menu. Both pages: Rename (in place, in the row's title) and Copy resume command. Work
 * adds Change ticket, Set environment and Set release label, each a small form in the same
 * popover. Escape, a click outside, scrolling or resizing closes it. */
export function RowMenu({
  session,
  onEdit,
  onRename,
  buttonRef: button,
}: {
  session: ApiSession;
  onEdit: OnEdit;
  onRename: () => void;
  /** Owned by the row, so a rename can hand focus back to ⋯. */
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  const { kind } = useWorkspaceConfig(session.workspace);
  const toast = use(ToastContext);
  const [mode, setMode] = useState<Mode>('closed');
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);

  const close = (refocus = true) => {
    setMode('closed');
    if (refocus) button.current?.focus();
  };

  useDismiss(mode !== 'closed', root, button, () => setMode('closed'));

  const save = (edit: Parameters<OnEdit>[1]) => {
    onEdit(session.id, edit);
    close();
  };

  // The input takes focus; ⋯ gets it back after save or cancel.
  const rename = () => {
    close(false);
    onRename();
  };

  // No clipboard (an insecure context) throws inside the promise, so it lands in the error toast.
  const copyResume = () => {
    close();
    const command = `claude --resume ${session.id}`;
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(command))
      .then(
        () => toast({ text: t('toast.copied', { command }), tone: 'info' }),
        () => toast({ text: t('toast.copyFailed'), tone: 'error' }),
      );
  };

  const items: [Item, string][] = [
    ['rename', t('row.rename')],
    ['copy', t('row.copyResume')],
  ];
  if (kind === 'work') {
    items.push(['ticket', t('row.changeTicket')]);
    // Ticket work (a key from the branch or Change ticket) has no env or release label.
    if (!session.ticketKey) items.push(['env', t('row.setEnv')], ['release', t('row.setRelease')]);
  }
  const pick = (item: Item) => {
    if (item === 'rename') rename();
    else if (item === 'copy') copyResume();
    else setMode(item);
  };

  return (
    <div className="menu-anchor" ref={root}>
      <button
        ref={button}
        type="button"
        className="ib icon-btn"
        aria-label={t('row.more')}
        title={t('row.more')}
        aria-haspopup="menu"
        aria-expanded={mode !== 'closed'}
        onClick={(e) => {
          setPlace(placeBelow(e.currentTarget));
          setMode((m) => (m === 'closed' ? 'menu' : 'closed'));
        }}
      >
        <Icon name="more-horizontal" />
      </button>
      {mode !== 'closed' && (
        <div className="menu-pop" style={place}>
          {mode === 'menu' && <Menu items={items} onPick={pick} />}
          {mode === 'ticket' && <TicketForm session={session} onSave={save} onCancel={close} />}
          {mode === 'env' && <EnvForm session={session} onSave={save} onCancel={close} />}
          {mode === 'release' && <ReleaseForm session={session} onSave={save} onCancel={close} />}
        </div>
      )}
    </div>
  );
}

function Menu({ items, onPick }: { items: [Item, string][]; onPick: (item: Item) => void }) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), []);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div role="menu" ref={menu} className="menu" aria-label={t('row.more')} onKeyDown={onKeyDown}>
      {items.map(([item, label]) => (
        <button
          key={item}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="menu__item"
          onClick={() => onPick(item)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface FormProps {
  session: ApiSession;
  onSave: (edit: Parameters<OnEdit>[1]) => void;
  onCancel: () => void;
}

export function MenuForm({
  label,
  fieldId,
  onSubmit,
  onCancel,
  children,
  note,
  submitLabel,
  busy = false,
}: {
  label: string;
  fieldId: string;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
  note?: ReactNode;
  /** Defaults to Save. */
  submitLabel?: string;
  /** Disables the submit button while a request is in flight. */
  busy?: boolean;
}) {
  const { t } = useI18n();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className="menu menu--form" aria-label={label} onSubmit={submit}>
      <label htmlFor={fieldId} className="menu__label">
        {label}
      </label>
      {children}
      {note && <span className="menu__note">{note}</span>}
      <span className="menu__actions">
        <button type="button" className="menu__btn" onClick={onCancel}>
          {t('row.cancel')}
        </button>
        <button type="submit" className="menu__btn menu__btn--primary" disabled={busy}>
          {submitLabel ?? t('row.save')}
        </button>
      </span>
    </form>
  );
}

/** Moves the session to a ticket's group. Empty goes back to the key from the branch; a saved key
 * also drops an old category override, so the session lands in that group. */
function TicketForm({ session, onSave, onCancel }: FormProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(session.state.ticketOverride ?? '');
  const [invalid, setInvalid] = useState(false);
  const id = `ticket-${session.id}`;
  const auto = session.autoTicketKey;
  const submit = () => {
    const key = value.trim().toUpperCase();
    const parsed = TicketKey.safeParse(key);
    if (key && !parsed.success) return setInvalid(true);
    onSave({
      ticketOverride: parsed.success ? parsed.data : null,
      ...(session.state.categoryOverride && { categoryOverride: null }),
    });
  };
  return (
    <MenuForm
      label={t('row.changeTicket')}
      fieldId={id}
      onCancel={onCancel}
      onSubmit={submit}
      note={
        invalid
          ? t('row.ticketInvalid')
          : auto
            ? t('row.ticketHint', { ticket: auto })
            : t('row.ticketHintNone')
      }
    >
      <input
        id={id}
        className="menu__field"
        value={value}
        maxLength={40}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        placeholder={t('row.ticketPlaceholder')}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
      />
    </MenuForm>
  );
}

const envRef = (e: Pick<ApiEnv, 'project' | 'name'>) =>
  e.project ? `${e.project}/${e.name}` : e.name;

function EnvForm({ session, onSave, onCancel }: FormProps) {
  const { t } = useI18n();
  const [envs, setEnvs] = useState<ApiEnv[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [value, setValue] = useState<string>(session.state.envOverride ?? AUTO);
  const id = `env-${session.id}`;

  useEffect(() => {
    const abort = new AbortController();
    api('/api/envs', EnvsResponse, { signal: abort.signal }).then(
      (r) => setEnvs(r.envs),
      () => !abort.signal.aborted && setFailed(true),
    );
    return () => abort.abort();
  }, []);

  const options = envs?.map((e) => ({ ref: envRef(e), env: e })) ?? [];
  // An override hac no longer lists still shows, so saving does not silently drop it.
  const current = session.state.envOverride;
  if (current && session.env && !options.some((o) => o.ref === current)) {
    options.push({ ref: current, env: session.env });
  }
  const auto = session.autoEnv;
  return (
    <MenuForm
      label={t('row.setEnv')}
      fieldId={id}
      onCancel={onCancel}
      onSubmit={() => onSave({ envOverride: value === AUTO ? null : value })}
      note={failed ? t('row.envsFailed') : undefined}
    >
      <select
        id={id}
        className="menu__field"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
      >
        <option value={AUTO}>
          {auto ? t('row.envAuto', { env: auto.name.toUpperCase() }) : t('row.envNone')}
        </option>
        {options.map(({ ref, env }) => (
          <option key={ref} value={ref}>
            [{env.display}] {env.project ?? ''}
            {env.prod ? ` ${t('row.prodSuffix')}` : ''}
          </option>
        ))}
      </select>
    </MenuForm>
  );
}

function ReleaseForm({ session, onSave, onCancel }: FormProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(session.state.releaseLabel ?? '');
  const id = `rel-${session.id}`;
  return (
    <MenuForm
      label={t('row.setRelease')}
      fieldId={id}
      onCancel={onCancel}
      onSubmit={() => onSave({ releaseLabel: value.trim() || null })}
      note={t('row.releaseHint')}
    >
      <input
        id={id}
        className="menu__field"
        value={value}
        maxLength={80}
        autoFocus
        placeholder={t('row.releasePlaceholder')}
        onChange={(e) => setValue(e.target.value)}
      />
    </MenuForm>
  );
}
