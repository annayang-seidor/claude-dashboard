# 0039: The headless runner allows three read-only Rovo tools; auth is reported by the prompt with a fallback; Jira titles cache per key in state.json

- Status: Accepted; the `--tools ""` flag and the model consequence superseded by 0040; the three-tool allow-list extended by 0042
- Date: 2026-10-24
- Task: T12

## Context
- T12 runs `claude -p` for Jira titles, with a fixed allow-list of read-only Atlassian Rovo tools whose exact names the user must approve first.
- `claude mcp list` shows Rovo as a claude.ai connector (`claude.ai Atlassian Rovo`), not a local MCP config, so its tools are `mcp__claude_ai_Atlassian_Rovo__*` and `--strict-mcp-config` would drop it.
- `--allowedTools` only pre-approves; it does not hide other tools. `--permission-mode dontAsk` denies anything not pre-approved without a prompt; `--tools ""` removes every built-in tool.
- The runner must say `reason: 'auth'` when the Rovo login is needed. What a run prints in that case has not been measured (unverified).
- `sync.jira` is reserved for T13's inbox and is opaque until then (ADR 0011).
- The task covers the server and the web UI, more than one area.

## Options
Allow-list:
1. **getAccessibleAtlassianResources + searchJiraIssuesUsingJql + getJiraIssue**: cloudId from Rovo, one JQL call for all keys, a per-key fallback.
2. **JQL only**: smallest surface, no fallback when one bad key fails the JQL.
3. **cloudId in config**: one tool call fewer per run, one more setting to keep right.

Auth detection:
1. **Prompt + fallback**: the prompt asks for `{"authRequired":true}` when a Rovo tool says it is not logged in; the runner also matches auth wording in an error result or on stderr.
2. **Outer JSON only**: match wording in an error result; guesses at wording nobody has seen.

Cache shape:
1. **New optional top-level `jiraTitles`**: `{ [key]: { title, status, fetchedAt } | { missing: true, fetchedAt } }`, each key with its own 24 h clock. No version bump; `sync.jira` stays T13's.
2. **Inside `sync.jira`**: one batch with one `fetchedAt`; T13 must then share or migrate the shape.

Split:
1. **T12a server, T12b UI**.
2. **One change**.

## Decision
Chosen by the user on 2026-10-24: option 1 in each.
- Argv: `-p <prompt> --no-session-persistence --output-format json --tools "" --permission-mode dontAsk --allowedTools <the three> --disallowedTools <every Rovo write tool>`. The deny list is a second guard. Spawned with an argv array, stdin ignored, cwd `~/.claude-dashboard/runner`, killed (SIGKILL) after 120 s or 5 MB of output.
- One run at a time: later calls queue behind the one in flight.
- The answer is the JSON in the outer `result`, bare or in a ```json fence, validated by the caller's zod schema. Failures: `auth`, `timeout`, `invalid` (no JSON or schema mismatch), `failed` (anything else).
- Each run appends one activity.log line: `{ at, job, ok, reason?, durationMs, apiDurationMs, turns, tokens: { input, output, cacheRead, cacheCreation }, costUsd, permissionDenials }`. No prompt or answer is logged.
- `jiraTitles` looks up the ticket keys of Work sessions only (Jira is `~/y`'s), at most 50 per run, keys with no entry or one 24 h old. It runs in the background on start and after each rescan. A run that fails leaves the cache as it was and holds background runs back for 15 min. `POST /api/jira/titles/refresh` forces every key and is never held back. Keys asked for but not returned are cached as missing, so they are not asked for on every pass. Issues not asked for are dropped.
- `start()` takes the runner as a required option, so tests and the e2e server pass a fake and never reach the real Jira.

## Consequences
- The auth wording regex is a guess until the first real run; check activity.log and stderr then.
- The runner uses Claude Code's default model, so a title run costs what an Opus run costs. Tune it (e.g. `--model`) after measuring (spec open question).
- The last run's outcome is kept in memory only: after a restart the page shows no error until a run fails again.
- T13 can reuse the runner and its activity.log line as they are. Its inbox prompt must also answer `{"authRequired":true}`.
- `claude` must be on the server's PATH. Under launchd this may need setting (unverified).
- T12b adds titles on ticket groups and in search, and the "Jira login needed" note.
