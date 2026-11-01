# Spike: terminals other than iTerm2

Read-only spike, 2026-11-01. Question: can Resume and New session open terminals other than iTerm2 without breaking either? No code was changed.

**Short answer:** yes. The launcher already sits behind a port (`Launcher`), and routes only call `launcher.open(cwd, argv)`. Terminal.app already works. WezTerm and kitty fit cleanly through their CLIs (untested here). Ghostty and Warp fit only partly. VS Code cannot run a command in its integrated terminal at all; the Claude Code extension's URI handler covers Resume only, and only sometimes.

Machine: macOS (Darwin 25.2.0), node from the repo, iTerm2 3.7.3, Terminal.app 2.15, VS Code 1.144.0 with the Claude Code extension 2.1.314. **Not installed, so untested:** Ghostty, Warp, WezTerm, kitty. Everything about those four comes from their documentation and is marked *untested*.

## 1. Current launcher code

| What | Where |
|---|---|
| Terminal choice (`'iterm' \| 'terminal'`, default `iterm`) | `src/shared/config.ts:40` (`TerminalApp`), `:53`, `:62` |
| Choice read on each launch | `src/server/start.ts:111-113` (`createLauncher({ terminal: () => readConfig(...).terminal })`) |
| AppleScript for both apps | `src/server/launch/index.ts:9-46` (`SCRIPTS`) |
| **Tab-or-window decision** | Inside the iTerm AppleScript, `src/server/launch/index.ts:17-35`: if running, new tab in the current window (a new window if it has none); if not running, wait up to 5 s and use the first window. Terminal.app has no decision: `do script` always opens a new window. |
| **Command string** | `shellWord` / `shellLine` at `src/server/launch/index.ts:52-59`: `cd <cwd> && <argv…>`, each word single-quoted unless it is plain. `resumeArgv` / `newSessionArgv` at `:61-79`. |
| Spawn | `createLauncher`, `src/server/launch/index.ts:98-121`: `/usr/bin/osascript -e <script> <shellLine>` as an argv array, detached; the line arrives as `item 1 of argv`, so it is never spliced into AppleScript source. |
| Port | `interface Launcher { open(cwd, argv) }`, `src/server/launch/index.ts:86-89` |
| Callers | `src/server/routes.ts:132` (Resume) and `:157` (New session). Both only call `deps.launcher.open(...)` and map a throw to 500. |

So the code is **already behind a port**. Nothing about terminals leaks into the route handlers, the web page or i18n (`launchFailed` says "Couldn't open the terminal", which is generic). What is still mixed together: `createLauncher` assumes every terminal is driven by osascript with a shell line.

### Files that would change

| File | Change |
|---|---|
| `src/server/launch/index.ts` | Keep `Launcher`, `shellWord`, `shellLine` and the argv builders. Move the per-terminal code into adapters. |
| `src/server/launch/iterm.ts`, `terminal-app.ts`, `wezterm.ts`, `kitty.ts` (new) | One adapter each: capabilities, plus a pure `plan()` that returns the spawn argv. |
| `src/server/launch/launch.test.ts` | Tests per adapter's `plan()`, plus the fallback rule. |
| `src/shared/config.ts` | Widen the `TerminalApp` enum. |
| `src/server/config.test.ts` | Lines 45 and 71 use `"warp"` as *the invalid terminal*; pick another value. |
| `docs/api.md` (line 37), `docs/spec.md` (lines 128, 133, 284) | They say "Opens iTerm2" and describe only two terminals. |
| `docs/decisions/0059-terminal-adapters-tab-then-window.md` | Adapter design + fallback rule (written with this spike). |
| *Optional:* `src/shared/api.ts`, `src/server/routes.ts`, `src/server/api.test.ts` | Only if the reply should say whether a tab or a window opened. Not needed. |

`src/server/start.ts` stays as it is if `createLauncher`'s options keep their shape. No web or i18n change is needed, because the page never sees the terminal (ADR 0044).

## 2. Per terminal

### Tested on this machine

I called the repo's real `createLauncher` through tsx, using a scratch script that imports `src/server/launch/index.ts`. The cwd was hostile: `…/dir with 'q' $(touch PWNED) ; x`. The argv was `sh -c 'pwd > "$1"; printf "%s\n" "$2" >> "$1"' sh <out> '$(touch PWNED2); \`id\` ; echo hi'`.

The shell line it produced:
```
cd '…/term/dir with '\''q'\'' $(touch PWNED) ; x' && sh -c 'pwd > "$1"; printf "%s\n" "$2" >> "$1"' sh …/out-terminal-cold.txt '$(touch PWNED2); `id` ; echo hi'
```

| Case | Windows / tabs after | Output file |
|---|---|---|
| Terminal.app, **not running** | `2` windows (`2, 2` = windows, tabs) | correct cwd + literal argument |
| Terminal.app, running | `3` windows: one more **window**, no tab | correct |
| iTerm2, running (1 window, 1 tab) | `1` window, `2` tabs: **new tab in the current window** | correct |

