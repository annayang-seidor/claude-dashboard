import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pageConfig, SERVER_HOST, TOKEN_QUERY_PARAM } from '../shared/config';
import { allowLists, createApp } from './app';
import { cleanupWarnings, loadConfig, resolveWorkspaces } from './config';
import { readHacEnvs } from './hac';
import { createEventHub } from './events';
import { createJiraAuth, jiraRedirectUri } from './jira/auth';
import { createJiraClient, type JiraClient } from './jira/client';
import type { AtlassianApp } from './jira/env';
import { createIndexer } from './indexer';
import { createAutoArchive } from './jobs/autoArchive';
import { createDailyJobs } from './jobs/daily';
import { createJiraInbox } from './jobs/jiraInbox';
import { createJiraTitles } from './jobs/jiraTitles';
import type { Runner } from './jobs/runner';
import { createLauncher, type Launcher } from './launch';
import { listen } from './listen';
import { readCleanupPeriodDays } from './retention';
import { createSessionService, type SessionService } from './sessions';
import { openStateStore } from './state';
import { createTrash } from './trash';
import { runnerProjectFolder, watchProjects } from './watch';

/** Every path and secret the server uses, so tests can run one on fixtures (ADR 0028). */
export interface StartOptions {
  /** Home folder that `~` in workspace roots and the runner folder resolve against. */
  home: string;
  /** ~/.claude/projects. Read, watched, and the source and target of trash moves. */
  projectsRoot: string;
  /** ~/.claude/settings.json, read for cleanupPeriodDays only. */
  claudeSettingsPath: string;
  /** ~/.claude-dashboard: state.json, config.json, trash/ and the url file. */
  dashboardDir: string;
  /** The repo's dashboard.config.json, read before `<dashboardDir>/config.json` (ADR 0058).
   * Unset in tests, so they see only their own config. */
  projectConfigPath?: string;
  /** hac's `<project>.toml` folder (ADR 0035). Defaults to `<home>/.hac/projects`. */
  hacProjectsDir?: string;
  port: number;
  token: string;
  /** The token before the last rotation, traded in by old tabs (ADR 0048). */
  previousToken?: string | null;
  /** Vite origin in dev (`pnpm dev`); the printed link points there. */
  webOrigin?: string;
  /** Built page to serve (dist/web). */
  webRoot?: string;
  /** Defaults to the osascript launcher with the terminal from the config. */
  launcher?: Launcher;
  /** Headless `claude -p` runner. Required, so a test cannot reach the real Jira by default. */
  runner: Runner;
  /** The Atlassian OAuth app from the repo's .env (ADR 0062). Unset in tests, so Jira stays
   * unconfigured unless a test passes one with a fake `fetch`. */
  atlassianApp?: AtlassianApp | null;
  /** For the Jira OAuth calls; replaced in tests. */
  fetch?: typeof fetch;
  /** Jira reads for the titles and inbox jobs. Defaults to the REST client on the stored login,
   * which reaches nothing without `atlassianApp` (ADR 0063). */
  jira?: JiraClient;
}

export interface Started {
  /** The page link with the token, also written to `<dashboardDir>/url`. */
  url: string;
  close(): Promise<void>;
}

/** The spec's speed target: the list visible within 1 s of opening. */
const TARGET_MS = 1000;

const timing = (label: string, ms: number) =>
  (ms > TARGET_MS ? console.warn : console.log)(
    `[startup] ${label} ${Math.round(ms)} ms${ms > TARGET_MS ? ` (over the ${TARGET_MS} ms target)` : ''}`,
  );

/** Logs how long the first list request took: the page's first paint waits on it. */
function timeFirstList(sessions: SessionService): SessionService {
  let logged = false;
  return {
    ...sessions,
    async list(workspace) {
      const started = performance.now();
      const result = await sessions.list(workspace);
      if (!logged) {
        logged = true;
        timing(
          `first list (${workspace}, ${result.length} sessions) took`,
          performance.now() - started,
        );
      }
      return result;
    },
  };
}

/** Starts the server. Throws ConfigError, before touching anything, when a config file is
 * invalid (ADR 0060). */
