# 0050: The app shell is sent with no-cache, hashed assets as immutable, and a missing asset is a 404

- Status: Accepted
- Date: 2026-10-27
- Task: v2 manual debug

## Context
- After `pnpm build` while a tab was open, the page came up with an empty body. A fresh tab worked.
- Static files were served with `Last-Modified` and no `Cache-Control`, so Chrome may reuse a cached `index.html` without asking. A shell from an old build names `/assets/index-<old hash>.js`, which the new build deleted.
- Any missing path fell back to `index.html` for client-side routes, including `/assets/*`. The browser got HTML for a module script, refused it, and showed nothing, with no message in the page.

## Options
1. **no-cache shell, immutable assets, 404 for missing assets**: the browser revalidates the shell on every load (a 304 when unchanged), never refetches a hashed asset, and a stale one fails as a 404.
2. **no-store on everything**: simplest, but every load downloads the whole bundle again.
3. **Leave headers, only 404 missing assets**: the error becomes visible in the console, but the page still breaks until a hard reload.

## Decision
Option 1, chosen by the user on 2026-10-27.
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`; a file that isn't there is a 404 instead of the shell.
- Everything else from `dist/web` (the shell, client-side routes, the favicon): `Cache-Control: no-cache`.
- The header is set by a middleware after `serveStatic`, because `serveStatic`'s `onFound` runs after it has built the response.

## Consequences
- A rebuild shows up on the next load of an open tab, without a hard reload.
- A tab that loaded the shell mid-build still fails, but with a 404 in the console; reloading fixes it.
- `/api` responses are unchanged.
