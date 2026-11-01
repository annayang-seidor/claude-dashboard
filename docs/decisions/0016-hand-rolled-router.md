# 0016: Route /work and /personal with a hand-rolled History API router

- Status: Accepted
- Date: 2026-10-24
- Task: T5

## Context
- The app has two flat routes, `/work` and `/personal` (spec; ADR 0003 already falls back to `index.html` for both).
- The page URL carries the dashboard token as `?t=` (ADR 0002). A reload needs it, so every in-app navigation must keep the query string.
- No router was installed; adding one is a new dependency.

## Options
1. **Hand-rolled**: `useSyncExternalStore` on `popstate`, a `navigate()` helper and a `Link` that keeps `location.search`. About 60 lines, no dependency.
2. **react-router**: standard, but a new runtime dependency for two flat routes, and the token still has to be carried by hand.

## Decision
Option 1, chosen by the user on 2026-10-24. `src/web/router.tsx` holds the routes, `Link`, `navigate` and `normalizeInitialPath` (any other path, including `/`, is replaced with `/work`).

## Consequences
- Nested routes, params or loaders would mean revisiting this; swapping in a library touches `router.tsx` and its callers only.
- `Link` lets modified clicks (⌘/Ctrl/Shift/middle) through to the browser, so open-in-new-tab keeps working with the token.
