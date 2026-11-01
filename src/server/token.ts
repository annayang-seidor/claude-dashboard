import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 32 random bytes as base64url: exactly 43 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const newToken = () => randomBytes(32).toString('base64url');

/** Where a rotation keeps the token it replaced, so tabs holding it can trade it in (ADR 0048). */
export const previousTokenPath = (path: string) => `${path}.previous`;

async function writeSecret(path: string, token: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, token + '\n', { mode: 0o600 });
  // writeFile's mode only applies when it creates the file.
  await chmod(path, 0o600);
}

async function readValid(path: string): Promise<string | null> {
  try {
    const token = (await readFile(path, 'utf8')).trim();
    return TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * The access token, kept in a mode-600 file so a restart (launchd, crash) keeps open tabs working
 * (ADR 0032). Makes a new one when there is none, the file is not a valid token, or `rotate` is
 * set; a rotation keeps the replaced token in `<path>.previous` (ADR 0048). A file other users
 * could read is tightened to 600, with a log line.
 */
export async function loadToken(
  path: string,
  opts: {
    rotate?: boolean;
    /** With `rotate`: drop the replaced token instead of keeping it, e.g. after a leak. */
    revoke?: boolean;
    log?: (message: string) => void;
  } = {},
): Promise<string> {
  const log = opts.log ?? ((m: string) => console.warn(`[token] ${m}`));
  if (!opts.rotate) {
    let text: string | null = null;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log(`cannot read ${path} (${(err as Error).message}); making a new token`);
      }
    }
    const token = text?.trim();
    if (token && TOKEN_RE.test(token)) {
      if (((await stat(path)).mode & 0o077) !== 0) {
        await chmod(path, 0o600);
        log(`${path} was readable by others; set to 600`);
      }
      return token;
    }
    if (text !== null) log(`${path} does not hold a valid token; making a new one`);
  }
  if (opts.rotate && opts.revoke) {
    await rm(previousTokenPath(path), { force: true });
  } else if (opts.rotate) {
    const replaced = await readValid(path);
    if (replaced) await writeSecret(previousTokenPath(path), replaced);
  }
  const token = newToken();
  await writeSecret(path, token);
  if (opts.rotate) log('made a new token; open the new link from the url file');
  return token;
}

/** The token the last rotation replaced, or null when there was none (ADR 0048). */
export function loadPreviousToken(path: string): Promise<string | null> {
  return readValid(previousTokenPath(path));
}
