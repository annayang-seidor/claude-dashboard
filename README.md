# Claude Code Session Dashboard

A local dashboard for finding, resuming and tidying Claude Code sessions in `~/y` (Work) and `~/o` (Personal), or the workspaces you configure. It runs on `127.0.0.1` only, on your own machine.

- Spec: [docs/spec.md](docs/spec.md) · API: [docs/api.md](docs/api.md) · Decisions: [docs/decisions/](docs/decisions/)
- It reads `~/.claude/projects/` and `~/.claude/settings.json`. It writes only to `~/.claude-dashboard/` (state, trash, the access token and the current link). The one exception: Delete moves a transcript, and its `<id>/` folder, from `~/.claude/projects/` to `~/.claude-dashboard/trash/`, and Undo moves it back.
- Bookmarks protect a session only from the dashboard's own cleanup. Claude Code still deletes sessions idle longer than its `cleanupPeriodDays` (30 unless set). The dashboard never changes that setting; it warns on bookmarked rows 7 days ahead.

## Requirements

- macOS (Resume opens iTerm2 or Terminal through `osascript`)
- Node 22.22 or later, and pnpm 10 (`corepack enable` picks the version from `package.json`)
- iTerm2, or set Terminal.app in the configuration below

## Install

```sh
pnpm install
pnpm exec playwright install chromium   # only for pnpm e2e
```

## Start

Day to day, build once and run one process (ADR 0003):

```sh
pnpm build    # writes dist/web; run again after pulling changes
pnpm start    # server + page on http://127.0.0.1:4317
```

Open the dashboard with its link, which carries the access token:

```sh
open "$(cat ~/.claude-dashboard/url)"
```

### From any folder: `dashboard`

`bin/dashboard` runs the server in the background and opens the page (ADR 0049). Link it onto your PATH once:

```sh
ln -s ~/o/claude-dashboard/bin/dashboard ~/.local/bin/dashboard
```

```sh
dashboard start    # start with a new token if not running, then open the page
dashboard open     # open the page; fails when the server isn't running
dashboard stop     # stop the server
dashboard status   # running or not
dashboard logs     # follow ~/.claude-dashboard/server.log
```

The server keeps running after the terminal closes. Every `dashboard start` rotates the token; tabs left open from the last run show **Reconnect** (ADR 0048). `pnpm start` keeps the token, which lives in `~/.claude-dashboard/token` (mode 600), across restarts (ADR 0032).

To open the dashboard from inside Claude Code, either type `! dashboard open`, or install the skill once and ask Claude to "open the dashboard":

```sh
ln -s ~/o/claude-dashboard/skills/dashboard ~/.claude/skills/dashboard
```

To replace the token:

```sh
pnpm start --rotate-token
```

Open tabs then show "Server restarted — open the new link" with a **Reconnect** button, which trades the tab's old token for the new one and reloads the page (ADR 0048). A tab older than the last rotation can't reconnect; open the url file again.

If the link leaked somewhere, revoke instead, so the old token can't be traded in:

```sh
pnpm start --revoke-token
```

For development, `pnpm dev` runs the server with hot reload on Vite (http://127.0.0.1:5173) and prints the link.

## Configuration

Settings live in [dashboard.config.json](dashboard.config.json) (repo, shared) and `~/.claude-dashboard/config.json` (this machine, wins key by key). Both are plain JSON and optional.

See [dashboard.config.example.jsonc](dashboard.config.example.jsonc) for every key, its default and what it does. Copy the keys you need and remove the comments. Restart the dashboard after a change; an invalid file stops it with a message naming the file and key.

## Start at login (launchd)

The repo includes [launchd/com.annayang.claude-dashboard.plist](launchd/com.annayang.claude-dashboard.plist), but nothing installs it for you.

1. Check the absolute paths in the plist: the `node` binary (`which node`; an nvm path changes when you switch versions), this checkout, and your home folder. launchd does not expand `~` or read your shell profile.
2. Build the page and make sure the log folder exists:
   ```sh
   pnpm build
   mkdir -p ~/.claude-dashboard
   ```
3. Install and start it:
   ```sh
   cp launchd/com.annayang.claude-dashboard.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.annayang.claude-dashboard.plist
   open "$(cat ~/.claude-dashboard/url)"
   ```

After pulling changes, rebuild and restart:

```sh
pnpm install && pnpm build
launchctl kickstart -k gui/$(id -u)/com.annayang.claude-dashboard
```

To revoke the token while launchd runs it, delete the token files and restart; a new one is made:

```sh
rm ~/.claude-dashboard/token ~/.claude-dashboard/token.previous
launchctl kickstart -k gui/$(id -u)/com.annayang.claude-dashboard
```

Stop it and remove it from login:

```sh
launchctl bootout gui/$(id -u)/com.annayang.claude-dashboard
rm ~/Library/LaunchAgents/com.annayang.claude-dashboard.plist
```

The log is `~/.claude-dashboard/server.log`. It never contains the link or token. Start-up time is logged as `[startup] ready to serve after N ms` and `[startup] first list (…) took N ms`; the target is under 1 s. While the launchd copy runs, `pnpm start` and `pnpm dev` cannot use port 4317, so stop it first (`bootout` above).

## Known limits in v0

- **Category can't be changed in the UI.** A session detected as the wrong type (Ticket, Ops, Scratch) stays that way until T10 adds the row menu (⋯ → Change category). The API already accepts it (`PATCH /api/sessions/:id` with `categoryOverride`), but nothing in the page calls it.
- **No auto-archive.** Nothing is moved to the trash for you until T11. Old Scratch and Personal sessions stay until you delete them, or until Claude Code's own `cleanupPeriodDays` removes them. Rows don't show "Moves to trash in N days" until then (`autoArchive.enabled` in the configuration).

## Tests

```sh
pnpm test                    # Vitest: server, model and components
pnpm typecheck && pnpm lint
pnpm e2e                     # Playwright, screenshots in e2e/screenshots/
```

Tests use `fixtures/projects/`, never your real `~/.claude`. The Playwright smoke (`e2e/smoke.spec.ts`) builds the page and runs the real server on port 4318 against a temp copy of the fixtures (ADR 0028). It can run while the launchd copy is up.
