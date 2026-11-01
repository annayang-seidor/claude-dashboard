# 0046: A macOS launcher app starts the server if needed and opens the link

- Status: Superseded by 0049
- Date: 2026-10-27
- Task: —

## Context
- The user wants the dashboard in the macOS Applications list (Spotlight, Launchpad, Dock).
- The link carries the token (ADR 0032) and is kept in `~/.claude-dashboard/url` (ADR 0029). The launchd agent is optional and not installed by the repo.
- An app has no shell profile, so `pnpm` and nvm's `node` are not on its PATH.

## Options
1. **AppleScript applet** (`osacompile`): reads the url file on each launch, so token rotation is fine; can start the server when it is down.
2. **Chrome "Install page as app"**: a windowed app, but it stores the link with the token and cannot start the server.
3. **Automator app**: same as 1, but built by hand in Automator, so it can't be rebuilt from the repo.

## Decision
Option 1, chosen by the user on 2026-10-27. Source in `macos/`; `macos/build-app.sh` fills in the absolute repo and `node` paths and installs `~/Applications/Claude Dashboard.app` with the Clawd Sparkles icon (ADR 0045). When nothing answers on 127.0.0.1:4317 it starts the server with the launchd plist's command, detached with `nohup`, logging to `~/.claude-dashboard/server.log`. It then waits up to 15 s and opens the link.

## Consequences
- A server the app starts keeps running after the app quits; stop it with `kill $(lsof -tiTCP:4317 -sTCP:LISTEN)`.
- With launchd installed, the app only opens the link.
- Moving the checkout or switching Node versions needs `macos/build-app.sh` again.
- The app does not run `pnpm build`; a stale `dist/web` serves the old page.
