// The real server on a temp copy of fixtures/projects for the Playwright smoke (ADR 0028).
// Nothing under ~/.claude or ~/.claude-dashboard is read or written.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDay } from '../../src/server/jobs/daily';
import { start } from '../../src/server/start';
import { E2E_JIRA_TITLE, E2E_PORT, E2E_TOKEN } from './env';

const repo = fileURLToPath(new URL('../..', import.meta.url));
// Fixture cwds were recorded under this home folder; it decides Work vs Personal, nothing more.
const HOME = '/Users/annayang';

const dir = mkdtempSync(join(tmpdir(), 'dashboard-e2e-'));
const projectsRoot = join(dir, 'projects');
cpSync(join(repo, 'fixtures', 'projects'), projectsRoot, { recursive: true });
// One Work session with hac calls (an S1 Ops group); envs come from the fake toml, never ~/.hac.
const hacFixtures = join(repo, 'fixtures', 'hac-cli');
const hacSession = 'aaaaaaaa-1111-4111-8111-000000000001.jsonl';
cpSync(
  join(hacFixtures, hacSession),
  join(projectsRoot, '-Users-annayang-y-acme-shop', hacSession),
);

// Fixture dates are fixed, so a real-clock auto-archive would trash a different set each day and
// the row counts would drift. Record it as done today; its unit tests use a fixed clock.
const dashboardDir = join(dir, 'dashboard');
mkdirSync(dashboardDir);
writeFileSync(
  join(dashboardDir, 'state.json'),
  JSON.stringify({
    version: 1,
    sessions: {},
    sync: {},
    jobs: { 'auto-archive': localDay(new Date()) },
  }),
);

const server = await start({
  home: HOME,
  projectsRoot,
  claudeSettingsPath: join(dir, 'settings.json'),
  dashboardDir,
  hacProjectsDir: hacFixtures,
  port: E2E_PORT,
  token: E2E_TOKEN,
  webRoot: join(repo, 'dist', 'web'),
  // Never open a real terminal from a test.
  launcher: {
    open: async (cwd, argv) => console.log(`[e2e] not launching ${argv.join(' ')} in ${cwd}`),
  },
  // Never run claude -p from a test; with no inbox issues it is not called anyway.
  runner: { run: async () => ({ ok: true, data: { items: [] } as never }) },
  // Never reach Jira from a test: one canned title, every other key missing, an empty inbox.
  jira: {
    search: async ({ jql }) =>
      jql.includes('ACME-608')
        ? [
            {
              id: '608',
              key: 'ACME-608',
              fields: { summary: E2E_JIRA_TITLE, status: { name: '[AM] DONE' } },
            },
          ]
        : [],
    issue: async () => null,
    myself: async () => ({ accountId: 'e2e', displayName: 'E2E' }),
  },
});
console.log(`[e2e] serving ${projectsRoot} at ${server.url}`);

const stop = async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
