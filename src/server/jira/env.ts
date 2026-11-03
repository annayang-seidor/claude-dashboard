import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { ConfigError } from '../config';

/** The repo's `.env`, ignored by git; `.env.example` lists its keys (ADR 0062). */
export const ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

/** The Atlassian OAuth 2.0 (3LO) app the Jira sync logs in with (ADR 0062). */
export const AtlassianApp = z.object({
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
});
export type AtlassianApp = z.infer<typeof AtlassianApp>;

const DotEnv = z.object({
  ATLASSIAN_CLIENT_ID: z.string().trim().max(200).default(''),
  ATLASSIAN_CLIENT_SECRET: z.string().trim().max(500).default(''),
});

/**
 * Reads the Atlassian app from `.env` without loading it into process.env, so the `claude -p`
 * runs, which inherit process.env, never see the secret. Null when the file is missing or both
 * values are blank; throws ConfigError when only one is set, so the start stops (ADR 0060).
 */
export async function readAtlassianApp(path: string): Promise<AtlassianApp | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ConfigError(`${path}: cannot read (${(err as Error).message})`);
  }
  const env = DotEnv.safeParse(parseEnv(text));
  if (!env.success) {
    throw new ConfigError(`${path}: ${env.error.issues[0]?.path.join('.')} is too long`);
  }
  const { ATLASSIAN_CLIENT_ID: clientId, ATLASSIAN_CLIENT_SECRET: clientSecret } = env.data;
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    const missing = clientId ? 'ATLASSIAN_CLIENT_SECRET' : 'ATLASSIAN_CLIENT_ID';
    throw new ConfigError(`${path}: ${missing} is empty; set both Atlassian keys or neither`);
  }
  return { clientId, clientSecret };
}
