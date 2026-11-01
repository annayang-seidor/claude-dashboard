import type { TerminalApp } from '../../shared/config';

export const OSASCRIPT = '/usr/bin/osascript';

/** The process to spawn, as an argv array (never a shell string). */
export interface SpawnPlan {
  file: string;
  args: string[];
}

/** What every adapter gets: the cwd and argv, plus the `cd <cwd> && <argv>` line built from them. */
export interface PlanRequest {
  cwd: string;
  argv: readonly string[];
  shellLine: string;
}

/** One terminal app (ADR 0059). `plan` is pure, so each adapter is unit-tested without spawning. */
export interface TerminalAdapter {
  id: TerminalApp;
  /** The app bundle, checked before spawning so osascript never shows a "Where is…" chooser. */
  bundle: string;
  caps: {
    /** Can open a tab in the front window without Accessibility or typing into an existing tab. */
    tab: boolean;
    /** Takes argv directly (no shell); the launcher wraps the line in `$SHELL -lic`. */
    argv: boolean;
    /** Exit code means success, so a failure can become a 500 (osascript fails after the reply). */
    syncResult: boolean;
  };
  plan(req: PlanRequest): SpawnPlan;
}
