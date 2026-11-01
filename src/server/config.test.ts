import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/config';
import { cleanupWarnings, ConfigError, expandHome, loadConfig, resolveWorkspaces } from './config';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function configFile(content?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'config-test-'));
  dirs.push(dir);
  const path = join(dir, 'config.json');
  if (content !== undefined) {
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return path;
}

async function loadError(paths: string[]): Promise<string> {
  const err = await loadConfig(paths).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConfigError);
  return (err as Error).message;
}

const side = {
  id: 'side',
  label: 'Side projects',
  root: '~/side',
  kind: 'personal',
  autoArchiveDays: 10,
};

describe('loadConfig: defaults', () => {
  it("gives today's values when there is no file", async () => {
    expect(await loadConfig([configFile()])).toEqual(DEFAULT_CONFIG);
  });

  it('has a default for every key', () => {
    expect(DEFAULT_CONFIG).toEqual({
      terminal: 'iterm',
      workspaces: [
        {
          id: 'work',
          label: { en: 'Work', 'zh-TW': '工作' },
          root: '~/y',
          kind: 'work',
          fallback: false,
          autoArchiveDays: 7,
        },
        {
          id: 'personal',
          label: { en: 'Personal', 'zh-TW': '個人' },
          root: '~/o',
          kind: 'personal',
          fallback: true,
          autoArchiveDays: 14,
        },
      ],
      cleanup: {
        ranges: [7, 14],
        defaultRange: 14,
        customStartDays: 21,
        keepBookmarked: true,
        keepTodo: true,
      },
      autoArchive: { enabled: true },
      trash: { retentionDays: 7 },
      retentionWarnDays: 7,
      undoMs: 8000,
      jobs: { dailyIntervalHours: 6 },
      jira: {
        syncIntervalMinutes: 45,
        syncWindow: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 19 },
        changedDays: 2,
        maxDays: 7,
        mentionDays: 3,
        titleTtlHours: 24,
      },
    });
  });

  it('fills the rest of a nested object a file sets only partly', async () => {
    const config = await loadConfig([configFile({ jira: { syncWindow: { endHour: 18 } } })]);
    expect(config.jira.syncWindow).toEqual({ days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 });
    expect(config.jira.syncIntervalMinutes).toBe(45);
  });

  it('reads the Jira base URL without its trailing slash', async () => {
    const path = configFile({ jiraBaseUrl: 'https://example.atlassian.net/' });
    expect((await loadConfig([path])).jiraBaseUrl).toBe('https://example.atlassian.net');
  });

  it('defaults a workspace to not being the fallback', async () => {
    const work = { ...side, id: 'work', kind: 'work' };
    const config = await loadConfig([
      configFile({ workspaces: [work, { ...side, fallback: true }] }),
    ]);
    expect(config.workspaces.map((w) => w.fallback)).toEqual([false, true]);
  });
});

describe('loadConfig: override order', () => {
  it('lets the later (home) file win per key, keeping the project keys it does not set', async () => {
    const project = configFile({
      terminal: 'terminal',
      jiraBaseUrl: 'https://example.atlassian.net',
      trash: { retentionDays: 10 },
    });
    const home = configFile({ terminal: 'iterm' });
    const config = await loadConfig([project, home]);
    expect(config.terminal).toBe('iterm');
    expect(config.jiraBaseUrl).toBe('https://example.atlassian.net');
    expect(config.trash.retentionDays).toBe(10);
  });

  it('merges nested objects key by key', async () => {
    const project = configFile({ cleanup: { ranges: [7, 14, 21], keepTodo: false } });
    const home = configFile({ cleanup: { defaultRange: 21 } });
    expect((await loadConfig([project, home])).cleanup).toEqual({
      ranges: [7, 14, 21],
      defaultRange: 21,
      customStartDays: 21,
      keepBookmarked: true,
      keepTodo: false,
    });
  });

  it('replaces lists whole: a home workspace list is the only list', async () => {
    const project = configFile({ workspaces: [{ ...side, fallback: true }] });
    const home = configFile({ workspaces: [{ ...side, id: 'other', fallback: true }] });
    expect((await loadConfig([project, home])).workspaces.map((w) => w.id)).toEqual(['other']);
  });

  it('skips a missing file', async () => {
    const home = configFile({ undoMs: 5000 });
    expect((await loadConfig([configFile(), home])).undoMs).toBe(5000);
  });
});

