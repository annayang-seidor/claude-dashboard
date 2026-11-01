import { useEffect, useState, useSyncExternalStore } from 'react';
import { accessStore, refreshToken, reopenWithToken } from '../api';
import { Icon } from '../Icon';
import { useI18n } from '../i18n';

/** True once the server has refused this tab's token (any 403). */
export const useAccessLost = () => useSyncExternalStore(accessStore.subscribe, accessStore.get);

/** The command that opens the current link (ADR 0032); not translated. */
const OPEN_COMMAND = 'open "$(cat ~/.claude-dashboard/url)"';

/** Shown instead of silent failures after a 403: the token was rotated, or this tab came from an
 * old link. Reconnect trades this tab's token for the new one (ADR 0048); when the server refuses
 * it, the command still opens the new link (ADR 0032). */
export function AccessLost() {
  const { t, tRich } = useI18n();
  const [state, setState] = useState<'idle' | 'busy' | 'refused' | 'down'>('idle');
  if (!useAccessLost()) return null;
  const reconnect = async () => {
    setState('busy');
    const result = await refreshToken();
    if (result === 'refused' || result === 'down') setState(result);
    else reopenWithToken(result);
  };
  return (
    <div role="alert" className="access-lost">
      <Icon name="alert-triangle" size={18} />
      <div>
        <p className="access-lost__title">{t('access.lost')}</p>
        <p className="access-lost__how">
          {tRich('access.how', {
            command: (
              <>
                <code className="mono">{OPEN_COMMAND}</code>
                <CopyButton />
              </>
            ),
          })}
        </p>
        <p className="access-lost__actions">
          <button
            type="button"
            className="access-lost__reconnect"
            disabled={state === 'busy'}
            onClick={() => void reconnect()}
          >
            {t('access.reconnect')}
          </button>
          {(state === 'refused' || state === 'down') && (
            <span role="status">{t(state === 'refused' ? 'access.refused' : 'access.down')}</span>
          )}
        </p>
      </div>
    </div>
  );
}

/** Copies the command; shows a check (and says "Copied") for a moment after. */
function CopyButton() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  const label = t(copied ? 'access.copied' : 'access.copy');
  return (
    <button
      type="button"
      className="access-lost__copy"
      aria-label={label}
      title={label}
      onClick={() => {
        navigator.clipboard.writeText(OPEN_COMMAND).then(
          () => setCopied(true),
          () => {},
        );
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  );
}
