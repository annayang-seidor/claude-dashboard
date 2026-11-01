import { useEffect, useState } from 'react';
import { HealthResponse } from '../shared/api';
import { api } from './api';
import { useI18n } from './i18n';
import { useJiraInbox } from './jira/useJiraInbox';
import { useJiraTitles } from './jira/useJiraTitles';
import { useWorkspaceConfig, workspaceLabel } from './config';
import { useWorkspace } from './router';
import { SessionsPane } from './sessions/SessionsPane';
import { Footer } from './shell/Footer';
import { AccessLost } from './shell/AccessLost';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { Header, JiraLoginNote, JiraSyncStatus } from './shell/Header';
import { useNow } from './useNow';

type ApiStatus = 'pending' | 'ok' | 'error';

/** Page shell for every workspace; its kind picks the Work or Personal layout (ADR 0061). */
export function App() {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const config = useWorkspaceConfig(workspace);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ApiStatus>('pending');
  const work = config.kind === 'work';
  const jira = useJiraTitles(work);
  const inbox = useJiraInbox(work);
  const now = useNow();
  const attempt = inbox.lastAttempt;
  // One login note for both Jira jobs; its retry runs both (ADR 0043).
  const loginNeeded =
    (jira.lastRun?.ok === false && jira.lastRun.reason === 'auth') ||
    (attempt?.ok === false && attempt.reason === 'auth');
  const busy = jira.refreshing || inbox.syncing;
  const syncBoth = () => {
    inbox.sync();
    jira.refresh();
  };
  const failure =
    attempt?.ok === false && attempt.reason !== 'auth' ? (attempt.reason ?? 'failed') : null;

  useEffect(() => {
    api('/api/health', HealthResponse).then(
      () => setStatus('ok'),
      () => setStatus('error'),
    );
  }, []);

  const label = workspaceLabel(config, lang);
  useEffect(() => {
    document.title = t('app.documentTitle', { workspace: label });
  }, [t, label]);

  return (
    <div className="page">
      <div className="page__inner">
        <Header
          workspace={workspace}
          query={query}
          onQuery={setQuery}
          sync={
            !work ? undefined : loginNeeded ? (
              <JiraLoginNote busy={busy} onRetry={syncBoth} />
            ) : (
              <JiraSyncStatus
                syncedAt={inbox.result?.syncedAt ?? null}
                failure={failure}
                busy={inbox.syncing}
                onSync={inbox.sync}
                now={now}
              />
            )
          }
        />
        <AccessLost />
        <div className={`cols cols--${config.kind}`} data-api-status={status}>
          {/* Keyed by workspace too, so switching tabs also clears an error. */}
          <ErrorBoundary key={workspace}>
            <SessionsPane
              workspace={workspace}
              query={query}
              titles={jira.titles}
              inbox={work ? inbox : undefined}
            />
          </ErrorBoundary>
        </div>
        <Footer />
      </div>
    </div>
  );
}
