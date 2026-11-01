# 0056: A dashboard rename stores a snapshot of Claude Code's custom title; every rescan drops the rename once that title changes

- Status: Accepted
- Date: 2026-11-01
- Task: T16a

## Context
- Spec § Title: "the most recent rename wins, whether made in the dashboard or in Claude Code". Only `custom-title` changes count; a new `ai-title` never replaces a user's rename. The dashboard never writes to Claude Code's files.
- The rescan that `GET /api/sessions` runs also runs `pruneOrphans`, so a GET can already write state.json (docs/api.md, Pruning). The T16a plan asked for the clear "in the same path as pruneOrphans … never in a GET", which conflicts with that.

## Options
1. **Clear on every rescan**: `scanOnce` calls `clearRenamedTitles` right after `pruneOrphans`, with the same single writer (ADR 0010). This includes the rescan inside a GET, but the route handler and `merge()` never decide or write anything.
2. **Clear on watcher and startup rescans only**: the rescan inside a GET prunes but does not clear, and `merge()` hides a stale rename so the GET still shows the right title. That gives two paths that must agree.
3. **No rescan in GET**: serve the last index and let the watcher keep it fresh. This changes how the list behaves today, which is beyond T16a.

## Decision
Option 1, chosen by the user on 2026-11-01.
- State entries gain an optional `title` (trimmed, 1–120 characters) and `titleSnapshot` (Claude Code's `customTitle` when the rename was saved, or `null` when it had none). The change is additive, so the state file stays at version 1 and older files load as they are.
- `PATCH /api/sessions/:id` takes `title: string | null`, trimmed, at most 120 characters. A non-empty value re-indexes first, then stores `title` and the fresh `customTitle` as the snapshot. `null`, `""` or whitespace only clears both. Clients cannot send `titleSnapshot`.
- On each rescan, a live entry that has a `title` and whose current `customTitle` differs from `titleSnapshot` loses both fields. Trashed and missing sessions are left alone.
- `ApiSession.title` is the rename, else the automatic title. `autoTitle` is custom → ai → summary → first prompt. `state.title` is the rename when one is in force, like `ticketOverride` and `autoTicketKey` in ADR 0047. Search matches both titles.

## Consequences
- A `/rename` to the same text as the snapshot does not clear the rename, because nothing changed.
- If `/rename` lands between the PATCH's re-index and its write (well under a second), the next rescan sees a new title and drops the dashboard rename, so Claude Code's title wins.
- The auto-archive log still records the automatic title (`Session.title`).
