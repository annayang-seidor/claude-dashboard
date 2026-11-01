# 0030: Claude Code's cleanupPeriodDays comes from GET /api/retention; the bookmark note shows once per browser

- Status: Accepted
- Date: 2026-10-24
- Task: T9

## Context
- Claude Code deletes transcripts idle for `cleanupPeriodDays` (default 30, `0` = never; spike Q6). Bookmarks do not protect against that. The spec amendment keeps 30 and asks for a warning on bookmarked sessions within 7 days of the limit, plus a one-time note.
- The dashboard must never change that setting or write inside `~/.claude`.
- The page has no way to read `~/.claude/settings.json` itself.

## Options
How the page gets the value:
1. **`GET /api/retention`** returning `{ cleanupPeriodDays: number | null }`. The sessions response (ADR 0014) is unchanged.
2. **A field on `GET /api/sessions`**: one request, refreshed with every list, but it changes the ADR 0014 shape.

When the note shows:
1. **An info toast the first time a bookmark is turned on**, remembered in localStorage (per browser, like the language).
2. **A dismissible banner** while any session is bookmarked, until closed.

## Decision
Route 1 and note 1, chosen by the user on 2026-10-24.
- `readCleanupPeriodDays` reads only `cleanupPeriodDays` from `~/.claude/settings.json`, on each call. A missing file, unset key or invalid value gives 30. An invalid value is logged. `0` gives `null` (no warnings, no note).
- Rows warn when the session is bookmarked and `cleanupPeriodDays − calendar days idle ≤ 7`, counted like `daysUntilTrash`. The copy is "Claude Code removes this in N days", or "…the next time it starts" at 0 or below. Until the value loads, or when the load fails, no row warns.
- The note is a 12 s info toast. It is skipped when Claude Code's cleanup is off. A later toast, such as the delete Undo toast, replaces it.

## Consequences
- Project-level `.claude/settings*.json` files are not read. The spike found none; a project override would be missed.
- Clearing site data shows the note again; that is harmless.
