# 0021: Keep the prototype as one file per page; Playwright opens them directly

- Status: Accepted
- Date: 2026-10-24
- Task: T5
- Supersedes: 0019

## Context
- CLAUDE.md and docs/review.md name `docs/prototype/*.dc.html` with `Main-en.dc.html` and `Personal-en.dc.html`, but the repo held one bundle, `docs/prototype/.dc.html`, which `*.dc.html` does not match (dot file).
- The bundle's outer page was only a board of four iframes; each page is a self-contained bundle that opens on its own, and the pages already link to each other as `Main.dc.html` / `Personal.dc.html` (zh-TW) and `Main-en.dc.html` / `Personal-en.dc.html`.
- ADR 0019 added Playwright and unpacked the bundle at test time.

## Options
1. **Keep the bundle, unpack in tests** (ADR 0019): one 1.3 MB file; tests and readers need an unpack step; the names in CLAUDE.md do not exist.
2. **Split into four files** named as the pages link to each other: matches CLAUDE.md, each opens in a browser, and the links between them work; 2.4 MB in total because each file carries its own runtime and font subsets.

## Decision
Option 2, chosen by the user on 2026-10-24. `docs/prototype/` holds `Main.dc.html`, `Personal.dc.html`, `Main-en.dc.html` and `Personal-en.dc.html`, extracted unchanged from the bundle. The rest of ADR 0019 stands: `@playwright/test` is a devDependency, `pnpm e2e` runs `e2e/` against the Vite dev server, and side-by-side sheets go to `e2e/screenshots/` (git-ignored). `e2e/header.spec.ts` opens the prototype files directly.

## Consequences
- The overview board (all four pages side by side) is gone; open the pages one at a time.
- First run on a new machine still needs `pnpm exec playwright install chromium`.
