import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import type { RunFailure } from '../../shared/api';

const ROVO = 'mcp__claude_ai_Atlassian_Rovo__';

/** The only tools a run may use: read-only Rovo lookups, approved by the user for T12 (ADR 0039)
 * and T13, which adds atlassianUserInfo so the inbox knows whose mentions to find (ADR 0042). */
export const ALLOWED_TOOLS: readonly string[] = [
  `${ROVO}getAccessibleAtlassianResources`,
  `${ROVO}searchJiraIssuesUsingJql`,
  `${ROVO}getJiraIssue`,
  `${ROVO}atlassianUserInfo`,
];

/** Built-in tools, denied by name: `--tools` would hide the MCP tools too (ADR 0040). */
const DENIED_BUILT_INS = [
  'Agent',
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Read',
  'Skill',
  'Task',
  'WebFetch',
  'WebSearch',
  'Write',
];

/** Built-ins and the Rovo tools that write. `dontAsk` already denies them; this is a second guard. */
export const DENIED_TOOLS: readonly string[] = [
  ...DENIED_BUILT_INS,
  ...[
    'addCommentToJiraIssue',
    'addWorklogToJiraIssue',
    'createCompassComponent',
    'createCompassComponentRelationship',
    'createCompassCustomFieldDefinition',
    'createConfluenceFooterComment',
    'createConfluenceInlineComment',
    'createConfluencePage',
    'createIssueLink',
    'createJiraIssue',
    'editJiraIssue',
    'transitionJiraIssue',
    'updateConfluencePage',
  ].map((name) => ROVO + name),
];

/** Correct titles in every comparison run, at under half Opus's cost (ADR 0040). */
export const DEFAULT_MODEL: RunnerModel = { model: 'claude-sonnet-5-5', effort: 'low' };

export const RUN_TIMEOUT_MS = 120_000;

/** Claude Code's cap on one MCP tool result (default 25,000 tokens). Past it the result is saved
 * under ~/.claude/projects and the model pages through it, reading only part (ADR 0042). A week
 * of inbox comments measured 142k characters; this fits it in one call. */
export const MCP_OUTPUT_TOKENS = 60_000;

/** Larger than any answer a job asks for; past this the run is killed. */
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/** The `claude -p` arguments for one run (spike Q8). Built as an array, never a shell string. */
export function runnerArgv(prompt: string, model: RunnerModel = DEFAULT_MODEL): string[] {
  return [
    '-p',
    prompt,
    '--no-session-persistence',
    '--output-format',
    'json',
    // Anything not in --allowedTools is denied without a prompt.
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    ALLOWED_TOOLS.join(','),
    '--disallowedTools',
    DENIED_TOOLS.join(','),
    '--model',
    model.model,
    '--effort',
    model.effort,
  ];
}

/** The fields of `--output-format json` the runner reads (spike Q8); the rest pass through. */
const Outer = z.looseObject({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  duration_ms: z.number().optional(),
  duration_api_ms: z.number().optional(),
  num_turns: z.number().optional(),
  total_cost_usd: z.number().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
  permission_denials: z.array(z.unknown()).optional(),
});
type Outer = z.infer<typeof Outer>;

/** What every job's prompt asks Claude to answer when a Rovo tool says it is not logged in. */
const AuthRequired = z.object({ authRequired: z.literal(true) });

// Fallback for an error result that never reached the prompt's answer (unverified wording).
const AUTH_WORDS =
  /\b(unauthori[sz]ed|unauthenticated|not authenticated|authenticat\w* (required|failed|error)|re-?authenticate|log ?in (required|needed)|401)\b/i;

/** `detail`: what went wrong, without the prompt or answer (e.g. the first schema issue). */
export type RunResult<T> =
  { ok: true; data: T } | { ok: false; reason: RunFailure; detail?: string };

export interface RunRequest<T> {
  /** activity.log `job` name, e.g. "jira-titles". */
  job: string;
  prompt: string;
  /** Validates the answer: the JSON in the outer object's `result`. */
  schema: z.ZodType<T>;
}

export interface Runner {
  /** Runs `claude -p`; one run at a time, later calls wait their turn. Never throws. */
  run<T>(req: RunRequest<T>): Promise<RunResult<T>>;
}

