import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/list.css';
import { ConfigResponse } from '../shared/api';
import { DEFAULT_PAGE_CONFIG } from '../shared/config';
import { api } from './api';
import { App } from './App';
import { ConfigProvider } from './config';
import { I18nProvider } from './i18n';
import { normalizeInitialPath } from './router';
import { ErrorBoundary } from './shell/ErrorBoundary';

// The tabs come from the config, so it is read before the first render (ADR 0061). On failure
// the defaults keep the page usable; the Vite-only header specs have no API at all.
const config = await api('/api/config', ConfigResponse).catch(() => DEFAULT_PAGE_CONFIG);
normalizeInitialPath(config.workspaces.map((w) => w.id));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider value={config}>
      <I18nProvider>
        {/* Last resort for the header and footer; the list has its own boundary in App. */}
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </I18nProvider>
    </ConfigProvider>
  </StrictMode>,
);
