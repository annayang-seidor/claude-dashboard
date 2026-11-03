import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/** ~/.claude-dashboard/jira-oauth.json, mode 600 (ADR 0062). */
export const StoredTokens = z.object({
  accessToken: z.string().min(1),
  /** Atlassian rotates it: every refresh returns a new one and the old one stops working. */
  refreshToken: z.string().min(1),
  /** Epoch ms when the access token lapses. */
  expiresAt: z.number().int(),
  scope: z.string(),
  /** The site's id in api.atlassian.com/ex/jira/<cloudId>/… */
  cloudId: z.string().min(1).max(100),
  site: z.string().min(1).max(300),
});
export type StoredTokens = z.infer<typeof StoredTokens>;

/** The stored login, or null when there is none or the file is not one. Tightens a file other
 * users could read to 600, with a log line. */
export async function readTokens(
  path: string,
  log: (message: string) => void,
): Promise<StoredTokens | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`cannot read ${path}: ${(err as Error).message}`);
    }
    return null;
  }
  let parsed;
  try {
    parsed = StoredTokens.safeParse(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) {
    log(`${path} is not a stored login; ignoring it`);
    return null;
  }
  if (((await stat(path)).mode & 0o077) !== 0) {
    await chmod(path, 0o600);
    log(`${path} was readable by others; set to 600`);
  }
  return parsed.data;
}

/** Written to a temporary file and renamed, so a crash mid-write never loses the only refresh
 * token. */
export async function writeTokens(path: string, tokens: StoredTokens): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(tokens) + '\n', { mode: 0o600 });
  // writeFile's mode only applies when it creates the file.
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function removeTokens(path: string): Promise<void> {
  await rm(path, { force: true });
}
