import { describe, expect, it } from 'vitest';
import { hrefFor, workspaceFromPath } from './router';

const IDS = ['work', 'personal', 'side'];

describe('workspaceFromPath', () => {
  it('maps each configured workspace, with or without a trailing slash', () => {
    expect(workspaceFromPath('/work', IDS)).toBe('work');
    expect(workspaceFromPath('/personal/', IDS)).toBe('personal');
    expect(workspaceFromPath('/side', IDS)).toBe('side');
  });

  it('returns null for anything else', () => {
    expect(workspaceFromPath('/', IDS)).toBeNull();
    expect(workspaceFromPath('/work/x', IDS)).toBeNull();
    expect(workspaceFromPath('/api/health', IDS)).toBeNull();
    expect(workspaceFromPath('/side', ['work', 'personal'])).toBeNull();
  });
});

describe('hrefFor', () => {
  it('keeps the token query string', () => {
    expect(hrefFor('/personal', '?t=abc')).toBe('/personal?t=abc');
  });
});
