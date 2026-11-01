# 0019: Add Playwright for browser tests and prototype screenshots

- Status: Superseded by 0021
- Date: 2026-10-24
- Task: T5

## Context
- T5's acceptance asks for side-by-side header screenshots against the prototype at 1440 and 880 px; T9 needs a Playwright smoke test (docs/review.md lists Playwright in the stack).
- The prototype is one bundle, `docs/prototype/.dc.html`, holding four pages (zh-TW/EN × Work/Personal) as gzip+base64 entries.

## Options
1. **`@playwright/test` as a devDependency**: `pnpm e2e` reruns the comparison any time; Chromium (~100 MB) downloads to the user cache, outside the repo.
2. **One-off script via `pnpm dlx`**: nothing added to the repo, but the comparison cannot be rerun from it.

## Decision
Option 1, chosen by the user on 2026-10-24.
- `playwright.config.ts` runs specs in `e2e/` against the Vite dev server (reused if already running).
- `e2e/prototype.ts` unpacks the four prototype pages from the bundle at test time, so the docs stay the single source.
- Side-by-side sheets go to `e2e/screenshots/` (git-ignored).

## Consequences
- First run on a new machine needs `pnpm exec playwright install chromium`.
- Specs are not part of `pnpm test` (Vitest only matches `src/**/*.test.ts[x]`).
