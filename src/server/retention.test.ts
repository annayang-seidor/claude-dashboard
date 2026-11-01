import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCleanupPeriodDays } from './retention';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function settingsFile(text?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'retention-test-'));
  dirs.push(dir);
  const path = join(dir, 'settings.json');
  if (text !== undefined) writeFileSync(path, text);
  return path;
}

describe('readCleanupPeriodDays', () => {
  it('defaults to 30 when there is no file, without logging', async () => {
    const log = vi.fn();
    expect(await readCleanupPeriodDays(settingsFile(), log)).toBe(30);
    expect(log).not.toHaveBeenCalled();
  });

  it('defaults to 30 when the key is unset (the spike machine)', async () => {
    const path = settingsFile(JSON.stringify({ model: 'opus', hooks: {}, theme: 'dark' }));
    expect(await readCleanupPeriodDays(path, vi.fn())).toBe(30);
  });

  it('reads the value, and 0 means Claude Code never cleans up', async () => {
    expect(await readCleanupPeriodDays(settingsFile('{"cleanupPeriodDays":90}'), vi.fn())).toBe(90);
    expect(await readCleanupPeriodDays(settingsFile('{"cleanupPeriodDays":0}'), vi.fn())).toBe(
      null,
    );
  });

  it.each([
    ['not JSON', '{'],
    ['a string', '{"cleanupPeriodDays":"30"}'],
    ['negative', '{"cleanupPeriodDays":-1}'],
    ['a fraction', '{"cleanupPeriodDays":1.5}'],
  ])('logs and defaults to 30 when the file is %s', async (_, text) => {
    const log = vi.fn();
    expect(await readCleanupPeriodDays(settingsFile(text), log)).toBe(30);
    expect(log).toHaveBeenCalledOnce();
  });
});
