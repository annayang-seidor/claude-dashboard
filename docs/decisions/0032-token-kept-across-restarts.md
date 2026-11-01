# 0032: Keep the token in ~/.claude-dashboard/token across restarts; on a 403 the page stops and asks for the new link

- Status: Accepted; 403 fallback superseded by 0048
- Date: 2026-10-24
- Task: T9
- Supersedes: 0002, 0029; the "made at launch" part of 0001

## Context
- ADR 0001 protects the API with Host and Origin checks plus a random token that every `/api/` request must send, made at each launch. ADR 0002 delivers it in the page URL. ADR 0029 writes the current link to `~/.claude-dashboard/url` for launchd.
- Under launchd (T9) the server restarts without you noticing: at login, after a crash, after `kickstart`. A new token on each start made every open tab fail with 403 until you reopened the link.
- The token defends against other web pages (DNS rebinding, CSRF; ADR 0001). It does not defend against other programs running as you: they can already read your browser history, your transcripts and the url file.

## Options
1. **New token per launch** (ADR 0002): a restart breaks every open tab.
2. **Keep the token in a mode-600 file and reuse it until rotated**: tabs survive restarts. The threat model is unchanged, because the token was never secret from programs running as you.

## Decision
Option 2, chosen by the user on 2026-10-24.
- `loadToken` (`src/server/token.ts`) reads `~/.claude-dashboard/token`. It makes 32 random bytes (base64url) when the file is missing, does not hold a valid token, or `--rotate-token` is passed (`pnpm start --rotate-token`). It writes with mode 600, and tightens to 600 (with a log line) a file other users could read.
- The token is still compared in constant time, and Host and Origin checks are unchanged (ADR 0001).
- The url file stays (from 0029): mode 600, rewritten on each start. The link is printed only to a terminal or in `pnpm dev`, so the launchd log never holds it. A long-lived token in a log file would be worse than a per-launch one.
- 403 fallback: the first 403 on any call sets an "access lost" flag in `src/web/api.ts`. From then on the live-update stream never reconnects, and the page shows "Server restarted — open the new link" with the `open "$(cat ~/.claude-dashboard/url)"` command instead of load errors and Retry buttons. The page cannot show the link itself: anything that hands out the token to whoever asks defeats it.

## Consequences
- A tab opened once keeps working until you rotate the token.
- After `--rotate-token` (or deleting the token file), every open tab shows the banner. Reopen it from the url file.
- The token is in `~/.claude-dashboard/token`, the url file and browser history, all readable only by you.
- ADR 0001's tests for the token check still apply; only its lifetime changed.
