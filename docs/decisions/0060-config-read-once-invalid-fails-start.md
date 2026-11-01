# 0060: Config is read once at start; an invalid file stops the server; every key has a default; nested objects merge; prodEnvs is dropped; the example is commented .jsonc

- Status: Proposed
- Date: 2026-11-01
- Task: T17b
- Supersedes (once accepted): in ADR 0058, "read by the server on each call", "an invalid file is logged and skipped" and "unknown keys are ignored"; in ADR 0044, "an invalid value makes readConfig fall back"; the shallow merge in ADR 0058; in ADR 0035, the config.json `prodEnvs` list

## Context
- T17b moves the hard-coded settings into the two config files from ADR 0058:
  - workspace roots;
  - cleanup ranges and defaults;
  - auto-archive ages;
  - trash retention;
  - job and Jira timings.
- Some of these shape the page before its first render (the tabs) or run on timers set once at start (the daily jobs and the Jira scheduler). A value read on each call would change the routes and the timers at different moments.
- Under ADR 0058, a typo in a file silently dropped that file's settings, and an unknown key was ignored. With workspace roots in the file, a typo could quietly move every session to the fallback workspace.
- With nested keys (`cleanup.ranges`, `jira.syncWindow`), a shallow merge would make a home file that sets `cleanup.keepTodo` drop the project's `cleanup.ranges`.
- `prodEnvs` (ADR 0035) let the config mark more hac envs as production. hac's toml already says which envs are production (`read_only = true`), so two sources could disagree. The user asked on 2026-11-01 to drop it.
- JSON has no comments, so a plain example file cannot explain its keys or list the allowed values.

## Options
When to read:
1. **Once at start**: one consistent config for the routes, the page and the timers. A change needs a restart (`dashboard start`).
2. **On each call** (ADR 0058 today): no restart, but the timers and the page's tabs would still need one, so some keys would be live and others not.
3. **Watch the files**: live everywhere, but every timer and the page would need a reload path. That is more code than the feature needs.

Invalid config:
1. **Fail at start**: the message names the file, the key path and the expected value. Nothing is served until it is fixed.
2. **Skip the file** (ADR 0058 today): the server starts, but on settings nobody chose.

## Decision
Once at start, and fail at start, as the T17b prompt asks. Merging and strictness follow from those two.
- `loadConfig(paths)` (src/server/config.ts) reads the project file, then the home file.
- A missing file is skipped.
- An unreadable file, bad JSON, or a file that does not match `DashboardConfigFile` throws `ConfigError`. The message has the form `Invalid config in <file>: <key.path>: <expected …>`.
  - Unknown keys are errors (`strictObject`), so a misspelled key cannot pass for a default.
  - `src/server/index.ts` prints the message and exits with code 1.
  - `start()` throws before it creates any file.
- Files merge key by key, and nested objects merge too: a home `cleanup.keepTodo` keeps the project's `cleanup.ranges`. Arrays, `workspaces` among them, are replaced whole.
- `prodEnvs` is gone. Production is `read_only = true` in hac's toml, or the name rule (`isProd` in src/shared/env.ts). A file that still sets `prodEnvs` fails as an unknown key.
- The documented example is `dashboard.config.example.jsonc`: every key at its default, with comments that list the allowed values. The real files stay strict JSON, with no comment parser and no new dependency. A real file that fails to parse and has comment lines gets a hint to remove them. Prettier writes `*.jsonc` without trailing commas, so a copied block stays valid JSON.
- Every key has a default in `DashboardConfig` (src/shared/config.ts), and `DEFAULT_CONFIG` is today's behaviour. Checks across keys run after the merge:
  - `cleanup.defaultRange` must be one of `cleanup.ranges`;
  - `jira.syncWindow` must end after it starts;
  - `jira.changedDays` must be at most `jira.maxDays`.

  Their error names the last file that set the key, or the nearest object around it.
- `start()` reads Claude Code's `cleanupPeriodDays` once and logs `[config] …` for each cleanup range or `autoArchiveDays` at or over it. This is a warning, not an error: Claude Code's setting can change without the dashboard knowing.

## Consequences
- Changing the config takes a restart. The README says so.
- A broken home file stops the dashboard instead of falling back. Under launchd the error goes to the log file.
- An env hac does not mark read-only, and whose name does not look like production, can no longer be tagged production from the dashboard; set `read_only = true` in its toml instead.
- Editing a config means removing the example's comments by hand.
- Settings that used to be constants are now defaults in one schema, so the page and the server can no longer disagree on them.
