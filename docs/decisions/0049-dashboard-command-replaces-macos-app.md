# 0049: A `dashboard` shell command replaces the macOS launcher app; `dashboard start` rotates the token

- Status: Accepted
- Date: 2026-10-27
- Task: v2 manual debug
- Supersedes: 0046

## Context
- The user tried the launcher app (ADR 0046) and found it unintuitive: after closing the page, clicking the app did not open a new window, and there was no way to stop the server.
- The dashboard is mostly used while Claude Code runs in a terminal, so the user prefers a terminal command. The user also asked whether a skill could open it.
- A skill alone costs a model turn and usually a permission prompt per use, and a server started as a Claude background task stops when that session ends.

## Options
1. **Shell script, with a thin skill that calls it**: `bin/dashboard start|open|stop|status|logs`, linked onto PATH. Works from any terminal, from Claude as `! dashboard open` with no model turn, and through the skill.
2. **Skill only**: Claude starts and opens the server itself. Only works inside Claude, costs a turn, and needs `nohup` anyway.
3. **Keep the app and add a Stop item**: AppleScript applets have no window to put it in, and the reopen problem stays.

## Decision
Option 1, chosen by the user on 2026-10-27.
- `start`: if nothing answers on 127.0.0.1:4317, removes the url file, starts `node node_modules/tsx/dist/cli.mjs src/server/index.ts --rotate-token` with `nohup`, logging to `~/.claude-dashboard/server.log`, waits up to 15 s for the server and the new url file, then opens the link. When the server is already up, it only opens the page.
- `open` is separate, at the user's request: it opens the link and fails without starting anything when the server is down.
- `stop` kills the listener on 4317, but refuses and prints the `launchctl bootout` command when launchd runs the dashboard, since launchd would restart it.
- Every `dashboard start` rotates the token, at the user's request; open tabs reconnect through ADR 0048. `pnpm start` and launchd keep it (ADR 0032).
- `skills/dashboard/SKILL.md` maps requests to these subcommands. The user links it into `~/.claude/skills/`; the repo never writes there (CLAUDE.md).
- `macos/` is removed. `~/Applications/Claude Dashboard.app` is not deleted by the repo; remove it by hand.

## Consequences
- `node` comes from the user's shell PATH, so switching Node versions needs nothing rebuilt.
- Like the app, `dashboard start` does not run `pnpm build`; it warns when `dist/web` is missing.
- The Clawd Sparkles favicon (ADR 0045) stays; only the `.icns` app icon went with `macos/`.
