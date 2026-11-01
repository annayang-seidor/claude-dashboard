# 0031: Daily jobs run on start and every 6 hours, recorded per local day in state.json

- Status: Accepted
- Date: 2026-10-24
- Task: T9

## Context
- Trash purge ran only at server start. Under launchd (T9) the server can stay up for weeks, so trash older than 7 days was not purged until the next restart (spec § Delete: "Trash is purged after 7 days").
- T11's Scratch auto-archive must run "at most once per calendar day" and can reuse the same mechanism.
- "Already done today" has to survive restarts, or T11 would run again after every restart.

## Options
Where the last run day is recorded:
1. **A `jobs` field in state.json**: `{ "trash-purge": "2026-10-24" }`, written through the existing single writer (ADR 0010). It is optional, so no version bump.
2. **A separate jobs.json**: keeps state.json about sessions, but adds a second file that needs safe writes.

## Decision
Option 1, chosen by the user on 2026-10-24. The runner shape (on start, every 6 h, skip what is done today) was also the user's call.
- `src/server/jobs/daily.ts`: `createDailyJobs({ jobs, state })`. `start()` awaits a first pass before the startup rescan, then repeats on a `setInterval` (unref'd) every 6 h. A pass already running is joined, not doubled.
- "Today" is the local calendar day (`YYYY-MM-DD`), not UTC.
- A job's day is recorded only after it succeeds. A failure is logged and retried on the next pass, and the other jobs still run.
- Jobs must be safe to repeat: a crash between running a job and recording it runs it again. Purge already is.
- The first job is `trash-purge`. `POST /api/trash/purge` still purges on demand without recording a day.

## Consequences
- A server that stays up past midnight runs the day's jobs within 6 h of midnight, not at midnight.
- Job names are keys in state.json: renaming one makes it run again that day.
- T11 adds its auto-archive as a second job instead of its own scheduler.
