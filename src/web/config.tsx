import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_PAGE_CONFIG, type PageConfig, type WorkspaceConfig } from '../shared/config';
import type { Workspace } from '../shared/session';
import type { Lang } from './i18n';

// The server reads the config once at start; main.tsx asks for the page's part once at load
// (ADR 0061) and provides it here.

// Components rendered without a provider (tests) get the defaults.
const ConfigContext = createContext<PageConfig>(DEFAULT_PAGE_CONFIG);

export function ConfigProvider({ value, children }: { value: PageConfig; children: ReactNode }) {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): PageConfig {
  return useContext(ConfigContext);
}

/** The configured workspace with this id; the first one when no workspace has it. */
export function workspaceById(config: PageConfig, id: Workspace): WorkspaceConfig {
  return config.workspaces.find((w) => w.id === id) ?? config.workspaces[0]!;
}

export function useWorkspaceConfig(id: Workspace): WorkspaceConfig {
  return workspaceById(useConfig(), id);
}

/** A tab label in the page's language. */
export function workspaceLabel(w: WorkspaceConfig, lang: Lang): string {
  return typeof w.label === 'string' ? w.label : w.label[lang];
}
