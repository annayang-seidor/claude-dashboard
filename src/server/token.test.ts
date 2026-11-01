import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPreviousToken, loadToken, newToken, previousTokenPath } from './token';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function tokenPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'token-test-'));
  dirs.push(dir);
  return join(dir, 'sub', 'token');
}

const mode = (path: string) => statSync(path).mode & 0o777;

describe('loadToken', () => {
  it('makes a 32-byte token in a new mode-600 file, without logging', async () => {
    const path = tokenPath();
    const log = vi.fn();
    const token = await loadToken(path, { log });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(path, 'utf8')).toBe(token + '\n');
    expect(mode(path)).toBe(0o600);
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps the same token across restarts', async () => {
    const path = tokenPath();
    const first = await loadToken(path);
    expect(await loadToken(path)).toBe(first);
  });

  it('rotates on request', async () => {
    const path = tokenPath();
    const first = await loadToken(path);
    const log = vi.fn();
    const second = await loadToken(path, { rotate: true, log });
    expect(second).not.toBe(first);
    expect(await loadToken(path)).toBe(second);
    expect(log).toHaveBeenCalledOnce();
  });

  it('replaces a file that does not hold a valid token', async () => {
    const path = tokenPath();
    await loadToken(path); // creates the folder
    writeFileSync(path, 'short\n');
    const log = vi.fn();
    const token = await loadToken(path, { log });
    expect(token).not.toBe('short');
    expect(readFileSync(path, 'utf8')).toBe(token + '\n');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('does not hold a valid token'));
  });

  it('tightens a token file other users could read, and keeps the token', async () => {
    const path = tokenPath();
    await loadToken(path);
    const token = newToken();
    writeFileSync(path, token + '\n');
    chmodSync(path, 0o644);
    const log = vi.fn();
    expect(await loadToken(path, { log })).toBe(token);
    expect(mode(path)).toBe(0o600);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('set to 600'));
  });
});

describe('previous token (ADR 0048)', () => {
  it('is none until a rotation', async () => {
    const path = tokenPath();
    await loadToken(path);
    await loadToken(path);
    expect(await loadPreviousToken(path)).toBeNull();
  });

  it('a rotation keeps the replaced token in a mode-600 file', async () => {
    const path = tokenPath();
    const first = await loadToken(path);
    const second = await loadToken(path, { rotate: true, log: vi.fn() });
    expect(await loadPreviousToken(path)).toBe(first);
    expect(mode(previousTokenPath(path))).toBe(0o600);
    await loadToken(path, { rotate: true, log: vi.fn() });
    expect(await loadPreviousToken(path)).toBe(second);
  });

  it('a revoke drops it', async () => {
    const path = tokenPath();
    await loadToken(path);
    await loadToken(path, { rotate: true, log: vi.fn() });
    await loadToken(path, { rotate: true, revoke: true, log: vi.fn() });
    expect(await loadPreviousToken(path)).toBeNull();
  });
});