`find … -name 'PWNED*'` found **0** files, so neither `$(…)`, backticks nor `;` ran, in either the cwd or the arguments.

**iTerm2.** Working, as built in T7: new tab in the current window, a new window if it has none, launched and its first window used if it was not running. I did not retest the not-running path, because that would have meant quitting the user's iTerm2.

**Terminal.app.** Works, but only as a window. Evidence that a tab is not reachable without Accessibility:
```
$ osascript -e 'tell application "Terminal" to make new tab at end of tabs of front window'
execution error: Terminal got an error: AppleEvent handler failed. (-10000)

$ osascript -e 'tell application "Terminal" to activate' \
            -e 'tell application "System Events" to keystroke "t" using command down'
execution error: System Events got an error: osascript is not allowed to send keystrokes. (1002)

# do script … in front window: tab count 1 → 1, the line is typed into the EXISTING tab
$ osascript -e 'on run argv' -e 'tell application "Terminal"' -e 'set n0 to count of tabs of front window' \
  -e 'do script (item 1 of argv) in front window' -e 'delay 1' \
  -e 'return {n0, count of tabs of front window, count of windows}' -e 'end tell' -e 'end run' "echo same-tab > …"
1, 1, 3
```
So the only tab route is a Cmd-T keystroke, which needs an Accessibility grant and races with focus. `do script … in front window` would type into whatever is running in that tab. Neither is acceptable. **Bug found:** a cold start leaves an extra empty window, because Terminal opens its default window and `do script` adds a second. The fix is the iTerm pattern: if Terminal was not running, wait for its first window and `do script line in window 1`.

**VS Code** (installed, read but not run). `code --help` has `-n/--new-window` and `-r/--reuse-window`, but no flag to run a command in the integrated terminal. A task with `runOn: folderOpen` would mean writing `.vscode/tasks.json` into the user's repo. The Claude Code extension registers a URI handler (from `extension.js` of 2.1.314):
```js
case"/open":{let T=w.get("session")??void 0,C=w.get("prompt")??void 0;if(T!==void 0&&!Ww(T))return;
  Oe.commands.executeCommand("claude-vscode.primaryEditor.open",T,C);return}
```
So `open 'vscode://anthropic.claude-code/open?session=<uuid>'` opens a **Claude panel**, not a terminal, in the front VS Code window. It takes **no cwd**: the session is resumed in whatever folder that window has open. It also takes no pre-assigned id for a new session. I did not run it, because it would have opened a panel in the editor this spike runs in. Result: VS Code works at most for Resume, and only when the front window is the session's repo.

### Not installed: untested, from the documentation

| Terminal | New tab in front window | New window | cwd + command | Quoting | Not running |
|---|---|---|---|---|---|
| **WezTerm** | `wezterm cli spawn --cwd <cwd> -- <argv…>`: tab in the current window | `wezterm cli spawn --new-window --cwd <cwd> -- <argv…>` | flags + argv | argv, no shell, no quoting | `cli` fails (no mux socket); fall back to `wezterm start --cwd <cwd> -- <argv…>` (a new window) |
| **kitty** | `kitten @ launch --type=tab --cwd=<cwd> <argv…>`; needs `allow_remote_control` + `listen_on` in the user's kitty.conf | `kitty --single-instance --directory <cwd> <argv…>` | flags + argv | argv, no shell | remote control fails; `--single-instance` starts it |
| **Ghostty** | no supported route on macOS (check newer versions for AppleScript) | `open -na Ghostty.app --args --working-directory=<cwd> -e <argv…>` | flags + argv after `-e` | argv | `open` launches it; `-na` may start a second instance |
| **Warp** | `open 'warp://action/new_tab?path=<cwd>'` opens a tab but **cannot run a command** | `warp://action/new_window?path=<cwd>`, also with no command | commands only through a launch-configuration YAML file in `~/.warp/` | URL encoding + YAML escaping | the URI launches it |

**Shell gotcha for the argv-based terminals (WezTerm, kitty, Ghostty).** They exec the program directly, with no interactive shell. `claude` is then looked up in the GUI's PATH, so a shell alias or a PATH set only in `.zshrc` is lost (today `shellWord` leaves `claude` bare for exactly this reason). The tab also closes when `claude` exits, whereas iTerm leaves a shell behind. Fix: pass `[$SHELL, '-lic', shellLine + '; exec ' + $SHELL + ' -l']`. That gives the same shell line as today, as one argv element, with no extra quoting layer.

## 3. Proposed port

The route-facing port stays as it is: `Launcher.open(cwd, argv)`. Routes, tests and `start.ts` don't change. Behind it, one adapter per terminal:

