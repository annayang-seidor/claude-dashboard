import type { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ALLOWED_TOOLS, MCP_OUTPUT_TOKENS, createRunner, extractJson, runnerArgv } from './runner';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
});

interface Child {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  /** Writes stdout, then exits with `code`. */
  exit(stdout: string, code?: number, stderr?: string): void;
}

/** A fake `spawn`: each call returns a child the test drives by hand. */
function fakeSpawn() {
  const calls: { command: string; args: readonly string[]; options: object; child: Child }[] = [];
  const spawn = ((command: string, args: readonly string[], options: object) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        child.emit('close', null);
        return true;
      }),
      exit(stdout: string, code = 0, stderr = '') {
        child.stdout.end(stdout);
        child.stderr.end(stderr);
        // After the streams have flushed, as a real child's 'close' comes.
        setImmediate(() => child.emit('close', code));
      },
    });
    calls.push({ command, args, options, child });
    return child;
  }) as unknown as typeof nodeSpawn;
  return { spawn, calls };
}

/** What `claude -p --output-format json` prints (spike Q8). */
const outer = (result: string, extra: object = {}) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    duration_ms: 1400,
    duration_api_ms: 1139,
    num_turns: 3,
    total_cost_usd: 0.068,
    usage: { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 5000 },
    permission_denials: [],
    ...extra,
  });

const Answer = z.object({ n: z.number() });

function setup(opts: { timeoutMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-test-'));
  tmpDirs.push(dir);
  const fake = fakeSpawn();
  const logs: string[] = [];
  const logPath = join(dir, 'activity.log');
  const runner = createRunner({
    cwd: join(dir, 'runner'),
    logPath,
    spawn: fake.spawn,
    timeoutMs: opts.timeoutMs,
    log: (m) => logs.push(m),
  });
  const run = () => runner.run({ job: 'test-job', prompt: 'say {"n":1}', schema: Answer });
  /** Waits for the nth spawn (runs start after an async mkdir). */
  const child = async (n = 0) => {
    await vi.waitFor(() => expect(fake.calls.length).toBeGreaterThan(n));
    return fake.calls[n]!;
  };
  const logLines = () =>
    readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  return { dir, run, runner, child, calls: fake.calls, logs, logPath, logLines };
}

describe('runnerArgv', () => {
  it('runs print mode with no transcript, JSON output, Sonnet 5.5 at low effort and only the Rovo reads', () => {
    const argv = runnerArgv('hello');
    expect(argv.slice(0, 2)).toEqual(['-p', 'hello']);
    expect(argv).toContain('--no-session-persistence');
    expect(argv.join(' ')).toContain('--output-format json');
    // --tools would hide the MCP tools as well (ADR 0040).
    expect(argv).not.toContain('--tools');
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-sonnet-5-5');
    expect(argv[argv.indexOf('--effort') + 1]).toBe('low');
    const allowed = argv[argv.indexOf('--allowedTools') + 1]!.split(',');
    expect(allowed).toEqual(ALLOWED_TOOLS);
    expect(allowed.every((t) => /__(get\w+|search\w+|atlassianUserInfo)$/.test(t))).toBe(true);
    const denied = argv[argv.indexOf('--disallowedTools') + 1]!.split(',');
    expect(denied).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'WebFetch']));
    expect(denied).toContain('mcp__claude_ai_Atlassian_Rovo__editJiraIssue');
    expect(denied.some((t) => allowed.includes(t))).toBe(false);
  });

  it('takes another model and effort', () => {
    const argv = runnerArgv('hello', { model: 'claude-sonnet-5', effort: 'medium' });
    expect(argv.join(' ')).toContain('--model claude-sonnet-5 --effort medium');
  });
});

describe('extractJson', () => {
  it('reads bare JSON, a fenced block, or an object inside a sentence', () => {
    expect(extractJson('{"n":1}')).toEqual({ n: 1 });
    expect(extractJson('```json\n{"n":2}\n```')).toEqual({ n: 2 });
    expect(extractJson('Here you go: {"n":3}. Done.')).toEqual({ n: 3 });
    expect(() => extractJson('no object here')).toThrow();
  });
});

