# 0038: Clean up offers 1 week and 2 weeks; the custom date stops at Claude Code's cleanupPeriodDays

- Status: Accepted
- Date: 2026-10-24
- Task: T11

## Context
- The spec listed 2 weeks, 30 days, 90 days and a custom date. The amendment that kept `cleanupPeriodDays` at 30 dropped the 30-day option, but 90 days stayed.
- Claude Code deletes transcripts idle for `cleanupPeriodDays` (30 here, spike Q6). Anything older than 30 days is already gone or goes the next time `claude` starts, so 90 days and custom dates over 30 days back match nothing.
- Auto-archive already trashes Work Scratch after 7 idle days and every Personal session after 14 (ADR 0024). The manual ranges that still do something sit between 7 and 30 days.

## Options
1. **1 week, 2 weeks (default), custom date**, with the date picker's `min` set to `cleanupPeriodDays` days back.
2. **2 weeks, 3 weeks, custom date**: closer to the old list, but 3 weeks only catches sessions in their last days before Claude Code removes them anyway.
3. **Ranges derived from `cleanupPeriodDays`**: hide any range at or over the limit. This adapts if the setting is raised, but it is more logic for a case that does not exist.

## Decision
Option 1, chosen by the user on 2026-10-24.
- `CLEANUP_RANGES = [7, 14]` in `src/shared/cleanup.ts`; the default stays 2 weeks.
- The custom date starts 3 weeks back. Its `min` is `cleanupPeriodDays` days back from `GET /api/retention` (ADR 0030). When that is still loading, failed to load or `null` (cleanup off), there is no `min`. When the limit is under 3 weeks, the start moves up to it.
- `min` only guides the picker. A typed older date is still accepted and simply matches nothing.

## Consequences
- If `cleanupPeriodDays` is raised, the custom date reaches further back, but there is no longer a quick range for old sessions. A later task would revisit option 3.
- The selection function is unchanged; only the choices offered change.
