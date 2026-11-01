import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigResponse, RetentionResponse, SessionsResponse } from '../shared/api';
import { TOKEN_HEADER } from '../shared/config';
import { ConfigError } from './config';
import { localDay } from './jobs/daily';
import type { Runner } from './jobs/runner';
import { start, type Started } from './start';

const FIXTURES = fileURLToPath(new URL('../../fixtures/projects', import.meta.url));
// Fixture cwds were recorded under this home folder; nothing is read from it.
const HOME = '/Users/annayang';
// Not 4317, so a dashboard running on this machine does not collide.
const PORT = 4319;
const TOKEN = 'start-test-token';

// Never runs claude -p; records the jira-titles prompts it was given (the inbox runs only on
// weekday working hours, so it is left out).
const prompts: string[] = [];
const runner: Runner = {
  run: async (req) => {
    if (req.job === 'jira-titles') prompts.push(req.prompt);
    return { ok: false, reason: 'failed' };
  },
};

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  prompts.length = 0;
  vi.restoreAllMocks();
});

function fixtureDir(files: { config?: unknown; state?: unknown; settings?: unknown } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'start-test-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(FIXTURES, join(dir, 'projects'), { recursive: true });
  mkdirSync(join(dir, 'dashboard'));
  const write = (path: string, value: unknown) =>
    value !== undefined && writeFileSync(path, JSON.stringify(value));
  write(join(dir, 'dashboard', 'config.json'), files.config);
  write(join(dir, 'dashboard', 'state.json'), files.state);
  write(join(dir, 'settings.json'), files.settings);
  return dir;
}

const startIn = (dir: string) =>
  start({
    home: HOME,
    projectsRoot: join(dir, 'projects'),
    claudeSettingsPath: join(dir, 'settings.json'),
    dashboardDir: join(dir, 'dashboard'),
    port: PORT,
    token: TOKEN,
    launcher: { open: async () => {} },
    runner,
  });

async function started(dir = fixtureDir()): Promise<{ dir: string; server: Started }> {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const server = await startIn(dir);
  cleanups.push(() => server.close());
  return { dir, server };
}

const get = (path: string) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { [TOKEN_HEADER]: TOKEN } });

describe('start', () => {
  it('runs the daily jobs on start and records the day of each in state.json', async () => {
    const { dir } = await started();
    const state = JSON.parse(readFileSync(join(dir, 'dashboard', 'state.json'), 'utf8'));
    const today = localDay(new Date());
    expect(state.jobs).toEqual({ 'trash-purge': today, 'auto-archive': today });
    // Auto-archive logs every run, even one that moved nothing.
    const log = join(dir, 'dashboard', 'activity.log');
    expect(JSON.parse(readFileSync(log, 'utf8').trim())).toMatchObject({ job: 'auto-archive' });
    expect(statSync(log).mode & 0o777).toBe(0o600);
  });

  it('looks up the Work ticket keys in the background, never through a real claude', async () => {
    await started();
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0]).toContain('ACME-608');
  });

  it('writes the link to an owner-only url file', async () => {
    const { dir, server } = await started();
    expect(server.url).toBe(`http://127.0.0.1:${PORT}/?t=${TOKEN}`);
    const urlFile = join(dir, 'dashboard', 'url');
    expect(readFileSync(urlFile, 'utf8')).toBe(server.url + '\n');
    expect(statSync(urlFile).mode & 0o777).toBe(0o600);
  });

  it('tightens a url file that already existed with wider permissions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'start-test-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(join(dir, 'url'), 'old\n', { mode: 0o644 });
    const server = await start({
      home: HOME,
      projectsRoot: join(dir, 'none'),
      claudeSettingsPath: join(dir, 'settings.json'),
      dashboardDir: dir,
      port: PORT,
      token: TOKEN,
      launcher: { open: async () => {} },
      runner,
    });
    cleanups.push(() => server.close());
    expect(statSync(join(dir, 'url')).mode & 0o777).toBe(0o600);
  });

  it('serves the fixtures, reads the given settings file, and logs the first list once', async () => {
    const { dir } = await started();
    writeFileSync(join(dir, 'settings.json'), '{"cleanupPeriodDays":45}');
    const retention = RetentionResponse.parse(await (await get('/api/retention')).json());
    expect(retention.cleanupPeriodDays).toBe(45);

    const res = await get('/api/sessions?workspace=work');
    expect(SessionsResponse.parse(await res.json()).sessions.length).toBeGreaterThan(0);
    await get('/api/sessions?workspace=personal');
    const firstList = vi
      .mocked(console.log)
      .mock.calls.filter(([m]) => String(m).startsWith('[startup] first list'));
    expect(firstList).toHaveLength(1);
    expect(String(firstList[0]![0])).toMatch(
      /^\[startup\] first list \(work, \d+ sessions\) took \d+ ms/,
    );
  });
});