describe('runner', () => {
  it('spawns claude in the runner folder with stdin ignored and an argv array', async () => {
    const s = setup();
    const done = s.run();
    const { command, args, options, child } = await s.child();
    expect(command).toBe('claude');
    expect(args).toEqual(runnerArgv('say {"n":1}'));
    expect(options).toMatchObject({
      cwd: join(s.dir, 'runner'),
      stdio: ['ignore', 'pipe', 'pipe'],
      // A large search result stays inline instead of being saved under ~/.claude (ADR 0042).
      env: expect.objectContaining({ MAX_MCP_OUTPUT_TOKENS: String(MCP_OUTPUT_TOKENS) }),
    });
    expect(options).not.toHaveProperty('shell');
    expect(existsSync(join(s.dir, 'runner'))).toBe(true);
    child.exit(outer('{"n":1}'));
    expect(await done).toEqual({ ok: true, data: { n: 1 } });
  });

  it('logs duration and token use per run to an owner-only activity.log', async () => {
    const s = setup();
    const done = s.run();
    (await s.child()).child.exit(outer('{"n":1}'));
    await done;
    expect(s.logLines()).toEqual([
      expect.objectContaining({
        job: 'test-job',
        ok: true,
        durationMs: expect.any(Number),
        apiDurationMs: 1139,
        turns: 3,
        tokens: { input: 12, output: 34, cacheRead: 5000 },
        costUsd: 0.068,
        permissionDenials: 0,
      }),
    ]);
    expect(statSync(s.logPath).mode & 0o777).toBe(0o600);
    // The answer itself is not logged.
    expect(readFileSync(s.logPath, 'utf8')).not.toContain('"n":1');
  });

  it('runs one at a time: the second waits until the first exits', async () => {
    const s = setup();
    const first = s.run();
    const second = s.run();
    const a = await s.child(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.calls).toHaveLength(1);
    a.child.exit(outer('{"n":1}'));
    await first;
    (await s.child(1)).child.exit(outer('{"n":2}'));
    expect(await second).toEqual({ ok: true, data: { n: 2 } });
  });

  it('answers invalid when the result does not match the schema', async () => {
    const s = setup();
    const done = s.run();
    (await s.child()).child.exit(outer('{"n":"one"}'));
    expect(await done).toMatchObject({
      ok: false,
      reason: 'invalid',
      detail: expect.stringMatching(/^answer does not match the schema/),
    });
    expect(s.logLines()[0]).toMatchObject({ ok: false, reason: 'invalid' });
    expect(s.logLines()[0]).not.toHaveProperty('detail');
  });

  it('answers failed when the run tried a tool outside the allow-list, whatever it answered', async () => {
    const s = setup();
    const done = s.run();
    (await s.child()).child.exit(
      outer('{"n":1}', { permission_denials: [{ tool_name: 'Bash', tool_use_id: 't1' }] }),
    );
    expect(await done).toMatchObject({ ok: false, reason: 'failed' });
    expect(s.logLines()[0]).toMatchObject({ ok: false, reason: 'failed', permissionDenials: 1 });
  });

  it('answers invalid when the result holds no JSON', async () => {
    const s = setup();
    const done = s.run();
    (await s.child()).child.exit(outer('I could not find those issues.'));
    expect(await done).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('answers auth when the prompt reports a needed login', async () => {
    const s = setup();
    const done = s.run();
    (await s.child()).child.exit(outer('{"authRequired":true}'));
    expect(await done).toMatchObject({ ok: false, reason: 'auth' });
  });

  it('answers auth for an error result that mentions authentication', async () => {
    const s = setup();
    const done = s.run();
    (await s.child()).child.exit(
      outer('MCP server returned 401 Unauthorized', {
        is_error: true,
        subtype: 'error_during_execution',
      }),
    );
    expect(await done).toMatchObject({ ok: false, reason: 'auth' });
  });

  it('answers failed for any other error result or a non-zero exit without JSON', async () => {
    const s = setup();
    const a = s.run();
    (await s.child(0)).child.exit(outer('boom', { is_error: true, subtype: 'error_max_turns' }));
    expect(await a).toMatchObject({ ok: false, reason: 'failed' });
    const b = s.run();
    (await s.child(1)).child.exit('', 1, 'Error: something broke\n');
    expect(await b).toMatchObject({ ok: false, reason: 'failed' });
    expect(s.logs.at(-1)).toContain('something broke');
  });

  it('kills a run that takes longer than the timeout', async () => {
    const s = setup({ timeoutMs: 50 });
    const done = s.run();
    const { child } = await s.child();
    expect(await done).toMatchObject({ ok: false, reason: 'timeout' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(s.logLines()[0]).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('answers failed when claude cannot be spawned', async () => {
    const s = setup();
    const done = s.run();
    const { child } = await s.child();
    (child as unknown as EventEmitter).emit('error', new Error('spawn claude ENOENT'));
    child.exit('', -2);
    expect(await done).toMatchObject({ ok: false, reason: 'failed' });
  });
});
