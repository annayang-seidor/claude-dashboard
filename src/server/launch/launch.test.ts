import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADAPTERS,
  OSASCRIPT,
  createLauncher,
  newSessionArgv,
  osascriptArgs,
  resumeArgv,
  shellLine,
  shellWord,
  type LauncherOptions,
} from '.';

const ID = '0b9b65fb-c3dd-412c-8940-5d9abf034748';
const NASTY = `dir with 'single' "double" $HOME \`date\` & ; | * 中文`;

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

/** Runs `line` the way the new tab's shell would, and returns what it prints. */
const runInShell = (line: string) => execFileSync('/bin/sh', ['-c', line], { encoding: 'utf8' });

describe('shellWord', () => {
  it('leaves plain words bare, so `claude` can still be a shell alias', () => {
    expect(shellWord('claude')).toBe('claude');
    expect(shellWord('--resume')).toBe('--resume');
    expect(shellWord(ID)).toBe(ID);
    expect(shellWord('/Users/me/y/acme-shop')).toBe('/Users/me/y/acme-shop');
  });

  it('single-quotes anything else and escapes embedded single quotes', () => {
    expect(shellWord('a b')).toBe(`'a b'`);
    expect(shellWord(`it's`)).toBe(`'it'\\''s'`);
    expect(shellWord('')).toBe(`''`);
    expect(shellWord('~/y')).toBe(`'~/y'`);
  });
});

describe('shellLine', () => {
  it('builds cd <cwd> && claude --resume <id>', () => {
    expect(shellLine('/Users/me/y/acme-shop', resumeArgv(ID))).toBe(
      `cd /Users/me/y/acme-shop && claude --resume ${ID}`,
    );
    expect(shellLine("/tmp/dir with 'quote'", resumeArgv(ID))).toBe(
      `cd '/tmp/dir with '\\''quote'\\''' && claude --resume ${ID}`,
    );
  });

  it('really lands in a cwd with spaces, quotes and shell metacharacters', () => {
    const base = mkdtempSync(join(tmpdir(), 'launch-test-'));
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));
    const cwd = join(base, NASTY);
    mkdirSync(cwd);
    expect(runInShell(shellLine(cwd, ['pwd', '-P'])).trim()).toBe(realpathSync(cwd));
  });

  it.each([['line\nbreak'], ['carriage\rreturn'], ['nul\0'], ['sep\u2028']])(
    'throws for a cwd with a control character (%j)',
    (cwd) => {
      expect(() => shellLine(`/tmp/${cwd}`, resumeArgv(ID))).toThrow('cwd has control characters');
    },
  );

  it('passes every argument through unchanged', () => {
    const args = [NASTY, "Let's work on Jira ticket FA-554.", 'line\nbreak', ''];
    const out = runInShell(shellLine('/', ['printf', '[%s]\\n', ...args]));
    expect(out).toBe(args.map((a) => `[${a}]\n`).join(''));
  });
});

describe('claude argv', () => {
  it('resumes by id', () => {
    expect(resumeArgv(ID)).toEqual(['claude', '--resume', ID]);
  });

  it('starts a new session with a pre-assigned id and a first prompt naming the ticket', () => {
    expect(newSessionArgv(ID, 'FA-554')).toEqual([
      'claude',
      '--session-id',
      ID,
      "Let's work on Jira ticket FA-554.",
    ]);
    expect(shellLine('/Users/me/y/acme-shop', newSessionArgv(ID, 'FA-554'))).toBe(
      `cd /Users/me/y/acme-shop && claude --session-id ${ID} 'Let'\\''s work on Jira ticket FA-554.'`,
    );
  });

  it('adds --name before the prompt only when a name is given', () => {
    expect(newSessionArgv(ID, 'FA-554', 'FA-554 Fix the PDP')).toEqual([
      'claude',
      '--session-id',
      ID,
      '--name',
      'FA-554 Fix the PDP',
      "Let's work on Jira ticket FA-554.",
    ]);
    expect(newSessionArgv(ID, 'FA-554', '')).toEqual(newSessionArgv(ID, 'FA-554'));
  });

  it.each([
    [`it's "quoted"`],
    ['back\\slash \\n \\'],
    ['$(touch /tmp/pwned) `id` $HOME'],
    ['FA-554 🚀 修正 PDP'],
    ['-p --dangerously-skip-permissions'],
  ])('a name like %s reaches claude as one unchanged word', (name) => {
    const argv = newSessionArgv(ID, 'FA-554', name);
    // Swap claude for printf to see exactly what the shell hands it.
    const out = runInShell(shellLine('/', ['printf', '[%s]\\n', ...argv.slice(1)]));
    expect(out).toBe(
      argv
        .slice(1)
        .map((a) => `[${a}]\n`)
        .join(''),
    );
    expect(out).toContain(`[--name]\n[${name}]\n`);
  });

  it.each([['line\nbreak'], ['carriage\rreturn'], ['tab\there'], ['nul\0'], ['sep\u2028']])(
    'throws for a name with a control character (%j)',
    (name) => {
      expect(() => newSessionArgv(ID, 'FA-554', name)).toThrow('control characters');
    },
  );
});

