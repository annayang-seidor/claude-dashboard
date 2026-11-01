import { z } from 'zod';

/** hac project and env names: the toml file stem and its `[envs.<name>]` table keys. */
export const HacName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);

/**
 * One environment from hac's config: the table name and its gate flags, nothing else. Url,
 * username and password are dropped at parse time and must never be added here (ADR 0035).
 */
export const HacEnv = z.object({
  project: HacName,
  name: HacName,
  readOnly: z.boolean(),
  allowSqlCommit: z.boolean(),
  allowGroovyCommit: z.boolean(),
  allowImpexImport: z.boolean(),
});
export type HacEnv = z.infer<typeof HacEnv>;

/** An env a session's hac calls used. `project` is null when neither `-p` nor the reply named it. */
export const DetectedEnv = z.object({ project: HacName.nullable(), name: HacName });
export type DetectedEnv = z.infer<typeof DetectedEnv>;

/** State `envOverride` and the PATCH body: `project/name`, or `name` alone. */
export const EnvRef = z.string().regex(/^(?:[A-Za-z0-9][\w.-]{0,63}\/)?[A-Za-z0-9][\w.-]{0,63}$/);
export type EnvRef = z.infer<typeof EnvRef>;

export function parseEnvRef(ref: EnvRef): DetectedEnv {
  const [a, b] = ref.split('/');
  return b === undefined ? { project: null, name: a! } : { project: a!, name: b };
}

const PROD_NAME = /^(p\d+|prod)/i;

/** Production: read-only in hac (`read_only = true` in its toml), or named P + digits or Prod…
 * (ADR 0035). hac's toml is the one source; the dashboard config has no list of its own. */
export function isProd(env: Pick<HacEnv, 'name' | 'readOnly'>): boolean {
  return env.readOnly || PROD_NAME.test(env.name);
}

/** The developer's own machine: hac's `local` env, not a cloud one. */
export function isLocal(env: Pick<HacEnv, 'name'>): boolean {
  return env.name.toLowerCase() === 'local';
}

/** Tag text: `p1` → `P1`. */
export function envDisplayName(name: string): string {
  return name.toUpperCase();
}