```ts
/** One terminal app. `plan` is pure, so each adapter is unit-tested like osascriptArgs today. */
export interface TerminalAdapter {
  id: TerminalApp;
  caps: {
    /** Can open a tab in the front window without Accessibility or typing into an existing tab. */
    tab: boolean;
    /** Takes argv directly (no shell); the launcher wraps the line in `$SHELL -lic`. */
    argv: boolean;
    /** Exit code means success, so a failure can become a 500 (osascript fails after the reply). */
    syncResult: boolean;
  };
  /** The process to spawn, e.g. { file: '/usr/bin/osascript', args: ['-e', SCRIPT, line] }. */
  plan(req: { cwd: string; shellLine: string; argv: readonly string[]; target: 'tab' | 'window' }): SpawnPlan;
  /** Optional second plan when the first fails because the app is not running (WezTerm, kitty). */
  coldPlan?(req: …): SpawnPlan;
}
```

| Adapter | tab | argv | syncResult |
|---|---|---|---|
| iterm | ✓ | — | — |
| terminal | — | — | — |
| wezterm | ✓ | ✓ | ✓ |
| kitty | ✓ only with remote control configured; otherwise — | ✓ | ✓ |
| ghostty | — | ✓ | — |
| warp, vscode | not offered (no way to run a command) | | |

**Fallback rule.** Prefer a tab in the front window. Open a new window when `caps.tab` is false, the app has no window, or the app is not running. Then use only that one window (never an extra default window). **Never** fall back to a keystroke (Accessibility) or to typing into an existing tab. An unknown or uninstalled terminal makes `open()` throw before spawning, so the route returns its existing 500.

## 4. Risks

**Command injection**
- iTerm / Terminal.app: the line is passed as argv to osascript, never spliced into the script, and every non-plain word is single-quoted. Tested above with `'`, `$(…)`, backticks and `;`: nothing ran. Remaining gap: the line is *typed* into a shell, and only the session name is checked for control characters (`launch/index.ts:69`). `cwd` comes from the transcript and is not checked. Inside single quotes a newline is harmless (the shell continues the quote), but a cwd check costs one line and closes the gap.
- WezTerm / kitty / Ghostty: argv into the CLI, so no injection at that layer. The `$SHELL -lic <line>` wrapper reuses the same `shellLine` quoting.
- kitty: `allow_remote_control yes` lets any local process drive kitty. If offered at all, require `listen_on` with a socket only, and document it.
- Warp: any command route means writing YAML with the command in it, which adds a new escaping layer. Don't.
- VS Code URI: `session` is a UUID (checked by us and by the extension's `Ww`); `prompt` would need `encodeURIComponent`.

**Focus**
- osascript `activate` brings the app forward and macOS switches Space if the window is on another one. That is the case today for iTerm, and the user expects it.
- Untested: `wezterm cli spawn` and `kitten @ launch` may open the tab without raising the window. Follow with `open -a <App>` (or `wezterm cli activate-pane`).
- Never use keystroke routes: if focus moves between `activate` and the keystroke, the keys land in another app.

**App not running**
- iTerm2: handled (5 s wait, first window).
- Terminal.app: works but leaves an extra empty window (tested above); fix as described in § 2.
- WezTerm / kitty: the first plan fails fast; run `coldPlan`.
- **Not installed:** with osascript, `tell application "X"` for a missing app can show a macOS "Where is X?" chooser instead of failing (known AppleScript behaviour; not triggered here). Check that the bundle exists (`/Applications/X.app` or by bundle id) before spawning. CLI adapters fail with ENOENT at spawn, which is already a 500.
- Automation (TCC): the first osascript launch from a server started by `dashboard start` or launchd may prompt "… wants to control iTerm/Terminal" (spike Q9, still untested). CLI adapters avoid TCC entirely.

## Conclusion

**Refactor size: small to medium.**
- Small: Terminal.app cold-start fix, adapter split, WezTerm. Everything stays in `src/server/launch/` and `src/shared/config.ts`, with no new dependency and no route change.
- Medium if kitty (user config, remote-control docs), a Ghostty AppleScript route, or a "tab or window" field in the reply are added.

**Recommended order**
1. Write the ADR (adapter port + fallback rule).
2. Pure refactor: move iterm/terminal into adapters. Behaviour is unchanged; the existing tests must still pass.
3. Fix the Terminal.app cold start (extra window), plus a cwd control-character check.
4. WezTerm adapter (`$SHELL -lic` wrapper, `coldPlan`). It needs an install to test.
5. kitty, then Ghostty, only if someone uses them. Leave Warp and VS Code out, and document why.

**Conflicts with the existing ADRs and rules**
- No accepted ADR fixes iTerm2. The iTerm2 choice lives in `docs/spec.md` (lines 128, 133, 284) and spike Q9, so it is a spec edit plus a new ADR, not a supersede.
- **ADR 0025** (pre-assigned `--session-id` for New session) rules out the VS Code extension URI for New session: it cannot take an id, so the pending entry would never match a transcript. Resume only.
- **ADR 0058**: `terminal` is a per-machine key, so a value set in the home `config.json` works as is. It should not go in the committed `dashboard.config.json`.
- **CLAUDE.md**: argv-only spawning is satisfied by every adapter above. Warp's launch-config route would write files outside the repo (not under `~/.claude/`, so not forbidden), which is one more reason to drop it. No new dependency is needed.
