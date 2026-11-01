# 0024: Personal has no Scratch; its sessions move to trash after 14 idle days

- Status: Accepted
- Date: 2026-10-24
- Task: T6

## Context
- The spec gives each workspace a Scratch group that auto-archive trashes after 7 idle days.
- Personal sessions rarely have a ticket key, so the indexer marks almost all of them `scratch`, including sessions inside `~/o` repos. With the 7-day rule, most personal work would be trashed within a week.
- Personal work runs on a slower schedule, so it needs slower deletion.

## Options
1. **Spec as written**: Personal Scratch group with 7-day auto-archive. Trashes most of `~/o` after a week.
2. **No auto-archive for Personal**: nothing is trashed without a manual Clean up, so the list only grows.
3. **No Scratch on Personal; every Personal session auto-archives after 14 idle days** (bookmarked kept).

## Decision
Option 3, chosen by the user on 2026-10-24.
- `AUTO_TRASH_DAYS = { work: 7, personal: 14 }` in `src/shared/config.ts` is the single source for the UI and T11.
- The Personal page shows no Scratch group, label or tile. Sessions outside a repo go in a neutral "Outside a repo" group with the same meta line as the repos.
- Every Personal row shows "Moves to trash in N days" (N counts down from 14), or "Bookmarked, kept".
- Work is unchanged: only Scratch rows count down from 7.

## Consequences
- T11's auto-archive must select by workspace: Work → category `scratch`, 7 days; Personal → all sessions, 14 days. Bookmarked sessions are kept in both.
- The session category stays as the indexer reports it; this decision only changes how Personal is shown and archived.
