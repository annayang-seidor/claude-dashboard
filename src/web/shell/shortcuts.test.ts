import { describe, expect, it } from 'vitest';
import { isSearchShortcut, shortcutHint, type KeyInfo } from './shortcuts';

const key = (k: string, mods: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  inEditable: false,
  ...mods,
});

describe('isSearchShortcut', () => {
  it('accepts ⌘K and Ctrl+K, even while typing', () => {
    expect(isSearchShortcut(key('k', { metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key('K', { ctrlKey: true, inEditable: true }))).toBe(true);
  });

  it("accepts '/' only outside text fields", () => {
    expect(isSearchShortcut(key('/'))).toBe(true);
    expect(isSearchShortcut(key('/', { inEditable: true }))).toBe(false);
  });

  it('rejects plain k and Alt combinations', () => {
    expect(isSearchShortcut(key('k'))).toBe(false);
    expect(isSearchShortcut(key('k', { metaKey: true, altKey: true }))).toBe(false);
    expect(isSearchShortcut(key('/', { ctrlKey: true }))).toBe(false);
  });
});

describe('shortcutHint', () => {
  it('shows ⌘K on Apple platforms and Ctrl K elsewhere', () => {
    expect(shortcutHint('MacIntel')).toBe('⌘K');
    expect(shortcutHint('Win32')).toBe('Ctrl K');
  });
});
