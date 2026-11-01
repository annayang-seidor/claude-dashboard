# 0048: A tab holding the token from before the last rotation can trade it for the current one; --revoke-token drops it

- Status: Accepted
- Date: 2026-10-27
- Task: v2 manual debug
- Supersedes: the 403 fallback of 0032 ("the page cannot show the link itself")

## Context
- The user wants the token refreshed on every start (ADR 0049), and a button on the "Server restarted — open the new link" banner that gets the new token and reloads the page in the same window.
- ADR 0032: the page cannot fetch the link itself, because anything that hands the token to whoever asks defeats it. The token defends against other web pages (DNS rebinding, CSRF; ADR 0001), not against programs running as the user.

## Options
1. **Trade in the old token**: on rotation the server keeps the replaced token in `~/.claude-dashboard/token.previous`. `POST /api/token/refresh` with that token returns the current one. Only a tab that already had access can refresh; a tab two or more rotations old still needs the command.
2. **Same-origin hand-out**: return the current token to any request that passes Host, the exact Origin and `Sec-Fetch-Site: same-origin`. Works for tabs of any age, but the token then adds little beyond the Origin check, reversing ADR 0032's rule.

## Decision
Option 1, chosen by the user on 2026-10-27.
- `loadToken` with `rotate` writes the replaced token to `<token>.previous` (mode 600). `loadPreviousToken` reads it at start.
- The security middleware accepts the previous token only on `POST /api/token/refresh`, after the same Host and Origin checks as every other POST. The route returns `{ token }` (`TokenRefreshResponse`). Any other route still needs the current token.
- The banner gets a Reconnect button. It posts the tab's token, then `location.replace`s the same route with the new `?t=`. When refused it says the link is too old; when nothing answers it says to run `dashboard start`. The copy-command line stays.
- `--revoke-token` rotates and deletes `token.previous`, for a leaked link: a leaked token could otherwise trade itself for the new one.

## Consequences
- Routine rotation (every `dashboard start`) costs open tabs one click instead of a terminal trip.
- A token stays useful for one more rotation, so after a leak, plain `--rotate-token` is not enough; the README says to use `--revoke-token`.
- Deleting the token file (the old launchd recipe) makes a new token without touching `token.previous`.