export async function start(opts: StartOptions): Promise<Started> {
  const { home, projectsRoot, dashboardDir } = opts;
  // Read once: a config change takes effect on the next restart (ADR 0060).
  const config = await loadConfig([
    ...(opts.projectConfigPath ? [opts.projectConfigPath] : []),
    join(dashboardDir, 'config.json'),
  ]);
  for (const warning of cleanupWarnings(
    config,
    await readCleanupPeriodDays(opts.claudeSettingsPath),
  )) {
    console.warn(`[config] ${warning}`);
  }
  const workspaces = resolveWorkspaces(config.workspaces, home);
  const work = workspaces.filter((w) => w.kind === 'work');

  await mkdir(dashboardDir, { recursive: true });
  const state = await openStateStore({ path: join(dashboardDir, 'state.json') });
  const hacDir = opts.hacProjectsDir ?? join(home, '.hac', 'projects');
  const sessions = createSessionService({
    indexer: createIndexer({ projectsRoot, home, workspaces }),
    state,
    projectsRoot,
    workRoot: (work[0] ?? workspaces.find((w) => w.fallback)!).root,
    workIds: work.map((w) => w.id),
    envs: async () => ({ envs: await readHacEnvs(hacDir) }),
  });
  const trash = createTrash({
    state,
    projectsRoot,
    trashDir: join(dashboardDir, 'trash'),
    locate: async (id) => (await sessions.resumable(id))?.filePath ?? null,
    retentionDays: config.trash.retentionDays,
  });
  const launcher = opts.launcher ?? createLauncher({ terminal: async () => config.terminal });
  const events = createEventHub();
  const autoArchive = createAutoArchive({
    sessions,
    trash,
    state,
    workspaces: config.workspaces,
    logPath: join(dashboardDir, 'activity.log'),
    onMoved: () => events.emit(),
  });
  // Both are safe to repeat (ADR 0031).
  const daily = createDailyJobs({
    jobs: [
      { name: 'trash-purge', run: () => trash.purge() },
      ...(config.autoArchive.enabled ? [{ name: 'auto-archive', run: autoArchive }] : []),
    ],
    state,
    intervalMs: config.jobs.dailyIntervalHours * 60 * 60 * 1000,
  });
  await daily.start();
  await sessions.rescan(); // startup prune

  // Read on first use, then kept in memory; the file is the dashboard's, mode 600 (ADR 0062).
  const jiraAuth = createJiraAuth({
    app: opts.atlassianApp ?? null,
    tokenPath: join(dashboardDir, 'jira-oauth.json'),
    redirectUri: jiraRedirectUri(opts.port),
    siteUrl: config.jiraBaseUrl ?? null,
    fetch: opts.fetch,
  });
  const pageOrigin = opts.webOrigin ?? `http://${SERVER_HOST}:${opts.port}`;
  const jira = opts.jira ?? createJiraClient({ auth: jiraAuth, fetch: opts.fetch });

  // Jira belongs to Work-kind workspaces (spec § Jira); personal ticket keys are not looked up.
  const jiraTitles = createJiraTitles({
    jira,
    state,
    keys: async () =>
      (await Promise.all(work.map((w) => sessions.list(w.id))))
        .flat()
        .flatMap((s) => (s.ticketKey ? [s.ticketKey] : [])),
    onChanged: () => events.emit(),
    ttlMs: config.jira.titleTtlHours * 60 * 60 * 1000,
  });
  // In the background: a run takes seconds and the page never waits for it (spec § Speed).
  void jiraTitles.refresh();

  // On start and every 45 min, Mon–Fri 09:00–19:00 by default, in the background (ADR 0042).
  const jiraInbox = createJiraInbox({
    runner: opts.runner,
    jira,
    state,
    schedule: config.jira,
    onChanged: () => events.emit(),
  });
  jiraInbox.start();

  const watcher = watchProjects({
    projectsRoot,
    ignore: [runnerProjectFolder(projectsRoot, home)],
    onChange: () => {
      sessions.rescan().then(
        () => {
          events.emit();
          // Runs only for keys with no fresh entry, so most rescans start nothing.
          void jiraTitles.refresh();
        },
        (err: Error) => console.warn(`[sessions] rescan failed: ${err.message}`),
      );
    },
  });

  const app = createApp({
    ...allowLists(opts.port, opts.webOrigin),
    token: opts.token,
    previousToken: opts.previousToken,
    webRoot: opts.webRoot,
    api: {
      sessions: timeFirstList(sessions),
      events,
      launcher,
      trash,
      state,
      jiraTitles,
      jiraInbox,
      config: pageConfig(config),
      jiraBaseUrl: config.jiraBaseUrl ?? null,
      retention: () => readCleanupPeriodDays(opts.claudeSettingsPath),
    },
    jira: { auth: jiraAuth, pageOrigin, onChanged: () => events.emit() },
  });

  const { server } = await listen(app, opts.port);
  // performance.now() counts from process start, so this includes tsx start-up and the first index.
  timing('ready to serve after', performance.now());

  const url = `${pageOrigin}/?${TOKEN_QUERY_PARAM}=${opts.token}`;
  // The token is a secret: owner-only, and chmod in case the file already existed (ADR 0032).
  const urlFile = join(dashboardDir, 'url');
  await writeFile(urlFile, url + '\n', { mode: 0o600 });
  await chmod(urlFile, 0o600);

  return {
    url,
    async close() {
      daily.stop();
      jiraTitles.stop();
      jiraInbox.stop();
      await watcher.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
