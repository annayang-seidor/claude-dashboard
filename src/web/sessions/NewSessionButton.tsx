import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SESSION_TITLE_MAX } from '../../shared/state';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';
import { MenuForm, placeBelow, useDismiss } from './RowMenu';

/** Resolves true once the terminal was asked to open; false after the error toast. */
export type OnNewSession = (ticketKey: string, name?: string) => Promise<boolean>;

const CONTROL = /[\p{Cc}\u2028\u2029]+/gu;

/** "<KEY> <Jira title>", or the bare key; a Jira title never carries a control character into
 * the terminal, and the result fits the server's 120-character limit. */
export function defaultSessionName(ticketKey: string, jiraTitle?: string): string {
  const title = jiraTitle?.replace(CONTROL, ' ').trim();
  return (title ? `${ticketKey} ${title}` : ticketKey).slice(0, SESSION_TITLE_MAX).trim();
}

/** "New session for this ticket": opens a small form for the name `claude --name` gets, so the
 * session is not titled with the bare key (spec § New session for this ticket). Empty starts it
 * without a name. Escape, Cancel, a click outside or scrolling closes the form. */
export function NewSessionButton({
  ticketKey,
  jiraTitle,
  onStart,
}: {
  /** null for a ticket group that only exists through a category override: disabled. */
  ticketKey: string | null;
  jiraTitle?: string;
  onStart: OnNewSession;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useDismiss(open, root, button, () => setOpen(false));

  return (
    <div className="menu-anchor" ref={root}>
      <button
        ref={button}
        type="button"
        className="new-session"
        disabled={!ticketKey}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          setPlace(placeBelow(e.currentTarget));
          setOpen((o) => !o);
        }}
      >
        <Icon name="plus" size={14} />
        {t('list.newSessionForTicket')}
      </button>
      {open && ticketKey && (
        <div className="menu-pop" style={place}>
          <NameForm
            ticketKey={ticketKey}
            initial={defaultSessionName(ticketKey, jiraTitle)}
            onStart={onStart}
            onDone={close}
          />
        </div>
      )}
    </div>
  );
}

function NameForm({
  ticketKey,
  initial,
  onStart,
  onDone,
}: {
  ticketKey: string;
  initial: string;
  onStart: OnNewSession;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = `new-session-${ticketKey}`;

  // Selected, so typing replaces the suggestion.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // A failed launch keeps the form open with the name, after the error toast.
  const start = () => {
    if (busy) return;
    setBusy(true);
    void onStart(ticketKey, value.trim() || undefined).then((ok) => {
      setBusy(false);
      if (ok) onDone();
    });
  };

  return (
    <MenuForm
      label={t('list.newSessionName')}
      fieldId={id}
      onSubmit={start}
      onCancel={onDone}
      submitLabel={t('list.newSessionStart')}
      busy={busy}
      note={t('list.newSessionNameHint')}
    >
      <input
        ref={input}
        id={id}
        className="menu__field"
        value={value}
        maxLength={SESSION_TITLE_MAX}
        autoComplete="off"
        spellCheck={false}
        aria-label={t('list.newSessionNameInput')}
        onChange={(e) => setValue(e.target.value)}
      />
    </MenuForm>
  );
}
