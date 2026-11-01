# 0027: Trash writes its record before moving; bulk routes sit beside the single ones; purge also clears stray entries

- Status: Accepted
- Date: 2026-10-24
- Task: T8

## Context
- Delete moves `<id>.jsonl` and its `<id>/` folder to `~/.claude-dashboard/trash/` and records `{ originalPath, hadFolder, trashedAt }` in state (spec § Delete, ADR 0009).
- The watcher rescans and prunes up to twice a second (ADR 0015). Pruning keeps an entry only while it is live, trashed or pending. A rescan between the move and the state write would drop the session's status and bookmark.
- T8 asks for bulk variants of trash and restore but does not name their routes.
- Purge deletes entries older than 7 days. The trash folder can also hold entries with no record: put there by hand, or left behind when state.json was lost or a crash hit mid-move.

## Options
Order:
1. **Record first**: write the record, then move. If the move fails, clear the record. Restore moves the files back, then clears the record. A rescan never prunes an entry mid-move. After a crash mid-move, the record may point at files still in place, or a restore may find nothing in the trash (410).
2. **Files first**: simpler, but the gap allows a prune, and a crash leaves trashed files with no record.

Bulk routes:
1. **`POST /api/sessions/trash` and `/api/sessions/restore`**, body `{ ids }`, next to the single-id routes.
2. `POST /api/trash` and `/api/trash/restore`, grouped with purge.
3. The single-id route also accepts `{ ids }`.

Purge scope:
1. Only recorded entries, judged by `trashedAt`.
2. **Recorded entries by `trashedAt`, and stray `<uuid>.jsonl` / `<uuid>/` entries with no record by mtime.**

## Decision
Chosen by the user on 2026-10-24: record first, bulk option 1, purge option 2.
- Bulk takes 1–200 UUIDs. Every id runs, one after another. The reply is `{ results: [{ id, ok, error? }] }` in request order (all-or-report).
- Purge ignores any other names in the trash folder and anything that is not a regular file (for `.jsonl`) or a folder (for `<uuid>/`).
- Restore only moves a file back to `<projectsRoot>/<one folder>/<id>.jsonl`, never creates folders inside `~/.claude`, and returns 409 if either original path exists.
- Trash, restore and purge run one at a time on a single queue.

## Consequences
- A recorded entry's age comes from `trashedAt`, not mtime. `rename` keeps the old mtime, so a transcript that sat idle for weeks is not purged the day it is trashed.
- A stray `<uuid>/` folder's mtime only changes when its direct contents change, so a stray folder can be purged sooner than 7 days after it landed in the trash.
- A rename across volumes (EXDEV) fails with 500. Both folders live under `~`, so this only happens if one of them is moved to another volume.
