import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';

export interface ToastMessage {
  text: string;
  /** Errors use role="alert" so screen readers announce them at once. */
  tone: 'info' | 'error';
  /** The prototype's Undo button; clicking it also closes the toast. */
  undo?: { label: string; onClick: () => void };
  /** Overrides the hook's default time on screen. */
  ms?: number;
}

/** The page's `show`, for controls deep in a row (the ⋯ menu's Copy resume command). */
export const ToastContext = createContext<(message: ToastMessage) => void>(() => {});

/** One toast at a time; a new one replaces the old and restarts the timer. */
export function useToast(ms = 6000) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback(
    (message: ToastMessage) => {
      clearTimeout(timer.current);
      setToast(message);
      timer.current = setTimeout(() => setToast(null), message.ms ?? ms);
    },
    [ms],
  );
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);
  return { toast, show, dismiss };
}

export function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const { t } = useI18n();
  const { undo } = toast;
  return (
    <div role={toast.tone === 'error' ? 'alert' : 'status'} className="toast">
      <span>{toast.text}</span>
      {undo && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            onDismiss();
            undo.onClick();
          }}
        >
          <Icon name="rotate-ccw" size={14} />
          {undo.label}
        </button>
      )}
      <button
        type="button"
        className="toast__close"
        aria-label={t('toast.close')}
        title={t('toast.close')}
        onClick={onDismiss}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
