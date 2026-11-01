# 0003: One process serves API and page in production; Vite only in dev

- Status: Proposed
- Date: 2026-10-23
- Task: T1

## Context
T9 adds a launchd plist so the dashboard starts at login. A login service is simpler with one process and one port.

## Options
1. **Run Vite and the server in production too**: no build step, but two processes, two ports, a dev server running all day, and two origins to allow.
2. **Build the page; the server serves `dist/web/`**: one process and one port, but `pnpm build` is needed after changes.

## Decision
Option 2.
- `pnpm dev`: the server on 4317 plus Vite on 5173 with hot reload; `/api` is proxied.
- `pnpm build`: writes `dist/web/`.
- `pnpm start`: the server only. It serves `dist/web/` and falls back to `index.html` for `/work` and `/personal`.

The server serves `dist/web/` only when `DASHBOARD_WEB_ORIGIN` is unset, so dev never shows a stale build. The server runs through `tsx`, with no compiled server bundle.

## Consequences
- The launchd plist runs one command after a build.
- Static files get the Host check but not the token check (0001), so the page loads before it knows the token.
- Running through `tsx` saves a build step. Revisit only if start-up time hurts the 1-second target.
