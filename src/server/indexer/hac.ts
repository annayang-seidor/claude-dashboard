import { HacName, type DetectedEnv } from '../../shared/env';

/** hac commands that act on an env. `projects`, `session`, `logout` and `skill` only look around. */
const OPERATIONS = new Set([
  'flexible-search',
  'sql',
  'groovy',
  'impex-validate',
  'impex-export',
  'impex-import',
  'ping',
]);

/** `hac <command> <args…>` up to the end of that shell command. */
const INVOCATION = /(?:^|[\s;&|(`])hac\s+([a-z][a-z-]*)([^\n;&|]*)/g;
const flag = (names: string) =>
  new RegExp(`(?:^|\\s)(?:${names})(?:\\s+|=)(["']?)([A-Za-z0-9][\\w.-]*)\\1(?=\\s|$)`);
const ENV_FLAG = flag('-e|--env');
const PROJECT_FLAG = flag('-p|--project');

const named = (v: string | undefined): string | null =>
  v !== undefined && HacName.safeParse(v).success ? v : null;

/**
 * The envs a Bash command names literally. `complete` is false when some hac operation names no
 * env (inferred by hac, or passed as `-e "$e"`): then only the tool result can tell.
 */
export function envsFromCommand(command: string): { envs: DetectedEnv[]; complete: boolean } {
  const envs: DetectedEnv[] = [];
  let complete = true;
  for (const [, cmd, args = ''] of command.matchAll(INVOCATION)) {
    if (!OPERATIONS.has(cmd!)) continue;
    const name = named(args.match(ENV_FLAG)?.[2]);
    if (name) envs.push({ project: named(args.match(PROJECT_FLAG)?.[2]), name });
    else complete = false;
  }
  return { envs, complete };
}

const ENVELOPE = /"tool"\s*:\s*"hac\/[^"]*"/g;
/** The envelope's header (tool, command, project, env) comes before params and result. */
const HEADER_MAX = 400;

/** The envs named by hac's JSON envelopes in a tool result's text. */
export function envsFromResult(text: string): DetectedEnv[] {
  const envs: DetectedEnv[] = [];
  for (const m of text.matchAll(ENVELOPE)) {
    let header = text.slice(m.index, m.index + HEADER_MAX);
    const end = header.search(/"(?:params|result|error)"\s*:/);
    if (end !== -1) header = header.slice(0, end);
    const cmd = header.match(/"command"\s*:\s*"([a-z-]+)"/)?.[1];
    const name = named(header.match(/"env"\s*:\s*"([^"]*)"/)?.[1]);
    if (!cmd || !OPERATIONS.has(cmd) || !name) continue;
    envs.push({ project: named(header.match(/"project"\s*:\s*"([^"]*)"/)?.[1]), name });
  }
  return envs;
}

/** Running tally of one transcript's hac calls; kept between scans so growth reads only new bytes. */
export interface HacTally {
  /** `project/name` (project may be empty) → uses and the order of the latest use. */
  uses: Map<string, { env: DetectedEnv; count: number; last: number }>;
  /** Bash tool_use ids whose env must come from their tool result. */
  pending: Set<string>;
  seq: number;
}

export const newTally = (): HacTally => ({ uses: new Map(), pending: new Set(), seq: 0 });

function count(tally: HacTally, env: DetectedEnv): void {
  const key = `${env.project ?? ''}/${env.name}`;
  const hit = tally.uses.get(key);
  tally.seq++;
  if (hit) {
    hit.count++;
    hit.last = tally.seq;
  } else {
    tally.uses.set(key, { env, count: 1, last: tally.seq });
  }
}

type Block = {
  type?: unknown;
  name?: unknown;
  id?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
};

const resultText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((b: { text?: unknown }) => (typeof b?.text === 'string' ? b.text : ''))
          .join('\n')
      : '';

/** Counts the hac calls in one transcript line. */
export function tallyLine(tally: HacTally, line: Record<string, unknown>): void {
  const content = (line.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return;
  for (const b of content as Block[]) {
    if (b?.type === 'tool_use' && b.name === 'Bash') {
      const command = (b.input as { command?: unknown } | undefined)?.command;
      if (typeof command !== 'string') continue;
      const { envs, complete } = envsFromCommand(command);
      if (complete) envs.forEach((e) => count(tally, e));
      else if (typeof b.id === 'string') tally.pending.add(b.id);
    } else if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      if (!tally.pending.delete(b.tool_use_id)) continue;
      envsFromResult(resultText(b.content)).forEach((e) => count(tally, e));
    }
  }
}

/**
 * The most used env, ties to the latest. A use without a project counts toward the same env name
 * with a project when there is exactly one.
 */
export function topEnv(tally: HacTally): DetectedEnv | null {
  const merged = new Map<string, { env: DetectedEnv; count: number; last: number }>();
  const all = [...tally.uses.values()];
  for (const use of all) {
    let env = use.env;
    if (env.project === null) {
      const owners = new Set(
        all.filter((u) => u.env.project && u.env.name === env.name).map((u) => u.env.project),
      );
      if (owners.size === 1) env = { project: [...owners][0]!, name: env.name };
    }
    const key = `${env.project ?? ''}/${env.name}`;
    const hit = merged.get(key);
    if (hit) {
      hit.count += use.count;
      hit.last = Math.max(hit.last, use.last);
    } else {
      merged.set(key, { env, count: use.count, last: use.last });
    }
  }
  let best: { env: DetectedEnv; count: number; last: number } | null = null;
  for (const m of merged.values()) {
    if (!best || m.count > best.count || (m.count === best.count && m.last > best.last)) best = m;
  }
  return best?.env ?? null;
}