describe('osascriptArgs', () => {
  const line = shellLine(NASTY, resumeArgv(ID));

  it.each(['iterm', 'terminal'] as const)(
    '%s: passes the shell line as an argument, never inside the script',
    (app) => {
      const [flag, script, arg, ...rest] = osascriptArgs(app, line);
      expect(flag).toBe('-e');
      expect(arg).toBe(line);
      expect(rest).toEqual([]);
      expect(script).toContain('on run argv');
      expect(script).toContain('set shellLine to item 1 of argv');
      expect(script).not.toContain(NASTY);
    },
  );

  it('iterm: new tab in the current window when running, first window when just launched', () => {
    const script = osascriptArgs('iterm', line)[1]!;
    expect(script).toContain('application "iTerm" is running');
    expect(script).toContain('create tab with default profile');
    expect(script).toContain('create window with default profile');
    expect(script).toContain('current session of first window');
    expect(script).toContain('write text shellLine');
  });

  it('terminal: new window when running, the launched window when not (no extra empty one)', () => {
    const script = osascriptArgs('terminal', line)[1]!;
    expect(script).toContain('application "Terminal" is running');
    expect(script).toContain('repeat 50 times');
    expect(script).toContain('do script shellLine in window 1');
    expect(script).not.toContain('make new tab');
    expect(script).not.toContain('keystroke');
  });
});

describe('adapter plan()', () => {
  const req = { cwd: NASTY, argv: resumeArgv(ID), shellLine: shellLine(NASTY, resumeArgv(ID)) };

  it('iterm: osascript with the shell line as its only argument; tab capable, no argv, no sync result', () => {
    const { iterm } = ADAPTERS;
    expect(iterm.id).toBe('iterm');
    expect(iterm.bundle).toBe('iTerm.app');
    expect(iterm.caps).toEqual({ tab: true, argv: false, syncResult: false });
    expect(iterm.plan(req)).toEqual({
      file: OSASCRIPT,
      args: osascriptArgs('iterm', req.shellLine),
    });
  });

  it('terminal: osascript with the shell line as its only argument; windows only', () => {
    const { terminal } = ADAPTERS;
    expect(terminal.id).toBe('terminal');
    expect(terminal.bundle).toBe('Terminal.app');
    expect(terminal.caps).toEqual({ tab: false, argv: false, syncResult: false });
    expect(terminal.plan(req)).toEqual({
      file: OSASCRIPT,
      args: osascriptArgs('terminal', req.shellLine),
    });
  });

  it.each(['iterm', 'terminal'] as const)('%s: is pure (same request, same plan)', (app) => {
    expect(ADAPTERS[app].plan(req)).toEqual(ADAPTERS[app].plan({ ...req }));
  });
});

describe('createLauncher', () => {
  /** A child process that emits `event` on the next tick. */
  function fakeSpawn(event: 'spawn' | 'error', code = 0) {
    const child = Object.assign(new EventEmitter(), { stderr: null, unref: vi.fn() });
    const spawn = vi.fn(() => {
      setImmediate(() => {
        if (event === 'spawn') {
          child.emit('spawn');
          child.emit('close', code);
        } else child.emit('error', new Error('spawn ENOENT'));
      });
      return child;
    });
    return { spawn: spawn as unknown as LauncherOptions['spawn'], calls: spawn.mock.calls, child };
  }

  it('spawns osascript with an argv array (no shell) for the configured terminal', async () => {
    const { spawn, calls, child } = fakeSpawn('spawn');
    const appInstalled = vi.fn(async () => true);
    const launcher = createLauncher({
      terminal: async () => 'terminal',
      spawn,
      appInstalled,
      log: () => {},
    });
    await launcher.open(NASTY, resumeArgv(ID));
    expect(appInstalled).toHaveBeenCalledWith('Terminal.app');
    expect(calls).toEqual([
      [
        OSASCRIPT,
        osascriptArgs('terminal', shellLine(NASTY, resumeArgv(ID))),
        { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
      ],
    ]);
    expect(child.unref).toHaveBeenCalled();
  });

  it('rejects when osascript cannot be started', async () => {
    const { spawn } = fakeSpawn('error');
    const launcher = createLauncher({
      terminal: async () => 'iterm',
      spawn,
      appInstalled: async () => true,
      log: () => {},
    });
    await expect(launcher.open('/', resumeArgv(ID))).rejects.toThrow('spawn ENOENT');
  });

  it.each([
    ['iterm', 'iTerm.app'],
    ['terminal', 'Terminal.app'],
  ] as const)('%s: throws before spawning when %s is not installed', async (app, bundle) => {
    const { spawn, calls } = fakeSpawn('spawn');
    const launcher = createLauncher({
      terminal: async () => app,
      spawn,
      appInstalled: async () => false,
      log: () => {},
    });
    await expect(launcher.open('/', resumeArgv(ID))).rejects.toThrow(`${bundle} not found`);
    expect(calls).toEqual([]);
  });

  it('throws before spawning for a cwd with a control character', async () => {
    const { spawn, calls } = fakeSpawn('spawn');
    const appInstalled = vi.fn(async () => true);
    const launcher = createLauncher({ terminal: async () => 'iterm', spawn, appInstalled });
    await expect(launcher.open('/tmp/a\nrm -rf x', resumeArgv(ID))).rejects.toThrow('control');
    expect(calls).toEqual([]);
    expect(appInstalled).not.toHaveBeenCalled();
  });

  it('logs a non-zero osascript exit', async () => {
    const { spawn } = fakeSpawn('spawn', 1);
    const log = vi.fn();
    await createLauncher({
      terminal: async () => 'iterm',
      spawn,
      appInstalled: async () => true,
      log,
    }).open('/', ['true']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('osascript exited with 1'));
  });
});
