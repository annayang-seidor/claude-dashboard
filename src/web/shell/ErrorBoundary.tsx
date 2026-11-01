import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';

/** A message and a Retry button in place of a render error. Used inside I18nProvider. */
export function ErrorNote({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="empty error-note">
      <p>{text}</p>
      <button type="button" className="retry" onClick={onRetry}>
        <Icon name="refresh-cw" size={14} />
        {t('error.retry')}
      </button>
    </div>
  );
}

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return <ErrorNote text={t('error.title')} onRetry={onRetry} />;
}

interface State {
  error: Error | null;
  /** Bumped by Retry so the children mount again from scratch. */
  attempt: number;
}

/** Catches render errors below it; Retry remounts the children. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui]', error, info.componentStack);
  }

  retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  render() {
    if (this.state.error) return <Fallback onRetry={this.retry} />;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