describe('loadConfig: invalid config fails, naming the file and key', () => {
  it.each([
    ['broken JSON', '{"terminal":', /is not valid JSON/],
    ['a non-object', '[]', /must be a JSON object/],
    ['an unknown terminal', { terminal: 'not-a-terminal' }, /: terminal: /],
    ['an unknown key', { termnial: 'iterm' }, /: unknown key termnial$/],
    ['an unknown nested key', { cleanup: { range: [7] } }, /: unknown key cleanup\.range$/],
    ['the removed prodEnvs key', { prodEnvs: { acme: ['s9'] } }, /: unknown key prodEnvs$/],
    [
      'a plain-http Jira base URL',
      { jiraBaseUrl: 'http://example.atlassian.net' },
      /: jiraBaseUrl: /,
    ],
    ['a javascript: Jira base URL', { jiraBaseUrl: 'javascript:alert(1)' }, /: jiraBaseUrl: /],
    [
      'a range of 0 days',
      { cleanup: { ranges: [0] } },
      /: cleanup\.ranges\[0\]: expected a whole number of days from 1 to 365$/,
    ],
    [
      'days as text',
      { trash: { retentionDays: '7' } },
      /: trash\.retentionDays: expected a whole number of days/,
    ],
    [
      'a mention window over a week',
      { jira: { mentionDays: 8 } },
      /: jira\.mentionDays: expected a whole number of days from 1 to 7$/,
    ],
    [
      'a relative root',
      { workspaces: [{ ...side, root: 'side', fallback: true }] },
      /: workspaces\[0\]\.root: expected an absolute path or one starting with ~\/$/,
    ],
    [
      'an id with capitals',
      { workspaces: [{ ...side, id: 'Side', fallback: true }] },
      /: workspaces\[0\]\.id: expected a lowercase id/,
    ],
    [
      'an unknown kind',
      { workspaces: [{ ...side, kind: 'ops', fallback: true }] },
      /: workspaces\[0\]\.kind: /,
    ],
    [
      'no fallback',
      { workspaces: [side] },
      /: workspaces: expected exactly one workspace with "fallback": true, found 0$/,
    ],
    [
      'two fallbacks',
      {
        workspaces: [
          { ...side, fallback: true },
          { ...side, id: 'b', fallback: true },
        ],
      },
      /found 2$/,
    ],
    [
      'a duplicate id',
      { workspaces: [{ ...side, fallback: true }, side] },
      /: workspaces\[1\]\.id: expected a unique id; "side" is used twice$/,
    ],
    ['no workspaces', { workspaces: [] }, /: workspaces: expected at least one workspace$/],
  ])('%s', async (_label, content, message) => {
    const path = configFile(content);
    const text = await loadError([path]);
    expect(text).toContain(path);
    expect(text).toMatch(message);
  });

  it('does not fall back to the other file or the defaults', async () => {
    const project = configFile({ jiraBaseUrl: 'https://example.atlassian.net' });
    const home = configFile({ terminal: 'not-a-terminal' });
    expect(await loadError([project, home])).toContain(home);
  });

  it('checks keys that depend on each other after merging, blaming the file that set the key', async () => {
    const project = configFile({ cleanup: { ranges: [7, 14] } });
    const home = configFile({ cleanup: { defaultRange: 21 } });
    expect(await loadError([project, home])).toBe(
      `Invalid config in ${home}: cleanup.defaultRange: expected one of cleanup.ranges (7, 14), got 21`,
    );
  });

  it('a default range left out of new ranges blames the file that set the ranges', async () => {
    const project = configFile({ undoMs: 5000 });
    const home = configFile({ cleanup: { ranges: [3, 5] } });
    expect(await loadError([project, home])).toBe(
      `Invalid config in ${home}: cleanup.defaultRange: expected one of cleanup.ranges (3, 5), got 14`,
    );
  });

  it('rejects a sync window that ends before it starts', async () => {
    const home = configFile({ jira: { syncWindow: { startHour: 20 } } });
    expect(await loadError([home])).toMatch(
      /jira\.syncWindow\.endHour: expected an hour after startHour \(20\), got 19$/,
    );
  });
});

describe('shipped files', () => {
  const shipped = (name: string) => fileURLToPath(new URL(`../../${name}`, import.meta.url));
  // The example's comments are whole lines, so dropping them leaves the JSON a user copies.
  const example = () =>
    JSON.parse(
      readFileSync(shipped('dashboard.config.example.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
    );

  it('dashboard.config.json is valid', async () => {
    await expect(loadConfig([shipped('dashboard.config.json')])).resolves.toBeTruthy();
  });

  it('the example, without its comments, is a valid config', async () => {
    await expect(loadConfig([configFile(example())])).resolves.toBeTruthy();
  });

  it('the example sets every key, at its default', () => {
    const keys = Object.keys(example());
    expect(keys.sort()).toEqual([...Object.keys(DEFAULT_CONFIG), 'jiraBaseUrl'].sort());
    // jiraBaseUrl shows a sample value; it has no default.
    expect({ ...example(), jiraBaseUrl: undefined }).toEqual(DEFAULT_CONFIG);
  });

  it('a real config file with comments fails with a hint to remove them', async () => {
    const path = configFile('// my settings\n{ "terminal": "iterm" }');
    expect(await loadError([path])).toMatch(/remove them here\)/);
  });
});

describe('workspace roots', () => {
  it('expands ~ against the home folder', () => {
    expect(expandHome('~', '/h')).toBe('/h');
    expect(expandHome('~/y', '/h')).toBe('/h/y');
    expect(expandHome('/srv/code', '/h')).toBe('/srv/code');
  });

  it('resolves every workspace', () => {
    expect(resolveWorkspaces(DEFAULT_CONFIG.workspaces, '/h')).toEqual([
      { id: 'work', kind: 'work', root: '/h/y', fallback: false },
      { id: 'personal', kind: 'personal', root: '/h/o', fallback: true },
    ]);
  });
});

describe('cleanupWarnings', () => {
  it('says nothing for the defaults under the 30-day default', () => {
    expect(cleanupWarnings(DEFAULT_CONFIG, 30)).toEqual([]);
  });

  it('names each range and auto-archive age at or over cleanupPeriodDays', () => {
    const config = {
      ...DEFAULT_CONFIG,
      cleanup: { ...DEFAULT_CONFIG.cleanup, ranges: [7, 14, 30] },
    };
    expect(cleanupWarnings(config, 14)).toEqual([
      expect.stringMatching(/^cleanup\.ranges\[1\] is 14 days, at or over .*\(14\)/),
      expect.stringMatching(/^cleanup\.ranges\[2\] is 30 days/),
      expect.stringMatching(/^workspaces\[1\]\.autoArchiveDays is 14 days/),
    ]);
  });

  it("says nothing when Claude Code's cleanup is off", () => {
    expect(cleanupWarnings(DEFAULT_CONFIG, null)).toEqual([]);
  });
});
