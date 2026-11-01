import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import type { Workspace } from '../shared/session';
import { useConfig } from './config';

// Hand-rolled History API router: one flat route per configured workspace (ADR 0016, ADR 0061).

export type { Workspace } from '../shared/session';

/** A workspace's page: `/<id>`. */
export function workspacePath(id: Workspace): string {
  return `/${id}`;
}

export function workspaceFromPath(pathname: string, ids: readonly Workspace[]): Workspace | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ids.find((id) => workspacePath(id) === clean) ?? null;
}

/** Keep the query string: it carries the dashboard token, which a reload needs (ADR 0032). */
export function hrefFor(path: string, search: string): string {
  return path + search;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export function navigate(path: string, { replace = false } = {}): void {
  const url = hrefFor(path, window.location.search);
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Call once before the first render: any path that is not a workspace (including /) becomes
 * the first workspace's. */
export function normalizeInitialPath(ids: readonly Workspace[]): void {
  if (!workspaceFromPath(window.location.pathname, ids))
    navigate(workspacePath(ids[0]!), { replace: true });
}

export function useWorkspace(): Workspace {
  const ids = useConfig().workspaces.map((w) => w.id);
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  return workspaceFromPath(pathname, ids) ?? ids[0]!;
}

interface LinkProps {
  to: string;
  className?: string;
  'aria-current'?: 'page';
  children: ReactNode;
}

export function Link({ to, children, ...rest }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle new-tab / new-window clicks.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (window.location.pathname !== to) navigate(to);
  };
  return (
    <a href={hrefFor(to, window.location.search)} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
