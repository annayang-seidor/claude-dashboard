# 0017: Self-host Noto Sans TC and JetBrains Mono with @fontsource

- Status: Superseded by 0020
- Date: 2026-10-24
- Task: T5

## Context
- The spec's design tokens name Noto Sans TC and JetBrains Mono; the prototype loads them from Google Fonts.
- The dashboard is local-only and should work offline without calling third parties.

## Options
1. **@fontsource packages**: bundled by Vite and served by our own server; CSS splits each family by unicode-range, so the browser only fetches the slices a page uses. Two new dependencies.
2. **Google Fonts `<link>`**: no dependency, but every load calls Google and offline falls back to system fonts.
3. **System fonts only**: no dependency and no network, but visibly different from the prototype.

## Decision
Option 1, chosen by the user on 2026-10-24. `src/web/fonts.ts` imports Noto Sans TC 400/500/700 and JetBrains Mono 400/500/700 (700 is used for production env tags).

## Consequences
- `dist/web` grows to about 17 MB (≈650 woff/woff2 slices) and the CSS to ~430 kB (190 kB gzip) of `@font-face` rules. Downloads per page stay small because of unicode-range, and the files never leave the machine.
- Adding a weight means adding one import line in `fonts.ts`.
