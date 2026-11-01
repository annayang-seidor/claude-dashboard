import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { CLAUDE_CLEANUP_DEFAULT_DAYS } from '../shared/config';

/** Claude Code's user settings. Read only: the dashboard never writes inside ~/.claude. */
export const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

const Settings = z.looseObject({
  cleanupPeriodDays: z.number().int().nonnegative().optional(),
});

/**
 * Days after which Claude Code deletes an idle transcript (spike Q6), or null when `0` turns its
 * cleanup off. Never throws: a missing, unreadable or invalid file gives the default 30.
 */
export async function readCleanupPeriodDays(
  path = CLAUDE_SETTINGS_PATH,
  log: (message: string) => void = (m) => console.warn(`[retention] ${m}`),
): Promise<number | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`cannot read ${path} (${(err as Error).message}); assuming the default`);
    }
    return CLAUDE_CLEANUP_DEFAULT_DAYS;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    log(`${path} is not valid JSON; assuming the default`);
    return CLAUDE_CLEANUP_DEFAULT_DAYS;
  }
  const parsed = Settings.safeParse(raw);
  if (!parsed.success) {
    log(`cleanupPeriodDays in ${path} is not a whole number ≥ 0; assuming the default`);
    return CLAUDE_CLEANUP_DEFAULT_DAYS;
  }
  const days = parsed.data.cleanupPeriodDays ?? CLAUDE_CLEANUP_DEFAULT_DAYS;
  return days === 0 ? null : days;
}