describe('start: config (ADR 0060, ADR 0061)', () => {
  const OUTSIDE = '0328999a-b8be-4c87-bbd8-3ed22bf1a42d'; // ~/Downloads/community-mcp
  const ids = async (workspace: string) =>
    SessionsResponse.parse(await (await get(`/api/sessions?workspace=${workspace}`)).json())
      .sessions;

  it('fails before serving when a config file is invalid, naming the file and key', async () => {
    const dir = fixtureDir({ config: { cleanup: { ranges: [0] } } });
    const err = await startIn(dir).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toBe(
      `Invalid config in ${join(dir, 'dashboard', 'config.json')}: cleanup.ranges[0]: ` +
        'expected a whole number of days from 1 to 365',
    );
    // Nothing was started: no url file, no state written.
    expect(() => statSync(join(dir, 'dashboard', 'url'))).toThrow();
    expect(() => statSync(join(dir, 'dashboard', 'state.json'))).toThrow();
  });

  it('warns at startup about a range at or over cleanupPeriodDays', async () => {
    await started(
      fixtureDir({
        config: { cleanup: { ranges: [7, 14, 21] } },
        settings: { cleanupPeriodDays: 20 },
      }),
    );
    const warnings = vi.mocked(console.warn).mock.calls.map(([m]) => String(m));
    expect(warnings).toContainEqual(
      expect.stringMatching(/^\[config\] cleanup\.ranges\[2\] is 21 days, at or over .*\(20\)/),
    );
  });

  it('serves the page its part of the config', async () => {
    const side = {
      id: 'side',
      label: 'Side',
      root: '~/side',
      kind: 'personal',
      autoArchiveDays: 10,
    };
    await started(
      fixtureDir({ config: { undoMs: 5000, workspaces: [{ ...side, fallback: true }] } }),
    );
    const config = ConfigResponse.parse(await (await get('/api/config')).json());
    expect(config.undoMs).toBe(5000);
    expect(config.workspaces).toEqual([{ ...side, fallback: true }]);
    expect(Object.keys(config)).not.toContain('terminal');
  });

  it('re-sorts sessions when a workspace root changes, keeping their state', async () => {
    const state = {
      version: 1,
      sessions: { [OUTSIDE]: { status: 'done', bookmarked: true, title: 'MCP notes' } },
      sync: {},
      // Fixed-date fixtures: keep auto-archive from trashing them on a real clock.
      jobs: { 'auto-archive': localDay(new Date()) },
    };
    // Outside ~/y and ~/o, the session is in the fallback workspace.
    const first = await started(fixtureDir({ state }));
    expect((await ids('personal')).map((s) => s.id)).toContain(OUTSIDE);
    await first.server.close();
    cleanups.pop();

    // Restart with a third workspace whose root holds it.
    const downloads = {
      id: 'downloads',
      label: 'Downloads',
      root: '~/Downloads',
      kind: 'personal',
      autoArchiveDays: 14,
    };
    writeFileSync(
      join(first.dir, 'dashboard', 'config.json'),
      JSON.stringify({
        workspaces: [
          { id: 'work', label: 'Work', root: '~/y', kind: 'work', autoArchiveDays: 7 },
          {
            id: 'personal',
            label: 'Personal',
            root: '~/o',
            kind: 'personal',
            fallback: true,
            autoArchiveDays: 14,
          },
          downloads,
        ],
      }),
    );
    await started(first.dir);
    expect((await ids('personal')).map((s) => s.id)).not.toContain(OUTSIDE);
    const moved = (await ids('downloads')).find((s) => s.id === OUTSIDE);
    expect(moved).toMatchObject({
      workspace: 'downloads',
      title: 'MCP notes',
      state: { status: 'done', bookmarked: true, title: 'MCP notes' },
    });
  });

  it('rejects a workspace that is not configured', async () => {
    await started();
    const res = await get('/api/sessions?workspace=downloads');
    expect(res.status).toBe(400);
  });
});
