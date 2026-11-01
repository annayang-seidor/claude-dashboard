# 0020: Load Noto Sans TC and JetBrains Mono from Google Fonts

- Status: Accepted
- Date: 2026-10-24
- Task: T5
- Supersedes: 0017

## Context
- ADR 0017 self-hosted both families with @fontsource. Noto Sans TC ships every CJK unicode-range slice in woff and woff2, so `dist/web` grew to about 17 MB (≈650 files) and the CSS to ~430 kB of `@font-face` rules.
- The browser fetched only the slices a page used, so the cost was install and build size rather than page weight, but the user did not want to carry it.

## Options
1. **Keep @fontsource** (ADR 0017): offline and no third-party requests; large `dist/` and `node_modules`.
2. **Google Fonts `<link>`**: no dependency and a small build; each load requests Google, and offline falls back to system fonts.
3. **System fonts only**: nothing to load, but visibly different from the prototype.

## Decision
Option 2, chosen by the user on 2026-10-24. `src/web/index.html` preconnects to `fonts.googleapis.com` / `fonts.gstatic.com` and loads Noto Sans TC and JetBrains Mono at 400/500/700 with `display=swap`. The @fontsource packages are removed.

## Consequences
- Google receives the user's IP and a request per page load. The page's `<meta name="referrer" content="no-referrer">` keeps the token in the page URL from reaching Google.
- Offline, text renders in `system-ui` / `monospace` (the token stacks already list them as fallbacks).
- If the server ever sends a Content-Security-Policy, it must allow `style-src fonts.googleapis.com` and `font-src fonts.gstatic.com`.
