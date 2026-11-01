export interface KeyInfo {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** True when focus is in a text field, select or contenteditable. */
  inEditable: boolean;
}

/** ⌘K / Ctrl+K anywhere, or '/' when not typing in a field, focuses the search box. */
export function isSearchShortcut(e: KeyInfo): boolean {
  if (e.altKey) return false;
  if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) return true;
  return e.key === '/' && !e.metaKey && !e.ctrlKey && !e.inEditable;
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Hint shown in the search box: ⌘K on Apple platforms, Ctrl K elsewhere. */
export function shortcutHint(platform: string): string {
  return /Mac|iPhone|iPad/i.test(platform) ? '⌘K' : 'Ctrl K';
}
