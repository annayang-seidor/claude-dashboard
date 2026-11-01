import { spawn as nodeSpawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { NO_CONTROL_CHARS } from '../../shared/api';
import type { TerminalApp } from '../../shared/config';
import type { TerminalAdapter } from './adapter';
import { iterm } from './iterm';
import { terminalApp } from './terminal-app';

export { OSASCRIPT } from './adapter';
export type { PlanRequest, SpawnPlan, TerminalAdapter } from './adapter';

export const ADAPTERS: Record<TerminalApp, TerminalAdapter> = { iterm, terminal: terminalApp };

const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

/** One shell word. Plain words stay bare, so `claude` still finds a shell alias; anything else is
 * single-quoted, which is safe for every character, quotes and newlines included. */
export function shellWord(s: string): string {
  return SHELL_SAFE.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

/** What the new tab's shell runs: `cd <cwd> && <argv>`. The cwd comes from a transcript, so it is
 * checked like the session name: the line is typed into a shell, where a newline would run it. */
export function shellLine(cwd: string, argv: readonly string[]): string {
  if (!NO_CONTROL_CHARS.test(cwd)) throw new Error('cwd has control characters');
  return `cd ${shellWord(cwd)} && ${argv.map(shellWord).join(' ')}`;
}

export function resumeArgv(id: string): string[] {
  return ['claude', '--resume', id];
}

/** `--session-id` lets the dashboard know the transcript's id before it exists (spike Q5).
 * `--name` writes a custom-title line before the first prompt (spike § 13). The route already
 * rejects control characters; this throws too, so nothing else can slip a newline into the line. */
export function newSessionArgv(id: string, ticketKey: string, name?: string): string[] {
  if (name !== undefined && !NO_CONTROL_CHARS.test(name)) {
    throw new Error('session name has control characters');
  }
  return [
    'claude',
    '--session-id',
    id,
    ...(name ? ['--name', name] : []),
    `Let's work on Jira ticket ${ticketKey}.`,
  ];
}

/** The osascript call that opens `app` and types `line` into it. */
export function osascriptArgs(app: TerminalApp, line: string): string[] {
  return ADAPTERS[app].plan({ cwd: '', argv: [], shellLine: line }).args;
}

export interface Launcher {
  /** Opens a terminal running `argv` in `cwd`. Resolves once the terminal's process has started. */
  open(cwd: string, argv: readonly string[]): Promise<void>;
}

const APP_DIRS = [
  '/Applications',
  join(homedir(), 'Applications'),
  '/System/Applications/Utilities',
];

/** True when `bundle` (e.g. `iTerm.app`) is in /Applications, ~/Applications or Utilities. */
export async function bundleInstalled(bundle: string): Promise<boolean> {
  for (const dir of APP_DIRS) {
    if (
      await stat(join(dir, bundle)).then(
        (s) => s.isDirectory(),
        () => false,
      )
    )
      return true;
  }
  return false;
}

export interface LauncherOptions {
  /** Read on every launch, so a config.json edit applies without a restart. */
  terminal: () => Promise<TerminalApp>;
  spawn?: typeof nodeSpawn;
  /** Defaults to `bundleInstalled`; tests pass a stub so they never touch the disk. */
  appInstalled?: (bundle: string) => Promise<boolean>;
  log?: (message: string) => void;
}

export function createLauncher(opts: LauncherOptions): Launcher {
  const spawn = opts.spawn ?? nodeSpawn;
  const appInstalled = opts.appInstalled ?? bundleInstalled;
  const log = opts.log ?? ((m: string) => console.warn(`[launch] ${m}`));
  return {
    async open(cwd, argv) {
      const adapter = ADAPTERS[await opts.terminal()];
      const line = shellLine(cwd, argv);
      if (!(await appInstalled(adapter.bundle))) {
        throw new Error(
          `${adapter.bundle} not found in /Applications, ~/Applications or Utilities`,
        );
      }
      const plan = adapter.plan({ cwd, argv, shellLine: line });
      const child = spawn(plan.file, plan.args, {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      // AppleScript errors (e.g. Automation permission denied) only show up after the reply.
      let stderr = '';
      child.stderr?.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      child.on('close', (code) => {
        if (code !== 0) log(`${basename(plan.file)} exited with ${code}: ${stderr.trim()}`);
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
    },
  };
}
