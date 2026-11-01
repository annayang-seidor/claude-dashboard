# 0002: Deliver the token in the URL and keep it in memory

- Status: Superseded by 0032
- Date: 2026-10-23
- Task: T1

## Context
The per-launch token (0001) has to reach the page without the server handing it to anyone who asks, or an attacker's page could get it the same way. The dashboard is reloaded many times a day.

## Options
1. **Token in the URL, read into memory, left in the address bar**: reload works. The token is visible in history and could leak through `Referer`.
2. **Same, but strip `?t=` with `history.replaceState`**: cleaner URL and history, but every reload gets 403 until the link is copied again from the terminal.
3. **sessionStorage**: survives reload, but any script on the origin can read it, which is no safer than the URL. It also breaks the review's "memory only" rule.
4. **Cookie set by the server**: the server needs another secret to decide who gets the cookie, which means more moving parts for no gain.

## Decision
Option 1. The server prints `http://<page origin>/?t=<token>`. `src/web/api.ts` reads `t` once into a module variable and never stores it. `index.html` sets `<meta name="referrer" content="no-referrer">` so the URL is never sent to another site.

## Consequences
- The token appears in browser history and terminal scrollback, both on the same machine. Accepted for a local-only tool.
- A server restart makes a new token, so open tabs get 403 until reopened from the new link (unverified in a browser; follows from the code). T9's launchd auto-start needs a way to show the current link, for example a mode-600 file under `~/.claude-dashboard/`.
- Reload keeping the token works because it stays in the URL (unverified in a browser; only checked with curl).
