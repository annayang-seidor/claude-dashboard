import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { DashboardConfig, DashboardConfigFile, type WorkspaceConfig } from '../shared/config';
import type { Workspace, WorkspaceKind } from '../shared/session';

export const CONFIG_PATH = join(homedir(), '.claude-dashboard', 'config.json');

/** The repo's committed dashboard.config.json: shared, non-secret settings (ADR 0058). */
export const PROJECT_CONFIG_PATH = fileURLToPath(
  new URL('../../dashboard.config.json', import.meta.url),
);

/** An unusable config file. The message names the file, the key and what was expected, and the
 * server does not start (ADR 0060). */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads the config files once, at startup (ADR 0060). Files are read in order and merged key by
 * key, a later file winning; nested objects merge, arrays are replaced. A missing file is
 * skipped; an unreadable, malformed or invalid one throws ConfigError.
 */
export async function loadConfig(
  paths: readonly string[] = [CONFIG_PATH],
): Promise<DashboardConfig> {
  const files: { path: string; raw: Record<string, unknown> }[] = [];
  for (const path of paths) {
    const raw = await readConfigFile(path);
    if (raw) files.push({ path, raw });
  }
  const merged = files.reduce<Record<string, unknown>>((acc, f) => deepMerge(acc, f.raw), {});
  const parsed = DashboardConfig.safeParse(merged);
  if (parsed.success) return parsed.data;
  // Each file was valid alone, so this is a check across keys: blame the last file that set the
  // key, else the one that set the nearest object around it (cleanup.ranges for defaultRange).
  const issue = parsed.error.issues[0]!;
  const keys = issue.path.filter((p) => typeof p === 'string');
  let source: string | undefined;
  for (let n = keys.length; n > 0 && !source; n--) {
    source = files.findLast((f) => has(f.raw, keys.slice(0, n)))?.path;
  }
  throw new ConfigError(describe(source ?? 'the defaults', issue));
}

async function readConfigFile(path: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ConfigError(`Cannot read config ${path}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    // The commented example is .jsonc; the real files are strict JSON.
    const hint = /^\s*\/[/*]/m.test(text)
      ? ' (comments are only for dashboard.config.example.jsonc; remove them here)'
      : '';
    throw new ConfigError(`Config ${path} is not valid JSON${hint}: ${(err as Error).message}`);
  }
  if (!isObject(raw)) throw new ConfigError(`Config ${path} must be a JSON object`);
  const parsed = DashboardConfigFile.safeParse(raw);
  if (!parsed.success) throw new ConfigError(describe(path, parsed.error.issues[0]!));
  return raw;
}

/** `Invalid config in <file>: cleanup.ranges[1]: expected …, got 400`. */
function describe(file: string, issue: z.core.$ZodIssue): string {
  const key = keyPath(issue.path);
  if (issue.code === 'unrecognized_keys') {
    const names = issue.keys.map((k) => (key ? `${key}.${k}` : k)).join(', ');
    return `Invalid config in ${file}: unknown key ${names}`;
  }
  return `Invalid config in ${file}: ${key || '(top level)'}: ${issue.message}`;
}

function keyPath(path: readonly PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i ? `.${String(p)}` : String(p)))
    .join('');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = isObject(out[k]) && isObject(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function has(raw: unknown, path: readonly PropertyKey[]): boolean {
  // Arrays are replaced whole, so a file that sets the array owns every index in it.
  const keys = path.filter((p) => typeof p === 'string');
  let at = raw;
  for (const k of keys) {
    if (!isObject(at) || !(k in at)) return false;
    at = at[k];
  }
  return keys.length > 0;
}

/** A workspace with its root made absolute. */
export interface ResolvedWorkspace {
  id: Workspace;
  kind: WorkspaceKind;
  root: string;
  fallback: boolean;
}

export function resolveWorkspaces(
  workspaces: readonly WorkspaceConfig[],
  home: string,
): ResolvedWorkspace[] {
  return workspaces.map(({ id, kind, root, fallback }) => ({
    id,
    kind,
    root: expandHome(root, home),
    fallback,
  }));
}

/** `~` and `~/x` against `home`; anything else is already absolute. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  return path.startsWith('~/') ? join(home, path.slice(2)) : path;
}

/** Warnings for day counts at or over Claude Code's cleanupPeriodDays: Claude Code removes those
 * sessions itself, so the range or rule never matches anything (ADR 0038). None when its cleanup
 * is off (null). */
export function cleanupWarnings(
  config: DashboardConfig,
  cleanupPeriodDays: number | null,
): string[] {
  if (cleanupPeriodDays === null) return [];
  const { cleanup, workspaces } = config;
  const checks: [string, number][] = [
    // customStartDays is left out: the page already moves the custom date up to the limit.
    ...cleanup.ranges.map((d, i): [string, number] => [`cleanup.ranges[${i}]`, d]),
    ...workspaces.map((w, i): [string, number] => [
      `workspaces[${i}].autoArchiveDays`,
      w.autoArchiveDays,
    ]),
  ];
  return checks
    .filter(([, d]) => d >= cleanupPeriodDays)
    .map(
      ([key, d]) =>
        `${key} is ${d} days, at or over Claude Code's cleanupPeriodDays (${cleanupPeriodDays}): ` +
        'Claude Code deletes those sessions first, so it matches nothing',
    );
}
