# 0028: One start() for the server; the Playwright smoke runs it on a fixture copy

- Status: Accepted
- Date: 2026-10-24
- Task: T9

## Context
- T9's smoke test needs the real server and page on `fixtures/projects/`. CLAUDE.md says tests never touch the real `~/.claude`.
- `src/server/index.ts` hard-coded every path from `os.homedir()`, port 4317 and a random token, so a test could not point it anywhere else.
- Once launchd starts the dashboard at login (T9), port 4317 is usually taken.
- ADR 0001 makes the token per launch and random; a token the test knows must not become a way into the real server.

## Options
1. **Shared `start()` plus an e2e entry**: all wiring moves to `start(opts)`. `index.ts` passes the real paths and a random token. `e2e/support/server.ts` passes a temp copy of the fixtures, port 4318 and a fixed token. Production code reads no new environment variables.
2. **Environment overrides in `index.ts`** (`DASHBOARD_PORT`, `…_PROJECTS_ROOT`, `…_DIR`, `…_TOKEN`): less code, but the real server would accept a fixed token from its environment.
3. **Environment paths, token read from stdout**: keeps the token random, but a Playwright globalSetup has to spawn the server and parse its output.

## Decision
Option 1, chosen by the user on 2026-10-24.
- `src/server/start.ts` takes `{ home, projectsRoot, claudeSettingsPath, dashboardDir, port, token, webOrigin?, webRoot?, launcher? }` and returns `{ url, close }`.
- `e2e/support/server.ts` copies `fixtures/projects/` to a temp dir and serves a fresh `pnpm build` on 4318 with token `e2e-smoke-token`. Its launcher only logs, so no terminal ever opens. It deletes the temp dir on SIGTERM; Playwright sends that through `gracefulShutdown`.
- `playwright.config.ts` runs two web servers: Vite for the header specs (ADR 0021) and this one for `e2e/smoke.spec.ts`, never reused, so every run starts from the unmodified fixtures.

## Consequences
- `pnpm e2e` builds the page each run (about 1 s).
- The fixture transcripts carry `/Users/annayang/...` cwds, so the e2e server passes that as `home` to classify Work and Personal. It only reads paths under it (the git-root walk); it writes nothing there.
- New server wiring goes in `start.ts`, so both entries get it.
