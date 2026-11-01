# 0022: Test components with React Testing Library on jsdom

- Status: Accepted
- Date: 2026-10-24
- Task: T6

## Context
- T6 asks for filter and search tests with React Testing Library. Vitest runs in the `node` environment, which has no DOM.
- Server tests must keep running on `node`.

## Options
1. **RTL + jsdom + user-event**: the most complete DOM and what RTL's docs assume; slower start (about 1 s per file). Typing and `<select>` changes go through real event sequences.
2. **RTL + happy-dom**: faster and smaller, but gaps in `<select>` and focus behaviour could let tests pass that a browser would fail.
3. **RTL + jsdom, no user-event**: one fewer package; tests use `fireEvent`, so typing is one change per value, not per keystroke.

## Decision
Option 1, chosen by the user on 2026-10-24. Dev dependencies: `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `jsdom`.
- `vitest.config.ts` stays on `node`; each component test opts in with a `// @vitest-environment jsdom` first line.
- Vitest globals stay off, so component tests call `afterEach(cleanup)` themselves.
- `src/web/sessions/testing.tsx` renders with `I18nProvider` as the `wrapper`, so `rerender()` keeps it.

## Consequences
- Code that reads `window` at import (for example `src/web/api.ts`) can only be imported from jsdom tests; pure helpers live in their own modules (`src/web/sse.ts`, `src/web/sessions/fixtures.ts`).
- Playwright (ADR 0021) is still the check for layout and real-browser behaviour.
