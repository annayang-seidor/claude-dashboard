# 0042: The Jira inbox widens its window to the last good sync and replaces the result whole; mentions cover 3 days; the runner also allows atlassianUserInfo and raises the MCP result cap; `sync.jira` keeps the result and the last attempt

- Status: Accepted
- Date: 2026-10-24
- Task: T13
- Extends: the allow-list of 0039; defines `sync.jira`, left opaque by 0011

## Context
- T13 adds the `jira-inbox` job on the T12 runner: issues assigned to, reported by or watched by me changed in the last 2 days, plus issues from the past week with a comment mentioning me, "since the last syncedAt", classified into `action`/`fyi` with a one-line reason. Background runs on start and every 45 min, Mon–Fri 09:00–19:00 local; a Sync button runs on demand.
- A fixed 2-day window misses Friday evening on Monday morning; an incremental query would need merging and leave stale items behind.
- Finding mentions and "after your last comment" needs my Atlassian account id. Checked with read-only JQL on 2026-10-24: `comment ~ currentUser()` and `comment ~ "<accountId>"` return the same 18 issues, so the search is a text match that also catches my own comments; the model has to read the comments to tell a mention from my own words ([spike § 11](../spike.md)).
- A real run with prompt v2 showed `fields: comment` returns each issue's whole comment history: 142k characters for the 7-day mention search, over Claude Code's 25,000-token cap on one MCP result. Claude Code then saves the result under `~/.claude/projects/<runner folder>/<id>/tool-results/` (despite `--no-session-persistence`) and the model paged through part of it, giving a valid answer that missed 3 issues ([spike § 11](../spike.md)).
- ADR 0011 left `sync.jira` opaque until this task. ADR 0039 keeps the titles job's last run in memory, so its error is gone after a restart.
- The task covers the server and the web UI, more than one area.

## Options
Window:
1. **Widen, replace**: changed issues from the earlier of 2 days ago and the last good `syncedAt`, at most 7 days back; each valid answer replaces the result whole.
2. **Incremental merge**: only changes since `syncedAt`, upserted by key; cheaper runs, but a missed item stays missed and old items linger.
3. **Fixed 2 d / 7 d**: `syncedAt` only as a hint in the prompt.

Allow-list:
1. **Add atlassianUserInfo to the shared list**: the three reads of 0039 plus the logged-in user's id and name.
2. **Per-job allow-list**: the same tool for the inbox only; a `tools` field on every run request.
3. **Keep the three**: mentions only through `currentUser()` in JQL.

Oversized results:
1. **Raise `MAX_MCP_OUTPUT_TOKENS` and shorten the mention window to 3 days**: complete results inline, nothing saved under `~/.claude`; mentions older than 3 days are not seen.
2. **Raise the cap only**: keeps the spec's week, at about twice the tokens per run.
3. **Search mentions without comments, then fetch new candidates**: small searches, more turns.

Storage:
1. **Result and last attempt in state.json**: the error note survives a restart.
2. **Result on disk, error in memory**: as titles do.

Split:
1. **T13a server, T13b UI**.
2. **One change**.

## Decision
Chosen by the user on 2026-10-24: option 1 in each.
- Mentions: issues updated in the last 3 days (`MENTION_DAYS`), not the spec's week (spec amendment).
- The runner starts `claude` with `MAX_MCP_OUTPUT_TOKENS=60000` (`MCP_OUTPUT_TOKENS`) in its environment, for every job. The prompt runs only its two searches, never a per-issue lookup, and answers `{"error":"search result too large"}` (which fails the schema, so the last good result stays) if a result is still over the cap.
- Prompt: `src/server/jobs/prompts/jira-inbox.md`, front matter `version: <n>` and `{{now}}`, `{{lastSyncedAt}}`, `{{since}}`, `{{changedMinutes}}`, `{{mentionDays}}` slots. Read before every run; an unknown slot or missing version fails the run without calling Claude. JQL uses relative times (`updated >= -<n>m`), so Jira's time zone does not matter.
- Schema (`JiraInboxResult`, src/shared/state.ts): the spec's fields; key `^[A-Z][A-Z0-9]+-\d+$`; `syncedAt` and `lastRelevantAt` ISO 8601 with a zone; reason 1–140 chars; at most 100 items; one item per key. `kind` keeps `pr` for T15.
- `sync.jira = { result?, lastAttempt? }`. A valid answer replaces `result`, with `syncedAt` set to the run's start by the server clock, not the model's echo. Every attempt replaces `lastAttempt = { at, ok, reason?, detail?, promptVersion? }`; `detail` is the runner's error (first schema issue, exit message), never the prompt or answer. `setSync` now validates its value.
- The runner's failure result carries `detail`; the activity.log line is unchanged.
- Scheduler: a 5-min tick runs a sync when the local time is Mon–Fri 09:00–19:00 and the last attempt (good or not) is at least 45 min old. A restart within 45 min of an attempt does not run again; a failed run waits 45 min like a good one. `start()` does not wait for it. `POST /api/jira/inbox/sync` runs at any time; a run in flight is joined.
- Each attempt sends `sessions-changed`, as titles do (one events stream, ADR 0041).

## Consequences
- Real runs on 2026-10-24 (Sonnet 5.5 low): prompt v1 with 7 days took 76 s, 25 turns, $0.68; prompt v3 with 3 days took 24 s, 6 turns, $0.20 with both searches complete. At 13 runs a weekday v3 costs about $13 a week. Full table: [spike § 11](../spike.md).
- Classification is not stable: one issue was `action` in two runs and `fyi` in the next on the same comments. Prompt tuning is the user's (the prompt file is versioned for it).
- A mention on an issue last updated 4–7 days ago is no longer seen; a busy week of comments could still exceed 60,000 tokens, which now fails the run instead of returning part of the inbox.
- A sync and a titles run share the one-at-a-time runner, so a slow sync delays titles.
- Monday's first run covers the weekend, so it has the most issues and is the most likely to time out.
- T13b shows "Jira synced N min ago" from `result.syncedAt`, the error note from `lastAttempt`, and the Sync button; it must keep the login case from ADR 0041.
