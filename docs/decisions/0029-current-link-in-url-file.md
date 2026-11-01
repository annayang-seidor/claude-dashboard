# 0029: Write the current link to ~/.claude-dashboard/url (mode 600)

- Status: Superseded by 0032
- Date: 2026-10-24
- Task: T9

## Context
- The page needs the per-launch token in its URL (ADR 0002). The server prints the link to stdout.
- Under launchd nobody sees stdout, and each restart (login, crash) makes a new token. ADR 0002 flagged this for T9.

## Options
1. **Mode-600 url file**: on start, the server writes the current link to `~/.claude-dashboard/url`. `open "$(cat ~/.claude-dashboard/url)"` opens it, as an alias or a launcher script. The token stays per launch.
2. **Read the launchd log**: no code change, but the log keeps every old token and the link has to be copied by hand.
3. **Persist the token across restarts**: bookmarkable, but it reverses the per-launch token of ADR 0001/0002.

## Decision
Option 1, chosen by the user on 2026-10-24. `start()` writes `<dashboardDir>/url` with mode 0600 and then runs `chmod 0600`, because `writeFile`'s mode only applies when it creates the file. The file is left in place on exit; a stale link only gets 403.

## Consequences
- Any process running as the user can read the token, as it already could from the terminal or the browser history (ADR 0002). Other users cannot.
- The README's launchd section opens the dashboard through this file.
- `index.ts` prints the link only to a terminal or in `pnpm dev`, so the launchd log never holds a token.
