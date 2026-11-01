# 0059: Terminals plug in as adapters behind `Launcher`; a tab when the terminal can, else one new window, never keystrokes

- Status: Accepted
- Date: 2026-11-01
- Task: terminal spike (docs/spike-terminal.md)

## Context
- Resume and New session open iTerm2 or Terminal.app through `/usr/bin/osascript` (spike Q9, `src/server/launch/index.ts`). The user wants other terminals to be possible without breaking either action.
- Routes already depend only on `Launcher.open(cwd, argv)`; `createLauncher` assumes every terminal is driven by osascript with a shell line.
- WezTerm, kitty and Ghostty are driven by a CLI that takes argv, not by AppleScript (unverified: none is installed here). Warp and VS Code cannot run a command in a new tab or window at all (spike-terminal § 2).
- Terminal.app has no tab route except a Cmd-T keystroke (needs Accessibility, error 1002 here) or `do script … in front window`, which types into the existing tab (tested).
- New session needs a pre-assigned `--session-id` (ADR 0025).

## Options
1. **Adapter per terminal behind `Launcher`**: each adapter declares `caps { tab, argv, syncResult }` and a pure `plan()` returning the spawn argv; `createLauncher` spawns and applies one fallback rule. Routes and `start.ts` unchanged; CLI terminals fit; each adapter unit-tested like `osascriptArgs`.
2. **More entries in the `SCRIPTS` map**: smallest change, but only works for terminals with AppleScript, so WezTerm, kitty and Ghostty stay out.
3. **iTerm2 and Terminal.app only**: no work; the user's question stays unanswered.

## Decision
Option 1, chosen by the user on 2026-11-01 after the spike.
- `Launcher.open(cwd, argv)` stays the route-facing port. Adapters live in `src/server/launch/`, one file each.
- Fallback rule: open a tab in the front window when `caps.tab` is true and the app has a window; otherwise open one new window, and use only that window (no extra default window on a cold start). Never send keystrokes, never type into an existing tab.
- Adapters with `caps.argv` run `[$SHELL, '-lic', shellLine + '; exec ' + $SHELL + ' -l']`, so aliases and `.zshrc` PATH still apply and a shell stays after `claude` exits; `shellLine` quoting is unchanged.
- An unknown or uninstalled terminal makes `open()` throw before spawning (the existing 500), so osascript never shows the "Where is X?" chooser.
- Warp and VS Code are not offered: neither can run a command in a new tab or window, and the VS Code extension URI cannot take a session id (ADR 0025).
- `terminal` stays a per-machine key, set in the home config file (ADR 0058).

## Consequences
- Adding a terminal is one adapter file, one enum value in `src/shared/config.ts` and its tests.
- `src/server/config.test.ts` uses `"warp"` as the invalid terminal; that stays valid as long as Warp is not offered.
- Terminal.app keeps opening windows, not tabs.
- CLI adapters can report a failure as a 500 (`syncResult`); osascript failures are still only logged after the reply.
- kitty tabs need the user's `allow_remote_control` + `listen_on`; without them kitty gets a window.