/** Model and effort for every run. */
export interface RunnerModel {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface RunnerOptions {
  /** ~/.claude-dashboard/runner: the run's cwd, created if missing. */
  cwd: string;
  /** ~/.claude-dashboard/activity.log: one JSON object per run (ADR 0037). */
  logPath: string;
  /** Defaults to `claude`, found on PATH. */
  command?: string;
  timeoutMs?: number;
  /** Defaults to DEFAULT_MODEL. */
  model?: RunnerModel;
  /** Replaced in tests. */
  spawn?: typeof nodeSpawn;
  now?: () => Date;
  log?: (message: string) => void;
}

/** The answer is asked for as bare JSON; tolerate a ```json fence or a sentence around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in the result');
  return JSON.parse(body.slice(start, end + 1));
}

interface Exit {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

function collect(child: ChildProcess, timeoutMs: number): Promise<Exit> {
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let spawnError: string | undefined;
    const kill = () => child.kill('SIGKILL');
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const take = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) kill();
      else into.push(chunk);
    };
    child.stdout?.on('data', take(out));
    child.stderr?.on('data', take(err));
    child.on('error', (e) => (spawnError = e.message));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
        spawnError,
      });
    });
  });
}

/** Headless runner (spec § Data sources). Runs write no transcript and store no token: Claude Code
 * keeps the Rovo login itself. */
export function createRunner(opts: RunnerOptions): Runner {
  const spawn = opts.spawn ?? nodeSpawn;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[runner] ${m}`));
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;
  let tail: Promise<unknown> = Promise.resolve();

  async function once<T>(req: RunRequest<T>): Promise<RunResult<T>> {
    const started = now();
    const finish = async (result: RunResult<T>, error?: string, outer?: Outer) => {
      if (error) log(`${req.job}: ${error}`);
      if (error && !result.ok) result = { ...result, detail: error.slice(0, 300) };
      const usage = outer?.usage;
      const line = {
        at: started.toISOString(),
        job: req.job,
        ok: result.ok,
        ...(result.ok ? {} : { reason: result.reason }),
        durationMs: now().getTime() - started.getTime(),
        apiDurationMs: outer?.duration_api_ms,
        turns: outer?.num_turns,
        tokens: usage && {
          input: usage.input_tokens,
          output: usage.output_tokens,
          cacheRead: usage.cache_read_input_tokens,
          cacheCreation: usage.cache_creation_input_tokens,
        },
        costUsd: outer?.total_cost_usd,
        permissionDenials: outer?.permission_denials?.length,
      };
      await appendFile(opts.logPath, JSON.stringify(line) + '\n', { mode: 0o600 }).catch(
        (err: Error) => log(`cannot write ${opts.logPath}: ${err.message}`),
      );
      return result;
    };

    try {
      await mkdir(opts.cwd, { recursive: true });
    } catch (err) {
      return finish(
        { ok: false, reason: 'failed' },
        `cannot create ${opts.cwd}: ${(err as Error).message}`,
      );
    }
    const exit = await collect(
      spawn(opts.command ?? 'claude', runnerArgv(req.prompt, opts.model), {
        cwd: opts.cwd,
        // Ignored stdin: otherwise -p waits 3 s for input (spike Q8).
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MAX_MCP_OUTPUT_TOKENS: String(MCP_OUTPUT_TOKENS) },
      }),
      timeoutMs,
    );
    if (exit.timedOut) {
      return finish({ ok: false, reason: 'timeout' }, `killed after ${timeoutMs} ms`);
    }
    if (exit.spawnError) return finish({ ok: false, reason: 'failed' }, exit.spawnError);

    let raw: unknown;
    try {
      raw = JSON.parse(exit.stdout);
    } catch {
      const auth = AUTH_WORDS.test(exit.stderr);
      const detail = exit.stderr.trim().split('\n')[0] ?? '';
      return finish(
        { ok: false, reason: auth ? 'auth' : 'failed' },
        `exit ${exit.code}, no JSON on stdout${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    const parsedOuter = Outer.safeParse(raw);
    if (!parsedOuter.success) {
      return finish({ ok: false, reason: 'failed' }, 'stdout is not a result object');
    }
    const outer = parsedOuter.data;
    const text = outer.result ?? '';
    if (outer.is_error || outer.subtype !== 'success') {
      const reason = AUTH_WORDS.test(text) ? 'auth' : 'failed';
      return finish({ ok: false, reason }, `${outer.subtype}: ${text.slice(0, 200)}`, outer);
    }
    // A run that tried anything outside the allow-list is not trusted, whatever it answered.
    if (outer.permission_denials?.length) {
      return finish(
        { ok: false, reason: 'failed' },
        `${outer.permission_denials.length} tool call(s) denied`,
        outer,
      );
    }

    let answer: unknown;
    try {
      answer = extractJson(text);
    } catch (err) {
      return finish({ ok: false, reason: 'invalid' }, (err as Error).message, outer);
    }
    if (AuthRequired.safeParse(answer).success) {
      return finish({ ok: false, reason: 'auth' }, 'Rovo login needed', outer);
    }
    const parsed = req.schema.safeParse(answer);
    if (!parsed.success) {
      return finish(
        { ok: false, reason: 'invalid' },
        `answer does not match the schema (${parsed.error.issues[0]?.message})`,
        outer,
      );
    }
    return finish({ ok: true, data: parsed.data }, undefined, outer);
  }

  return {
    run(req) {
      const result = tail.then(() => once(req));
      tail = result.catch(() => {});
      return result;
    },
  };
}
