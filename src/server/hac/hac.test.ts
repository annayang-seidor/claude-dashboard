import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isProd } from '../../shared/env';
import { readHacEnvs } from './index';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/hac-cli/acme.toml');

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

function projectsDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'hac-test-'));
  dirs.push(dir);
  copyFileSync(FIXTURE, join(dir, 'acme.toml'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** Every url, username and password string in the fixture. */
function secrets(): string[] {
  const doc = parse(readFileSync(FIXTURE, 'utf8')) as {
    envs: Record<string, Record<string, unknown>>;
  };
  const values = Object.values(doc.envs).flatMap((t) => [t.url, t.username, t.password]);
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

describe('readHacEnvs', () => {
  it('reads table names and gate flags from the fixture', async () => {
    const envs = await readHacEnvs(projectsDir(), vi.fn());
    const flags = { allowSqlCommit: false, allowGroovyCommit: false, allowImpexImport: false };
    expect(envs).toEqual([
      {
        project: 'acme',
        name: 'd3',
        readOnly: false,
        ...flags,
        allowGroovyCommit: true,
        allowImpexImport: true,
      },
      {
        project: 'acme',
        name: 'local',
        readOnly: false,
        allowSqlCommit: true,
        allowGroovyCommit: true,
        allowImpexImport: true,
      },
      { project: 'acme', name: 'p1', readOnly: true, ...flags },
      {
        project: 'acme',
        name: 's1',
        readOnly: false,
        ...flags,
        allowGroovyCommit: true,
        allowImpexImport: true,
      },
    ]);
  });

  it('skips .toml.example files and is silent when the folder is missing', async () => {
    const log = vi.fn();
    const dir = projectsDir({ 'acme.toml.example': '[envs.d1]\n' });
    expect(new Set((await readHacEnvs(dir, log)).map((e) => e.project))).toEqual(new Set(['acme']));
    expect(await readHacEnvs(join(dir, 'missing'), log)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('skips a broken file with its position and keeps the others', async () => {
    const log = vi.fn();
    const dir = projectsDir({ 'acme.toml': '[envs.d1]\npassword = "acme-pw" oops\n' });
    const envs = await readHacEnvs(dir, log);
    expect(envs.every((e) => e.project === 'acme')).toBe(true);
    expect(log).toHaveBeenCalledWith('acme.toml: not valid TOML (line 2, column 22); skipped');
  });

  it('never lets a url, username or password reach the result, the log or the console', async () => {
    const all = [...secrets(), 'acme-pw', 'acme-user', 'https://acme.example.invalid/hac'];
    expect(secrets().length).toBeGreaterThanOrEqual(9);
    const console_ = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const dir = projectsDir({
      'acme.toml':
        '[envs.d1]\nurl = "https://acme.example.invalid/hac"\nusername = "acme-user"\npassword = "acme-pw" oops\n',
      'weird.toml': 'envs = ["acme-pw"]\n',
      'bad.toml': '[envs]\n"acme-pw" = 1\n',
    });
    // Default logger, so anything logged goes through the console spies.
    const envs = await readHacEnvs(dir);
    const output = [
      JSON.stringify(envs),
      ...console_.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' '))),
    ].join('\n');
    expect(console_.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    const leaked = all.filter((s) => output.includes(s)).length;
    expect(leaked, 'a secret value reached the output').toBe(0);
  });
});

describe('isProd', () => {
  const env = (name: string, readOnly = false) => ({ project: 'acme', name, readOnly });

  it.each(['p1', 'P12', 'prod', 'Prod-eu', 'PRODUCTION'])('%s is production by name', (name) => {
    expect(isProd(env(name))).toBe(true);
  });

  it.each(['s1', 'd3', 'local', 'p', 'preprod', 'qa-p1'])(
    '%s is not production by name',
    (name) => {
      expect(isProd(env(name))).toBe(false);
    },
  );

  it('read_only = true makes any env production', () => {
    expect(isProd(env('s1', true))).toBe(true);
  });
});
