# 0037: Auto-archive records its run in state.json for a once-per-browser Undo note; a restore restarts the idle clock; activity.log is JSON lines

- Status: Accepted
- Date: 2026-10-24
- Task: T11

## Context
- Auto-archive runs as a daily job (ADR 0031), usually before any page is open. The spec asks for "N scratch sessions moved to trash · Undo" on the next page load, so the page needs a way to learn what moved.
- Undo moves the sessions back, but they are still idle past the limit, so the next day's run would trash them again.
- The job must log what it moved to `~/.claude-dashboard/activity.log`. T12's runner will log there too.

## Options
How the page learns of a run:
1. **Record + GET, seen per browser**: the job writes `autoArchive: { at, work: ids, personal: ids }` to state.json. `GET /api/auto-archive` returns it. The page remembers the last `at` it showed in localStorage, like the bookmark note (ADR 0030).
2. **Record + GET + POST seen**: the same, plus a route that marks the run as seen, so it shows once across all browsers. Adds a write route, and two open tabs can race.
3. **A field on `GET /api/sessions`**: no new route, but it changes the ADR 0014 shape and every refetch carries it.

After Undo:
1. **A restore restarts the clock**: restore writes `restoredAt`, and auto-archive and the row countdown count idle time from the later of `lastActivityAt` and `restoredAt`.
2. **Undo also bookmarks them**: no new field, but it changes the user's data without asking, and bookmarks also bring Claude Code retention warnings.
3. **Accept re-trash**: the spec as written, but Undo only buys a day.

Log format:
1. **JSON lines**: easy for T12 and scripts to parse.
2. **Plain text lines**: easier to read with `tail`, harder to parse.

## Decision
Chosen by the user on 2026-10-24: record + GET with seen per browser; a restore restarts the clock; JSON lines.
- `StateFile.autoArchive` is optional (no version bump). A run replaces it only when it moved something, so a quiet day keeps the last Undo on offer.
- `GET /api/auto-archive` returns `{ last: { at, work, personal } | null }` with only the ids that still have a trash record. Each page shows its own workspace's ids: Work says "N scratch sessions moved to trash", Personal says "N idle sessions moved to trash". localStorage key `claude-dashboard.autoArchiveSeen.<workspace>` holds the `at` it last showed.
- Every restore sets `restoredAt` (single, bulk and auto-archive Undo alike), and it appears in `ApiSessionState`. The Clean up modal still goes by `lastActivityAt` only (spec § Cleanup), so it ignores `restoredAt`.
- Each auto-archive run appends one line, even when nothing moved: `{ at, job: "auto-archive", moved: [{ id, workspace, title }], failed: [{ id, error }] }`. The file is created with mode 600 because it holds session titles. A failed write is logged and does not fail the run.
- The Clean up modal and the job share `selectCleanup` in `src/shared/cleanup.ts`. "Idle over N days" means last active before local midnight N calendar days ago, so the row's countdown reaches 0 the day before the move.

## Consequences
- Clearing site data shows the last note again. Its Undo is harmless: ids no longer in the trash answer not-found and are skipped.
- A restored session sits a full 7 (Work Scratch) or 14 (Personal) days before auto-archive can take it again, even if it was already old.
- activity.log grows by one line a day and is never rotated. T12 adds its own lines with a different `job`.
- `AUTO_ARCHIVE_ON` now switches both the job and the UI promises, so turning it off cannot leave one without the other.
