import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { SERVER_PORT } from '../shared/config';
import { ConfigError, PROJECT_CONFIG_PATH } from './config';
import { ENV_PATH, readAtlassianApp } from './jira/env';
import { createRunner } from './jobs/runner';
import { CLAUDE_SETTINGS_PATH } from './retention';
import { start } from './start';
import { loadPreviousToken, loadToken } from './token';

// `--rotate-token`: replace the stored token; open tabs can trade the old one in (ADR 0048).
// `--revoke-token`: replace it and drop the old one, e.g. after the link leaked; open tabs then
// need the new link.
const { values: args } = parseArgs({
  options: { 'rotate-token': { type: 'boolean' }, 'revoke-token': { type: 'boolean' } },
});

const env = z
  .object({
    // Set by `pnpm dev`: the Vite origin the page is loaded from.
    DASHBOARD_WEB_ORIGIN: z.url().optional(),
  })
  .parse(process.env);

const webRoot = fileURLToPath(new URL('../../dist/web', import.meta.url));
const serveBuild = !env.DASHBOARD_WEB_ORIGIN && existsSync(webRoot);
const home = homedir();
const dashboardDir = join(home, '.claude-dashboard');
const tokenPath = join(dashboardDir, 'token');
// Kept across restarts so open tabs keep working (ADR 0032); a rotation keeps the old one so
// those tabs can trade it in (ADR 0048).
const token = await loadToken(tokenPath, {
  rotate: args['rotate-token'] || args['revoke-token'],
  revoke: args['revoke-token'],
});

/** No fallback to defaults: the message names the file and key to fix (ADR 0060). */
function exitOnConfigError(err: unknown): never {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1);
}

// Read here, not into process.env, so `claude -p` runs never inherit the secret (ADR 0062).
const atlassianApp = await readAtlassianApp(ENV_PATH).catch(exitOnConfigError);

const { url } = await start({
  home,
  projectsRoot: join(home, '.claude', 'projects'),
  claudeSettingsPath: CLAUDE_SETTINGS_PATH,
  dashboardDir,
  projectConfigPath: PROJECT_CONFIG_PATH,
  port: SERVER_PORT,
  token,
  previousToken: await loadPreviousToken(tokenPath),
  webOrigin: env.DASHBOARD_WEB_ORIGIN,
  webRoot: serveBuild ? webRoot : undefined,
  runner: createRunner({
    // Its project folder is skipped by the indexer and watcher (ADR 0015) as a backup to
    // --no-session-persistence.
    cwd: join(dashboardDir, 'runner'),
    logPath: join(dashboardDir, 'activity.log'),
  }),
  atlassianApp,
}).catch(exitOnConfigError);

// Not under launchd, where stdout is a log file that would keep the token (ADR 0032). `pnpm
// dev` pipes stdout through concurrently, so it is no TTY but still wants the link.
if (process.stdout.isTTY || env.DASHBOARD_WEB_ORIGIN) {
  console.log(`Session Dashboard: ${terminalLink(url)}`);
}
console.log('Open the dashboard: open "$(cat ~/.claude-dashboard/url)"');
if (!env.DASHBOARD_WEB_ORIGIN && !serveBuild) {
  console.log('No dist/web found: run `pnpm build` first, or use `pnpm dev`.');
}

/** OSC 8 hyperlink, so the link is clickable (Cmd-click) in iTerm2, VS Code and Terminal.app.
 * Terminals without OSC 8 drop the escapes and show the plain url. */
function terminalLink(href: string) {
  return `\x1b]8;;${href}\x1b\\${href}\x1b]8;;\x1b\\`;
}
