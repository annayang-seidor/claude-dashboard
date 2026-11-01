import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../i18n';
import { LANG_STORAGE_KEY } from '../i18n/core';

// Test helpers only; nothing in the app imports this file.
export { NOW, session } from './fixtures';

export function renderEn(ui: ReactElement) {
  localStorage.setItem(LANG_STORAGE_KEY, 'en');
  // As a wrapper, the provider survives rerender().
  return render(ui, { wrapper: I18nProvider });
}
